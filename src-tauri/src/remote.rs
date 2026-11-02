//! Phone remote (Settings › Playback, off by default): this PC serves a small page on its local network, opened on a
//! phone from a QR code, to play, pause, skip, seek and see what plays and what's next. Routes, token and addresses:
//! `music_core::remote`. Keys and seeks reach the interface as the media panel's `media-key` / `media-seek` events; what
//! plays comes from `media_update`, the queue from `remote_queue` (sent only while the remote is on).
//! The streaming overlay (Settings › Playback, off by default) shares the server: `/overlay` for OBS on this PC; alone, the
//! server listens on 127.0.0.1 only.

use crate::{AppState, CmdResult, art, media::NowPlaying};
use music_core::remote::{self, Route};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

/// First port tried, then the next nine (a second Legato, a dev build).
const PORT: u16 = 47821;
/// Keychain entry of the link's secret: this PC's own (Sync Mode carries named secrets only, not this one).
const TOKEN: &str = "phone_remote_token";
/// Phones served at once: a page asks once a second, a handful is plenty.
const MAX_OPEN: usize = 8;
/// Songs of Up next shown on the phone.
const MAX_NEXT: usize = 30;
const PAGE: &str = include_str!("remote.html");
const OVERLAY_PAGE: &str = include_str!("overlay.html");
/// What the server runs for: the phone remote (the network), the overlay (this PC).
static PHONE: AtomicBool = AtomicBool::new(false);
static OVERLAY: AtomicBool = AtomicBool::new(false);
const CSP: &str = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/// What plays, as the interface last said.
struct Playing {
    title: String,
    artist: String,
    playing: bool,
    position_ms: u64,
    duration_ms: Option<u64>,
    /// When `position_ms` was true.
    at: Instant,
    track_id: Option<i64>,
    art: Option<String>,
    /// New with each song: the page loads the cover again.
    cover: u32,
}

#[derive(Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, rename = "RemoteSong")]
pub struct Song {
    title: String,
    artist: String,
}

static NOW: Mutex<Option<Playing>> = Mutex::new(None);
static NEXT: Mutex<Vec<Song>> = Mutex::new(Vec::new());
static COVERS: AtomicU32 = AtomicU32::new(0);
/// The page with the interface's words in, made at each start (the language may have changed).
static PAGE_NOW: Mutex<String> = Mutex::new(String::new());
static SERVER: Mutex<Option<Server>> = Mutex::new(None);

struct Server {
    port: u16,
    token: String,
    stop: Arc<AtomicBool>,
    /// Listening on the network (the phone remote), else on 127.0.0.1.
    lan: bool,
    thread: Option<std::thread::JoinHandle<()>>,
}

/// `media_update`'s copy: kept even while the remote is off, so it starts with the song playing.
pub fn set_now(now: Option<&NowPlaying>, track_id: Option<i64>, art: Option<&str>) {
    let mut cur = NOW.lock().unwrap();
    *cur = now.map(|n| {
        let same = cur.as_ref().is_some_and(|p| p.title == n.title && p.artist == n.artist && p.track_id == track_id && p.art.as_deref() == art);
        let cover = match &*cur {
            Some(p) if same => p.cover,
            _ => COVERS.fetch_add(1, Ordering::Relaxed) + 1,
        };
        Playing { title: n.title.clone(), artist: n.artist.clone(), playing: n.playing, position_ms: n.position_ms, duration_ms: n.duration_ms, at: Instant::now(), track_id, art: art.map(str::to_string), cover }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateJson<'a> {
    title: &'a str,
    artist: &'a str,
    playing: bool,
    position_ms: u64,
    duration_ms: Option<u64>,
    /// None = no cover to ask for.
    cover: Option<u32>,
    next: &'a [Song],
}

/// What plays now: the position moved on by the time since the interface said it.
fn state_json() -> String {
    let now = NOW.lock().unwrap();
    let Some(p) = now.as_ref() else { return "null".into() };
    let moved = if p.playing { p.position_ms.saturating_add(p.at.elapsed().as_millis() as u64) } else { p.position_ms };
    let next = NEXT.lock().unwrap();
    let json = StateJson {
        title: &p.title,
        artist: &p.artist,
        playing: p.playing,
        position_ms: p.duration_ms.map_or(moved, |d| moved.min(d)),
        duration_ms: p.duration_ms,
        cover: (p.track_id.is_some() || p.art.is_some()).then_some(p.cover),
        next: &next,
    };
    serde_json::to_string(&json).unwrap_or_else(|_| "null".into())
}

/// The song's cover, as the media panel gets it: the local file's own, else the cover URL through the cache.
async fn cover(app: &AppHandle) -> Option<(Vec<u8>, String)> {
    let (id, url) = {
        let now = NOW.lock().unwrap();
        let p = now.as_ref()?;
        (p.track_id, p.art.clone())
    };
    if let Some(id) = id
        && let Some(found) = art::local(app, id).await
    {
        return Some(found);
    }
    art::remote(app, url.as_deref()?, None).await
}

/// `{{Play}}` → the interface's word (HTML-escaped), the English one when it sent none.
fn fill(page: &str, labels: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(page.len());
    let mut rest = page;
    while let Some(at) = rest.find("{{") {
        let Some(len) = rest[at..].find("}}") else { break };
        let key = &rest[at + 2..at + len];
        out.push_str(&rest[..at]);
        let word = labels.get(key).map_or(key, String::as_str);
        out.extend(word.chars().take(80).map(|c| match c {
            '&' => "&amp;".into(),
            '<' => "&lt;".into(),
            '>' => "&gt;".into(),
            '"' => "&quot;".into(),
            '\'' => "&#39;".into(),
            c => c.to_string(),
        }));
        rest = &rest[at + len + 2..];
    }
    out.push_str(rest);
    out
}

/// Request line and headers, at most `MAX_HEAD` bytes. Bodies are never needed: everything is in the query.
fn read_head(stream: &mut TcpStream) -> std::io::Result<String> {
    let mut head = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while head.len() < remote::MAX_HEAD && !head.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        head.extend_from_slice(&chunk[..n]);
    }
    Ok(String::from_utf8_lossy(&head).into_owned())
}

fn answer(mut stream: TcpStream, app: &AppHandle, token: &str, this_pc: bool) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let head = read_head(&mut stream)?;
    let none = || (204, String::new(), Vec::new());
    let route = remote::route(&head, token);
    let route = if remote::allowed(&route, PHONE.load(Ordering::Relaxed), OVERLAY.load(Ordering::Relaxed), this_pc) { route } else { Route::No(403) };
    let (status, kind, body) = match route {
        Route::Page => (200, "text/html; charset=utf-8".into(), PAGE_NOW.lock().unwrap().clone().into_bytes()),
        Route::Overlay => (200, "text/html; charset=utf-8".into(), OVERLAY_PAGE.as_bytes().to_vec()),
        Route::State => (200, "application/json".into(), state_json().into_bytes()),
        Route::Cover => match tauri::async_runtime::block_on(cover(app)) {
            Some((bytes, kind)) => (200, kind, bytes),
            None => (404, String::new(), Vec::new()),
        },
        Route::Key(key) => {
            // Like the tray: a hidden, suspended page would lose the key.
            crate::background::wake(app);
            let _ = app.emit_to("main", "media-key", key);
            none()
        }
        Route::Seek(ms) => {
            crate::background::wake(app);
            let _ = app.emit_to("main", "media-seek", ms);
            none()
        }
        Route::No(code) => (code, String::new(), Vec::new()),
    };
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        _ => "Method Not Allowed",
    };
    let kind = if kind.is_empty() { String::new() } else { format!("Content-Type: {kind}\r\n") };
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\n{kind}Content-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: {CSP}\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(&body)?;
    stream.flush()
}

fn serve(listener: TcpListener, app: AppHandle, token: String, stop: Arc<AtomicBool>) {
    let open = Arc::new(AtomicUsize::new(0));
    for conn in listener.incoming() {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        let Ok(stream) = conn else {
            std::thread::sleep(Duration::from_millis(200));
            continue;
        };
        // Other networks and a crowd of connections: closed unanswered.
        let Some(peer) = stream.peer_addr().ok().map(|a| a.ip()).filter(|ip| remote::private(*ip)) else { continue };
        if open.load(Ordering::Relaxed) >= MAX_OPEN {
            continue;
        }
        open.fetch_add(1, Ordering::Relaxed);
        let (app, token, done) = (app.clone(), token.clone(), open.clone());
        let spawned = std::thread::Builder::new().name("phone-remote-ask".into()).spawn(move || {
            let _ = answer(stream, &app, &token, peer.is_loopback());
            done.fetch_sub(1, Ordering::Relaxed);
        });
        if spawned.is_err() {
            open.fetch_sub(1, Ordering::Relaxed);
        }
    }
}

fn stop_server() {
    let Some(mut s) = SERVER.lock().unwrap().take() else { return };
    s.stop.store(true, Ordering::Relaxed);
    // Wakes the waiting accept, which then sees the flag.
    let _ = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, s.port)), Duration::from_millis(300));
    // Its port free again before a new server binds: the overlay's link in OBS keeps working.
    if let Some(t) = s.thread.take() {
        let _ = t.join();
    }
}

/// The server for this token, on the network while the phone remote is on (else this PC only): the running one, else
/// a new one on the first free port.
fn serve_with(app: &AppHandle, token: &str) -> CmdResult<u16> {
    let lan = PHONE.load(Ordering::Relaxed);
    let mut server = SERVER.lock().unwrap();
    if let Some(s) = server.as_ref().filter(|s| s.token == token && s.lan == lan) {
        return Ok(s.port);
    }
    drop(server);
    stop_server();
    let ip = if lan { Ipv4Addr::UNSPECIFIED } else { Ipv4Addr::LOCALHOST };
    let listener = (PORT..PORT + 10).find_map(|p| TcpListener::bind((ip, p)).ok()).ok_or("No free port for the phone remote")?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let stop = Arc::new(AtomicBool::new(false));
    let (app, token_in, stop_in) = (app.clone(), token.to_string(), stop.clone());
    let thread = std::thread::Builder::new().name("phone-remote".into()).spawn(move || serve(listener, app, token_in, stop_in)).map_err(|e| e.to_string())?;
    server = SERVER.lock().unwrap();
    *server = Some(Server { port, token: token.to_string(), stop, lan, thread: Some(thread) });
    Ok(port)
}

/// This PC's address on its network: the one its default route uses (a UDP connect sends nothing), else the first
/// private one.
pub(crate) fn lan_ip() -> Option<IpAddr> {
    let routed = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .and_then(|s| {
            s.connect((Ipv4Addr::new(192, 0, 2, 1), 9))?;
            s.local_addr()
        })
        .map(|a| a.ip())
        .ok();
    let usable = |ip: &IpAddr| ip.is_ipv4() && !ip.is_loopback() && !ip.is_unspecified() && remote::private(*ip);
    routed.filter(usable).or_else(|| if_addrs::get_if_addrs().ok()?.into_iter().map(|i| i.ip()).find(usable))
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteLink {
    /// The page's address with its secret. None = this PC has no network address.
    url: Option<String>,
    /// QR modules: size, row-major "0"/"1".
    qr: Option<(usize, String)>,
}

/// Starts (or keeps) the server. `labels`: the page's words in the interface's language, keyed by the English text.
/// `fresh`: a new secret, so links given before stop working.
#[tauri::command]
pub async fn remote_start(app: AppHandle, state: State<'_, AppState>, labels: HashMap<String, String>, fresh: bool) -> CmdResult<RemoteLink> {
    let token = token(&state, fresh)?;
    *PAGE_NOW.lock().unwrap() = fill(PAGE, &labels);
    PHONE.store(true, Ordering::Relaxed);
    let port = serve_with(&app, &token)?;
    let url = lan_ip().map(|ip| format!("http://{ip}:{port}/?t={token}"));
    let qr = url.as_deref().and_then(music_core::share::qr_modules).map(|(size, dark)| (size, dark.iter().map(|&d| if d { '1' } else { '0' }).collect()));
    Ok(RemoteLink { url, qr })
}

/// The link's secret, a new one when `fresh` (older links stop working, the overlay's too).
fn token(state: &AppState, fresh: bool) -> CmdResult<String> {
    if let Some(t) = state.store.load::<String>(TOKEN).filter(|t| t.len() == 32 && !fresh) {
        return Ok(t);
    }
    let t = remote::new_token();
    state.store.save(TOKEN, &t).map_err(|e| e.to_string())?;
    Ok(t)
}

#[tauri::command]
pub async fn remote_stop(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    PHONE.store(false, Ordering::Relaxed);
    NEXT.lock().unwrap().clear();
    // The overlay still on: its server again, on this PC only.
    if OVERLAY.load(Ordering::Relaxed) {
        serve_with(&app, &token(&state, false)?)?;
    } else {
        stop_server();
    }
    Ok(())
}

/// Starts (or keeps) the server for the streaming overlay; its link, for OBS on this PC.
#[tauri::command]
pub async fn overlay_start(app: AppHandle, state: State<'_, AppState>) -> CmdResult<String> {
    OVERLAY.store(true, Ordering::Relaxed);
    let token = token(&state, false)?;
    let port = serve_with(&app, &token)?;
    Ok(format!("http://127.0.0.1:{port}/overlay?t={token}"))
}

#[tauri::command]
pub async fn overlay_stop() {
    OVERLAY.store(false, Ordering::Relaxed);
    if !PHONE.load(Ordering::Relaxed) {
        stop_server();
    }
}

/// Up next as the interface shows it (first songs only).
#[tauri::command]
pub async fn remote_queue(next: Vec<Song>) {
    *NEXT.lock().unwrap() = next.into_iter().take(MAX_NEXT).map(|s| Song { title: s.title.chars().take(200).collect(), artist: s.artist.chars().take(200).collect() }).collect();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_words_are_escaped() {
        let labels = HashMap::from([("Play".to_string(), "Lire <b>\"x\"</b>".to_string())]);
        assert_eq!(fill("<a aria-label=\"{{Play}}\">{{Pause}}</a>{{", &labels), "<a aria-label=\"Lire &lt;b&gt;&quot;x&quot;&lt;/b&gt;\">Pause</a>{{");
    }

    #[test]
    fn state_moves_on_while_playing() {
        let n = NowPlaying { title: "A".into(), artist: "B".into(), album: None, playing: false, position_ms: 5_000, duration_ms: Some(6_000) };
        set_now(Some(&n), None, Some("https://i.ytimg.com/vi/x/hq.jpg"));
        let first: serde_json::Value = serde_json::from_str(&state_json()).unwrap();
        assert_eq!((first["positionMs"].as_u64(), first["cover"].as_u64().is_some()), (Some(5_000), true));
        // Same song: same cover; playing, an old position moves on, never past the end.
        set_now(Some(&NowPlaying { playing: true, ..n.clone() }), None, Some("https://i.ytimg.com/vi/x/hq.jpg"));
        NOW.lock().unwrap().as_mut().unwrap().at -= Duration::from_secs(3);
        let later: serde_json::Value = serde_json::from_str(&state_json()).unwrap();
        assert_eq!((later["positionMs"].as_u64(), later["cover"].clone()), (Some(6_000), first["cover"].clone()));
        set_now(Some(&NowPlaying { title: "C".into(), ..n }), None, None);
        let other: serde_json::Value = serde_json::from_str(&state_json()).unwrap();
        assert!(other["cover"].is_null());
        set_now(None, None, None);
        assert_eq!(state_json(), "null");
    }
}
