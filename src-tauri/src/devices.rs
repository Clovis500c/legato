//! Your devices on the same network (Sync Mode v2, `docs/sync-mode.md`): the listener, presence on mDNS, the code shown
//! with its QR code, pairing, the automatic sync, pair keys in the keychain. Wire: `music_connectors::devices`; kinds,
//! rules and rows: `music_core::devices`; snapshots and merging: `syncmode.rs`.

use crate::syncmode;
use crate::{AppState, CmdResult, err};
use music_connectors::devices::{self as wire, Event, Hello, Intro, Paired, Presence, Refused, Session, WrongCode};
use music_connectors::nearby;
use music_core::devices::{self as dv, Card, Form, Heard, Os, PairLink, Peer, Row};
use music_core::library::now_ms;
use music_core::remote::private;
use music_core::syncmode::{self as sm, Merged, Snapshot};
use serde::Serialize;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Notify, Semaphore};

/// Keychain: a trusted device's pair key (hex), by its id.
const KEY: &str = "sync_peer_";
const OFFER_TTL: i64 = 10 * 60_000;
const MAX_TRIES: u8 = 5;
const FIRST: Duration = Duration::from_secs(20);
const EVERY: Duration = Duration::from_secs(60);
/// mDNS needs a moment to hear the others once started.
const HEAR: Duration = Duration::from_secs(3);
/// Connections answered at once.
const AT_ONCE: usize = 4;

#[derive(Default)]
pub struct Devices {
    inner: Mutex<Inner>,
    /// Listener and presence while on.
    tasks: Mutex<Vec<tauri::async_runtime::JoinHandle<()>>>,
    /// One sync started here at a time (automatic or asked).
    running: tokio::sync::Mutex<()>,
    /// A trusted device showed up: the automatic round runs now.
    wake: Notify,
}

#[derive(Default)]
struct Inner {
    port: u16,
    presence: Option<Arc<Presence>>,
    heard: HashMap<String, (Heard, Vec<SocketAddr>)>,
    /// Last reached over TCP (unix ms), by id.
    reached: HashMap<String, i64>,
    /// Last automatic try of a device mDNS doesn't hear (unix ms).
    tried: HashMap<String, i64>,
    offer: Option<Offer>,
    /// This device's stamp as announced.
    stamp: Option<String>,
    error: Option<String>,
    /// Failed automatic syncs, logged once each.
    failed: HashMap<String, String>,
}

struct Offer {
    code: String,
    trust: bool,
    tries: u8,
    until: i64,
}

/// Settings › Sync Mode › Your devices.
#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "DevicesStatus")]
pub struct Status {
    /// Sync over the network: announced, listening.
    network: bool,
    /// Syncs automatically with trusted devices.
    auto: bool,
    name: String,
    os: Os,
    form: Form,
    rows: Vec<Row>,
    /// The code shown, while it is.
    offer: Option<OfferView>,
    /// Listening failed.
    error: Option<String>,
}

#[derive(Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "DeviceOffer")]
pub struct OfferView {
    code: String,
    /// What the QR code holds; None off any network.
    link: Option<String>,
    qr: Option<(usize, String)>,
    /// Closes then (unix ms).
    until: i64,
}

/// "device-offer" event: someone paired with the code shown here (Ok), or it closed (Err). Only writes the type.
#[cfg(test)]
#[derive(ts_rs::TS)]
#[ts(export, rename = "DeviceOfferEvent", as = "Result<Merged, String>")]
struct DeviceOfferEvent;

/// A laptop or a tower: a system battery says.
#[cfg(windows)]
fn battery() -> bool {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut s = SYSTEM_POWER_STATUS::default();
    // 128: no system battery; 255: unknown.
    unsafe { GetSystemPowerStatus(&mut s) }.is_ok() && s.BatteryFlag & 128 == 0 && s.BatteryFlag != 255
}

#[cfg(target_os = "linux")]
fn battery() -> bool {
    std::fs::read_dir("/sys/class/power_supply").is_ok_and(|d| d.filter_map(Result::ok).any(|e| e.file_name().to_string_lossy().starts_with("BAT")))
}

#[cfg(not(any(windows, target_os = "linux")))]
fn battery() -> bool {
    false
}

/// The `Devices` state for as long as `app` (a `State` is a temporary).
fn dev(app: &AppHandle) -> &Devices {
    app.state::<Devices>().inner()
}

fn me(state: &AppState) -> Card {
    let os = Os::this();
    Card { id: syncmode::config(state).device, name: syncmode::device_name(), os, form: Form::of(os, battery()) }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn key_of(state: &AppState, id: &str) -> Option<[u8; 32]> {
    let text: String = state.store.load(&format!("{KEY}{id}"))?;
    let bytes: Option<Vec<u8>> = (0..text.len()).step_by(2).map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok()).collect();
    bytes?.try_into().ok()
}

/// A snapshot's stamp: without its time, a playing song's position or secrets (it goes out in clear on mDNS).
fn stamp_of(s: &Snapshot) -> String {
    dv::stamp(&syncmode::stable_json(&Snapshot { secrets: None, ..s.clone() }))
}

/// This PC's addresses on its networks, the routed one first.
fn lan_ips() -> Vec<Ipv4Addr> {
    let mut out: Vec<Ipv4Addr> = crate::remote::lan_ip()
        .into_iter()
        .filter_map(|ip| match ip {
            IpAddr::V4(v4) => Some(v4),
            IpAddr::V6(_) => None,
        })
        .collect();
    for i in if_addrs::get_if_addrs().unwrap_or_default() {
        if let IpAddr::V4(v4) = i.ip()
            && !v4.is_loopback()
            && private(IpAddr::V4(v4))
            && !out.contains(&v4)
        {
            out.push(v4);
        }
    }
    out.truncate(dv::ADDRS_MAX);
    out
}

fn emit(app: &AppHandle) {
    let _ = app.emit_to("main", "devices", ());
}

#[tauri::command]
pub async fn devices_status(state: State<'_, AppState>, devices: State<'_, Devices>) -> CmdResult<Status> {
    let c = syncmode::config(&state);
    let me = me(&state);
    let inner = devices.inner.lock().unwrap();
    let heard: Vec<Heard> = inner.heard.values().map(|(h, _)| h.clone()).collect();
    let rows = dv::rows(&me.id, &c.peers, &heard, |id| inner.reached.get(id).copied(), now_ms());
    let offer = inner.offer.as_ref().filter(|o| o.until > now_ms()).map(|o| view(&me.id, inner.port, o));
    Ok(Status { network: c.network, auto: !c.manual, name: me.name, os: me.os, form: me.form, rows, offer, error: inner.error.clone() })
}

fn view(id: &str, port: u16, o: &Offer) -> OfferView {
    let hosts: Vec<SocketAddrV4> = lan_ips().into_iter().map(|ip| SocketAddrV4::new(ip, port)).collect();
    let link = (!hosts.is_empty()).then(|| PairLink { code: o.code.clone(), hosts, id: id.to_string() }.text());
    let qr = link.as_deref().and_then(music_core::share::qr_modules).map(|(n, m)| (n, m.iter().map(|&b| if b { '1' } else { '0' }).collect()));
    OfferView { code: o.code.clone(), link, qr, until: o.until }
}

/// Sync over the network on or off.
#[tauri::command]
pub async fn devices_network(app: AppHandle, state: State<'_, AppState>, on: bool) -> CmdResult<()> {
    let mut c = syncmode::config(&state);
    c.network = on;
    syncmode::save_config(&state, &c)?;
    if on {
        start(&app).await?;
    } else {
        stop(&app);
    }
    emit(&app);
    Ok(())
}

/// Sync automatically with trusted devices, or on "Sync now" only.
#[tauri::command]
pub async fn devices_auto(app: AppHandle, state: State<'_, AppState>, on: bool) -> CmdResult<()> {
    let mut c = syncmode::config(&state);
    c.manual = !on;
    syncmode::save_config(&state, &c)?;
    announce(&app);
    emit(&app);
    dev(&app).wake.notify_one();
    Ok(())
}

/// Network on (saved), listening and heard.
async fn on(app: &AppHandle) -> CmdResult<()> {
    let state = app.state::<AppState>();
    let mut c = syncmode::config(&state);
    if !c.network {
        c.network = true;
        syncmode::save_config(&state, &c)?;
    }
    start(app).await
}

async fn start(app: &AppHandle) -> CmdResult<()> {
    let devices = dev(app);
    if !devices.tasks.lock().unwrap().is_empty() {
        return Ok(());
    }
    // All interfaces: the others are other machines. Windows asks once to allow it on private networks.
    let listener = match TcpListener::bind((Ipv4Addr::UNSPECIFIED, wire::PORT)).await {
        Ok(l) => l,
        Err(_) => TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).await.map_err(err)?,
    };
    let port = listener.local_addr().map_err(err)?.port();
    let (presence, events) = match Presence::start() {
        Ok(p) => p,
        Err(e) => {
            devices.inner.lock().unwrap().error = Some(e.to_string());
            return Err(err(e));
        }
    };
    {
        let mut inner = devices.inner.lock().unwrap();
        inner.port = port;
        inner.presence = Some(Arc::new(presence));
        inner.heard.clear();
        inner.error = None;
    }
    announce(app);
    let a = app.clone();
    let hear = tauri::async_runtime::spawn(async move {
        while let Ok(e) = events.recv_async().await {
            if let Some(ev) = wire::event(e) {
                heard(&a, ev);
            }
        }
    });
    let a = app.clone();
    let serve = tauri::async_runtime::spawn(async move {
        let gate = Arc::new(Semaphore::new(AT_ONCE));
        loop {
            let Ok((s, from)) = listener.accept().await else {
                tokio::time::sleep(Duration::from_millis(200)).await;
                continue;
            };
            // Only this network; a few at a time.
            let Ok(permit) = gate.clone().try_acquire_owned() else { continue };
            if !private(from.ip()) {
                continue;
            }
            let a = a.clone();
            tauri::async_runtime::spawn(async move {
                answer(&a, s).await;
                drop(permit);
            });
        }
    });
    *devices.tasks.lock().unwrap() = vec![hear, serve];
    devices.wake.notify_one();
    Ok(())
}

fn stop(app: &AppHandle) {
    let devices = dev(app);
    for t in devices.tasks.lock().unwrap().drain(..) {
        t.abort();
    }
    let id = syncmode::config(&app.state::<AppState>()).device;
    let mut inner = devices.inner.lock().unwrap();
    if let Some(p) = inner.presence.take() {
        p.withdraw(&id);
    }
    inner.heard.clear();
    inner.offer = None;
    inner.port = 0;
}

/// This device's mDNS words, again (code shown or not, automatic or not, stamp).
fn announce(app: &AppHandle) {
    let state = app.state::<AppState>();
    let c = syncmode::config(&state);
    let me = me(&state);
    let inner = dev(app).inner.lock().unwrap();
    let Some(p) = inner.presence.clone() else { return };
    let offering = inner.offer.as_ref().is_some_and(|o| o.until > now_ms());
    let words = dv::txt(&me, offering, !c.manual, inner.stamp.as_deref());
    let port = inner.port;
    drop(inner);
    if let Err(e) = p.announce(&me.id, port, &words) {
        crate::diag::warn("devices", "announce failed", &e.to_string());
    }
}

fn heard(app: &AppHandle, ev: Event) {
    let c = syncmode::config(&app.state::<AppState>());
    let devices = dev(app);
    let mut inner = devices.inner.lock().unwrap();
    match ev {
        Event::Heard(h, addrs) => {
            if h.card.id == c.device {
                return;
            }
            let id = h.card.id.clone();
            let fresh = inner.heard.insert(id.clone(), (h, addrs)).is_none();
            if fresh && c.peers.iter().any(|p| p.card.id == id) {
                devices.wake.notify_one();
            }
        }
        Event::Gone(id) => {
            inner.heard.remove(&id);
        }
    }
    drop(inner);
    emit(app);
}

/// The code shown here, if still open.
fn offered(app: &AppHandle) -> Option<(String, bool)> {
    let inner = dev(app).inner.lock().unwrap();
    inner.offer.as_ref().filter(|o| o.until > now_ms() && o.tries > 0).map(|o| (o.code.clone(), o.trust))
}

fn close_offer(app: &AppHandle) {
    dev(app).inner.lock().unwrap().offer = None;
    announce(app);
    emit(app);
}

fn wrong_try(app: &AppHandle) {
    let closed = {
        let mut inner = dev(app).inner.lock().unwrap();
        let Some(o) = inner.offer.as_mut() else { return };
        o.tries = o.tries.saturating_sub(1);
        let closed = o.tries == 0;
        if closed {
            inner.offer = None;
        }
        closed
    };
    if closed {
        announce(app);
        let _ = app.emit_to("main", "device-offer", syncmode::logged::<Merged>("offering", Err("Too many wrong codes: start again".into())));
        emit(app);
    }
}

/// A connection to this device: pairing with the code shown, or a trusted device's sync.
async fn answer(app: &AppHandle, s: TcpStream) {
    let Ok(inc) = wire::incoming(s).await else { return };
    let state = app.state::<AppState>();
    let card = me(&state);
    let port = dev(app).inner.lock().unwrap().port;
    match inc.hello.clone() {
        Hello::Pair => {
            let Some((code, trust)) = offered(app) else { return inc.refuse().await };
            match inc.pair(&code, &Intro { card, port, trust }).await {
                Ok(p) => {
                    close_offer(app);
                    let out = paired(app, p, trust).await;
                    let _ = app.emit_to("main", "device-offer", syncmode::logged("offering", out));
                }
                Err(e) if e.is::<WrongCode>() => wrong_try(app),
                Err(_) => {}
            }
        }
        Hello::Sync { from, to } => {
            if to != card.id {
                return inc.not_me().await;
            }
            let Some(key) = key_of(&state, &from) else { return inc.refuse().await };
            let id = card.id.clone();
            if let Ok((session, theirs)) = inc.sync(&id, &key, &Intro { card, port, trust: true }).await {
                let _ = syncmode::logged("device", swap(app, session, &theirs).await);
            }
        }
    }
}

/// Pairing done, either side: the key kept when both trust, then the snapshots swapped.
async fn paired(app: &AppHandle, p: Paired, trust: bool) -> CmdResult<Merged> {
    if trust && p.theirs.trust {
        let state = app.state::<AppState>();
        state.store.save(&format!("{KEY}{}", p.theirs.card.id), &hex(&p.key)).map_err(err)?;
        let mut c = syncmode::config(&state);
        c.peers.retain(|x| x.card.id != p.theirs.card.id);
        c.peers.push(Peer { card: p.theirs.card.clone(), added: now_ms(), synced: None, addrs: vec![], merged: None, sent: None, refused: false });
        c.network = true;
        syncmode::save_config(&state, &c)?;
    }
    swap(app, p.session, &p.theirs).await
}

/// Both snapshots swapped and merged; the device's row brought up to date.
async fn swap(app: &AppHandle, session: Session, theirs: &Intro) -> CmdResult<Merged> {
    let addr = session.peer_addr();
    let a = app.clone();
    let (mine, sent) = tauri::async_runtime::spawn_blocking(move || {
        let state = a.state::<AppState>();
        let s = syncmode::snapshot(&state, &syncmode::config(&state).device, true)?;
        anyhow::Ok((sm::pack(&s)?, stamp_of(&s)))
    })
    .await
    .map_err(err)?
    .map_err(err)?;
    let bytes = session.swap(&mine).await.map_err(err)?;
    let a = app.clone();
    let (merged, got) = tauri::async_runtime::spawn_blocking(move || {
        let s = sm::unpack(&bytes)?;
        let got = stamp_of(&s);
        syncmode::take(&a, &s).map(|m| (m, got))
    })
    .await
    .map_err(err)?
    .map_err(err)?;
    let state = app.state::<AppState>();
    let mut c = syncmode::config(&state);
    if let Some(p) = c.peers.iter_mut().find(|p| p.card.id == theirs.card.id) {
        p.card = theirs.card.clone();
        p.synced = Some(now_ms());
        p.merged = Some(got);
        p.sent = Some(sent);
        p.refused = false;
        if let Some(a) = addr.filter(|_| theirs.port != 0) {
            p.reached_at(&SocketAddr::new(a.ip(), theirs.port).to_string());
        }
        syncmode::save_config(&state, &c)?;
    }
    {
        let mut inner = dev(app).inner.lock().unwrap();
        inner.reached.insert(theirs.card.id.clone(), now_ms());
        inner.failed.remove(&theirs.card.id);
    }
    emit(app);
    Ok(merged)
}

/// Where to reach a trusted device: what mDNS heard, then where it was last reached.
fn addresses(app: &AppHandle, peer: &Peer) -> Vec<SocketAddr> {
    let inner = dev(app).inner.lock().unwrap();
    let mut out: Vec<SocketAddr> = inner.heard.get(&peer.card.id).map(|(_, a)| a.clone()).unwrap_or_default();
    for a in peer.addrs.iter().filter_map(|a| a.parse::<SocketAddr>().ok()).filter(|a| private(a.ip())) {
        if !out.contains(&a) {
            out.push(a);
        }
    }
    out
}

/// Syncs with trusted `peer` now.
async fn sync_with(app: &AppHandle, peer: &Peer) -> CmdResult<Merged> {
    let devices = dev(app);
    let _one = devices.running.lock().await;
    let state = app.state::<AppState>();
    let key = key_of(&state, &peer.card.id).ok_or("Pair this device again")?;
    let addrs = addresses(app, peer);
    if addrs.is_empty() {
        return Err("Not on this network".into());
    }
    let card = me(&state);
    let port = devices.inner.lock().unwrap().port;
    let id = card.id.clone();
    match wire::sync(&addrs, &id, &peer.card.id, &key, &Intro { card, port, trust: true }).await {
        Ok((session, theirs)) => swap(app, session, &theirs).await,
        Err(e) if e.is::<Refused>() => {
            let mut c = syncmode::config(&state);
            if let Some(p) = c.peers.iter_mut().find(|p| p.card.id == peer.card.id) {
                p.refused = true;
                syncmode::save_config(&state, &c)?;
            }
            emit(app);
            Err("That device no longer knows this one: pair them again".into())
        }
        Err(e) => Err(e.to_string()),
    }
}

/// Shows a code (and its QR code) for another device to pair with this one.
#[tauri::command]
pub async fn device_offer(app: AppHandle, state: State<'_, AppState>, trust: bool) -> CmdResult<OfferView> {
    on(&app).await?;
    // The device showing the code is the reference for settings never synced before.
    {
        let lib = state.lib();
        if lib.settings_unstamped().map_err(err)? {
            lib.stamp_all_settings(now_ms()).map_err(err)?;
        }
    }
    let offer = Offer { code: nearby::new_code(), trust, tries: MAX_TRIES, until: now_ms() + OFFER_TTL };
    let id = syncmode::config(&state).device;
    let devices = dev(&app);
    let shown = {
        let mut inner = devices.inner.lock().unwrap();
        let v = view(&id, inner.port, &offer);
        inner.offer = Some(offer);
        v
    };
    announce(&app);
    emit(&app);
    let (a, code) = (app.clone(), shown.code.clone());
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(OFFER_TTL as u64)).await;
        let open = dev(&a).inner.lock().unwrap().offer.as_ref().is_some_and(|o| o.code == code);
        if open {
            close_offer(&a);
            let _ = a.emit_to("main", "device-offer", Err::<Merged, String>("Code expired: start again".into()));
        }
    });
    Ok(shown)
}

/// Closes the code shown if it is still `code` (a newer one stays).
#[tauri::command]
pub async fn device_offer_stop(app: AppHandle, code: String) -> CmdResult<()> {
    let open = dev(&app).inner.lock().unwrap().offer.as_ref().is_some_and(|o| o.code == code);
    if open {
        close_offer(&app);
    }
    Ok(())
}

/// Pairs with the device showing `code` (heard on the network), or the one a scanned QR code names (`link`). No new
/// device showing it: an older Legato's code (the one-off swap).
#[tauri::command]
pub async fn device_pair(app: AppHandle, state: State<'_, AppState>, code: String, link: Option<String>, trust: bool) -> CmdResult<Merged> {
    syncmode::logged("pairing", pair(app, &state, code, link, trust).await)
}

async fn pair(app: AppHandle, state: &AppState, code: String, link: Option<String>, trust: bool) -> CmdResult<Merged> {
    let was_on = !dev(&app).tasks.lock().unwrap().is_empty();
    on(&app).await?;
    let (code, addrs) = match link.as_deref() {
        Some(text) => {
            let l = PairLink::parse(text).ok_or("This isn't a Legato pairing code")?;
            (l.code, l.hosts.into_iter().map(SocketAddr::V4).collect::<Vec<_>>())
        }
        None => {
            let code = code.trim().to_string();
            if !dv::is_code(&code) {
                return Err("The code has 6 digits".into());
            }
            if !was_on {
                tokio::time::sleep(HEAR).await;
            }
            let inner = dev(&app).inner.lock().unwrap();
            let addrs: Vec<SocketAddr> = inner.heard.values().filter(|(h, _)| h.offering).flat_map(|(_, a)| a.clone()).collect();
            (code, addrs)
        }
    };
    if addrs.is_empty() {
        return syncmode::join(app, state, code).await.map_err(|_| "No device is showing a code on this network".to_string());
    }
    let card = me(state);
    let port = dev(&app).inner.lock().unwrap().port;
    let p = wire::pair(&addrs, &code, &Intro { card, port, trust }).await.map_err(err)?;
    paired(&app, p, trust).await
}

/// "Sync now" with one trusted device.
#[tauri::command]
pub async fn device_sync(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<Merged> {
    let peer = syncmode::config(&state).peers.into_iter().find(|p| p.card.id == id).ok_or("This device isn't paired")?;
    syncmode::logged("device", sync_with(&app, &peer).await)
}

/// No longer trusted here: its key and row go.
#[tauri::command]
pub async fn device_forget(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let mut c = syncmode::config(&state);
    c.peers.retain(|p| p.card.id != id);
    syncmode::save_config(&state, &c)?;
    state.store.set(&format!("{KEY}{id}"), None).map_err(err)?;
    emit(&app);
    Ok(())
}

/// At start (network on: listening and heard), then the automatic round every minute, or when a trusted device shows
/// up.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST).await;
        if syncmode::config(&app.state::<AppState>()).network
            && let Err(e) = start(&app).await
        {
            crate::diag::warn("devices", "listening failed", &e);
        }
        loop {
            auto_round(&app).await;
            let _ = tokio::time::timeout(EVERY, dev(&app).wake.notified()).await;
        }
    });
}

async fn auto_round(app: &AppHandle) {
    let c = syncmode::config(&app.state::<AppState>());
    if !c.network || c.peers.is_empty() || dev(app).tasks.lock().unwrap().is_empty() {
        return;
    }
    // This device's stamp, announced when it moved.
    let a = app.clone();
    let Ok(Ok(mine)) = tauri::async_runtime::spawn_blocking(move || {
        let state = a.state::<AppState>();
        syncmode::snapshot(&state, &syncmode::config(&state).device, true).map(|s| stamp_of(&s))
    })
    .await
    else {
        return;
    };
    let moved = {
        let mut inner = dev(app).inner.lock().unwrap();
        let moved = inner.stamp.as_deref() != Some(mine.as_str());
        inner.stamp = Some(mine.clone());
        moved
    };
    if moved {
        announce(app);
    }
    if c.manual {
        return;
    }
    let now = now_ms();
    for peer in &c.peers {
        let (heard, auto, theirs) = {
            let inner = dev(app).inner.lock().unwrap();
            match inner.heard.get(&peer.card.id) {
                Some((h, _)) => (true, h.auto, h.stamp.clone()),
                None => (false, false, None),
            }
        };
        if !dv::starts(&c.device, true, &peer.card.id, auto) || !peer.due(theirs.as_deref(), &mine, now) {
            continue;
        }
        // Not heard (mDNS quiet, or away): its last addresses, every 10 minutes at most.
        if !heard {
            let mut inner = dev(app).inner.lock().unwrap();
            if peer.addrs.is_empty() || inner.tried.get(&peer.card.id).is_some_and(|t| now - t < dv::PULL_EVERY) {
                continue;
            }
            inner.tried.insert(peer.card.id.clone(), now);
        }
        if let Err(e) = sync_with(app, peer).await {
            let fresh = dev(app).inner.lock().unwrap().failed.insert(peer.card.id.clone(), e.clone()).is_none_or(|old| old != e);
            if fresh && heard {
                crate::diag::warn("syncmode", "device sync failed", &e);
            }
        }
    }
}
