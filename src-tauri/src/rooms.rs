//! Listening rooms on the local network (`docs/rooms.md`): lead a room (its listener, its code and QR code, its mDNS
//! name), or join one and follow it (the host's clock, its messages turned into events). Each listener finds the song
//! on their own side (`room_resolve`): their library, the YouTube video itself, else one paced search. Wire:
//! `music_connectors::rooms`; rules: `music_core::rooms`; interface: `ui/src/features/rooms/`.

use crate::{AppState, CmdResult, err};
use music_connectors::art::allowed;
use music_connectors::rooms::{self as wire, Advert, Full, Host, HostEvent, Joined, Link, Shut, WrongCode};
use music_core::library::now_ms;
use music_core::model::{Source, Track};
use music_core::rooms::{self as rm, Clock, Heard, Now, Reaction, RoomLink, RoomSong, ToHost, ToListener};
use music_core::searchpace::Pace;
use serde::Serialize;
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::net::TcpListener;
use tokio::sync::mpsc;

/// A search waits this long at most for the pace's gap (a refusal's wait: the song isn't found here).
const GAP_WAIT: Duration = Duration::from_secs(20);

#[derive(Default)]
pub struct Rooms {
    mode: Mutex<Mode>,
    /// The rooms last heard, their addresses by id.
    heard: Mutex<HashMap<String, Vec<SocketAddr>>>,
    /// The listener's searches, one at a time and spaced (`searchpace`); the player's own too (`links::find_now`).
    pub(crate) pace: tokio::sync::Mutex<Pace>,
}

#[derive(Default)]
enum Mode {
    #[default]
    Off,
    Host(Box<Hosting>),
    Listen(Box<Listening>),
}

struct Hosting {
    host: Host,
    id: String,
    room: String,
    name: String,
    port: u16,
    advert: Option<Advert>,
    task: JoinHandle<()>,
}

struct Listening {
    link: Arc<Link>,
    room: String,
    host: String,
    people: Vec<String>,
    /// On the host's clock (`local` turns it).
    now: Now,
    next: Vec<RoomSong>,
    clock: Clock,
    tasks: Vec<JoinHandle<()>>,
}

impl Listening {
    /// What plays, on this device's clock.
    fn local(&self) -> Now {
        Now { at: self.clock.local(self.now.at), ..self.now.clone() }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename = "RoomRole")]
pub enum Role {
    Off,
    Host,
    Listener,
}

/// The room as the interface shows it.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "RoomStatus")]
pub struct Status {
    role: Role,
    room: String,
    host: String,
    /// Who listens (the host left out).
    people: Vec<String>,
    /// The host's: the code shown, its QR link and modules (None off any network).
    code: Option<String>,
    link: Option<String>,
    qr: Option<(usize, String)>,
    /// A listener's: what plays in the room, on this device's clock.
    now: Option<Now>,
    next: Vec<RoomSong>,
}

/// "room" event.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[ts(export, rename = "RoomEvent")]
pub enum Event {
    /// Ask `room_status` again.
    State,
    Now { now: Now },
    Next { songs: Vec<RoomSong> },
    React { from: String, reaction: Reaction },
    /// The room is over for this listener: the host ended it, or went (`gone`).
    End { gone: bool },
}

/// How a listener plays a room's song.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[ts(export, rename = "RoomFind")]
pub enum Find {
    /// A song of their own library.
    Library { id: i64 },
    /// Not theirs: this track (its YouTube version, or Spotify's).
    Track { track: Track },
    /// Can't find this song here (no version, or YouTube refused: the room goes on).
    Missing,
    /// Ahead of time only: no search now, ask again when it plays.
    Later,
}

fn rooms(app: &AppHandle) -> &Rooms {
    app.state::<Rooms>().inner()
}

fn emit(app: &AppHandle, e: Event) {
    let _ = app.emit_to("main", "room", e);
}

fn status_of(mode: &Mode) -> Status {
    let off = Status { role: Role::Off, room: String::new(), host: String::new(), people: Vec::new(), code: None, link: None, qr: None, now: None, next: Vec::new() };
    match mode {
        Mode::Off => off,
        Mode::Host(h) => {
            let code = h.host.code();
            let hosts: Vec<SocketAddrV4> = crate::devices::lan_ips().into_iter().map(|ip| SocketAddrV4::new(ip, h.port)).collect();
            let link = (!hosts.is_empty()).then(|| RoomLink { code: code.clone(), hosts, id: h.id.clone() }.text());
            let qr = link.as_deref().and_then(music_core::share::qr_modules).map(|(n, m)| (n, m.iter().map(|&b| if b { '1' } else { '0' }).collect()));
            Status { role: Role::Host, room: h.room.clone(), host: h.name.clone(), people: h.host.people(), code: Some(code), link, qr, ..off }
        }
        Mode::Listen(l) => Status { role: Role::Listener, room: l.room.clone(), host: l.host.clone(), people: l.people.clone(), now: Some(l.local()), next: l.next.clone(), ..off },
    }
}

#[tauri::command]
pub async fn room_status(rooms: State<'_, Rooms>) -> CmdResult<Status> {
    Ok(status_of(&rooms.mode.lock().unwrap()))
}

/// The room's mDNS words again (who listens changed).
fn announce(app: &AppHandle) {
    let mode = rooms(app).mode.lock().unwrap();
    let Mode::Host(h) = &*mode else { return };
    if let Some(a) = &h.advert
        && let Err(e) = a.announce(&h.id, h.port, &rm::txt(&h.id, &h.room, &h.name, h.host.people().len()))
    {
        crate::diag::warn("rooms", "announce failed", &e.to_string());
    }
}

/// Leads a room from this device: a new code, listening on the local network, announced over mDNS.
#[tauri::command]
pub async fn room_start(app: AppHandle, rooms: State<'_, Rooms>) -> CmdResult<Status> {
    if !matches!(*rooms.mode.lock().unwrap(), Mode::Off) {
        return Err("Already in a room".into());
    }
    // All interfaces: listeners are other machines. Windows asks once to allow it on private networks.
    let listener = match TcpListener::bind((Ipv4Addr::UNSPECIFIED, wire::PORT)).await {
        Ok(l) => l,
        Err(_) => TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).await.map_err(err)?,
    };
    let port = listener.local_addr().map_err(err)?.port();
    let name = rm_name(&crate::syncmode::device_name());
    let (tx, mut rx) = mpsc::unbounded_channel();
    let host = Host::start(listener, name.clone(), name.clone(), rm::new_code(), tx);
    let advert = Advert::start().map_err(|e| crate::diag::warn("rooms", "mDNS failed", &e.to_string())).ok();
    let a = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        while let Some(e) = rx.recv().await {
            match e {
                HostEvent::Joined(_) | HostEvent::Left(_) => {
                    announce(&a);
                    emit(&a, Event::State);
                }
                HostEvent::NewCode(_) => emit(&a, Event::State),
                HostEvent::React { from, reaction } => emit(&a, Event::React { from, reaction }),
            }
        }
    });
    let status = {
        let mut mode = rooms.mode.lock().unwrap();
        // Two starts at once: the first one stays.
        if !matches!(*mode, Mode::Off) {
            task.abort();
            return Ok(status_of(&mode));
        }
        *mode = Mode::Host(Box::new(Hosting { host, id: rm::new_id(), room: name.clone(), name, port, advert, task }));
        status_of(&mode)
    };
    announce(&app);
    emit(&app, Event::State);
    Ok(status)
}

/// This device's name as the room says it.
fn rm_name(name: &str) -> String {
    music_core::devices::clean_name(name).unwrap_or_else(|| "Legato".into())
}

/// Ends the room led here: every listener hears it.
#[tauri::command]
pub async fn room_end(app: AppHandle, rooms: State<'_, Rooms>) -> CmdResult<()> {
    let taken = std::mem::take(&mut *rooms.mode.lock().unwrap());
    match taken {
        Mode::Host(h) => {
            let Hosting { host, advert, task, .. } = *h;
            task.abort();
            drop(advert);
            host.end().await;
        }
        other => *rooms.mode.lock().unwrap() = other,
    }
    emit(&app, Event::State);
    Ok(())
}

/// The host's player: what plays now (sent on a song change, play / pause, a seek). Its time is taken here.
#[tauri::command]
pub async fn room_host_now(rooms: State<'_, Rooms>, now: Now) -> CmdResult<()> {
    if let Mode::Host(h) = &*rooms.mode.lock().unwrap() {
        h.host.set_now(Now { song: now.song.and_then(|s| s.checked(allowed)), at: now_ms(), ..now });
    }
    Ok(())
}

/// The host's Up next, its first songs.
#[tauri::command]
pub async fn room_host_next(rooms: State<'_, Rooms>, songs: Vec<RoomSong>) -> CmdResult<()> {
    if let Mode::Host(h) = &*rooms.mode.lock().unwrap() {
        h.host.set_next(songs.into_iter().filter_map(|s| s.checked(allowed)).take(rm::UP_NEXT).collect());
    }
    Ok(())
}

/// A reaction from here, host or listener.
#[tauri::command]
pub async fn room_react(rooms: State<'_, Rooms>, reaction: Reaction) -> CmdResult<()> {
    match &*rooms.mode.lock().unwrap() {
        Mode::Host(h) => h.host.react(reaction),
        Mode::Listen(l) => l.link.send(ToHost::React { reaction }),
        Mode::Off => {}
    }
    Ok(())
}

/// Rooms on this network (3 s of listening).
#[tauri::command]
pub async fn rooms_nearby(rooms: State<'_, Rooms>) -> CmdResult<Vec<Heard>> {
    let found = wire::browse().await.map_err(err)?;
    let own = match &*rooms.mode.lock().unwrap() {
        Mode::Host(h) => Some(h.id.clone()),
        _ => None,
    };
    let found: Vec<_> = found.into_iter().filter(|(h, _)| Some(&h.id) != own.as_ref()).collect();
    *rooms.heard.lock().unwrap() = found.iter().map(|(h, a)| (h.id.clone(), a.clone())).collect();
    Ok(found.into_iter().map(|(h, _)| h).collect())
}

/// Joins a room heard (`id`) or scanned (`link`, its QR code) with its code.
#[tauri::command]
pub async fn room_join(app: AppHandle, rooms: State<'_, Rooms>, id: Option<String>, link: Option<String>, code: String) -> CmdResult<Status> {
    if !matches!(*rooms.mode.lock().unwrap(), Mode::Off) {
        return Err("Already in a room".into());
    }
    let (code, addrs) = match link.as_deref() {
        Some(text) => {
            let l = RoomLink::parse(text).ok_or("Not a Legato room code")?;
            (l.code, l.hosts.into_iter().map(SocketAddr::V4).collect::<Vec<_>>())
        }
        None => {
            let code = code.trim().replace(' ', "");
            if !music_core::devices::is_code(&code) {
                return Err("The code has 6 digits".into());
            }
            let heard = rooms.heard.lock().unwrap();
            let addrs = id.as_ref().and_then(|i| heard.get(i).cloned()).unwrap_or_default();
            (code, addrs)
        }
    };
    if addrs.is_empty() {
        return Err("No room on this network".into());
    }
    let Joined { welcome, link, mut messages } = wire::join(&addrs, &code, &rm_name(&crate::syncmode::device_name())).await.map_err(|e| {
        if e.is::<WrongCode>() {
            "Wrong code".to_string()
        } else if e.is::<Full>() {
            "This room is full".to_string()
        } else if e.is::<Shut>() {
            "Too many wrong codes".to_string()
        } else {
            err(e)
        }
    })?;
    let link = Arc::new(link);
    // Held while the tasks start: their first message finds the room set, and a start or join meanwhile stays.
    let mut mode = rooms.mode.lock().unwrap();
    if !matches!(*mode, Mode::Off) {
        return Err("Already in a room".into());
    }
    let a = app.clone();
    let reader = tauri::async_runtime::spawn(async move {
        let gone = loop {
            let Some(m) = messages.recv().await else { break true };
            if heard_from_host(&a, m) {
                break false;
            }
        };
        let was = std::mem::take(&mut *rooms_mode(&a));
        if let Mode::Listen(l) = was {
            // This task is one of them: the ping only.
            if let Some(ping) = l.tasks.get(1) {
                ping.abort();
            }
        }
        emit(&a, Event::End { gone });
        emit(&a, Event::State);
    });
    // Weak: Leave's goodbye needs the link alone (`room_leave`).
    let pinger: Weak<Link> = Arc::downgrade(&link);
    let ping = tauri::async_runtime::spawn(async move {
        let send = || pinger.upgrade().map(|l| l.send(ToHost::Ping { sent: now_ms() })).is_some();
        // Three quick round trips first: the offset known at once.
        for _ in 0..3 {
            if !send() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        loop {
            tokio::time::sleep(Duration::from_millis(rm::TICK_MS as u64)).await;
            if !send() {
                return;
            }
        }
    });
    *mode = Mode::Listen(Box::new(Listening { link, room: welcome.room, host: welcome.host, people: welcome.people, now: welcome.now, next: welcome.next, clock: Clock::default(), tasks: vec![reader, ping] }));
    let status = status_of(&mode);
    drop(mode);
    emit(&app, Event::State);
    Ok(status)
}

fn rooms_mode(app: &AppHandle) -> std::sync::MutexGuard<'_, Mode> {
    rooms(app).mode.lock().unwrap()
}

/// One message from the host. True: the room ended.
fn heard_from_host(app: &AppHandle, m: ToListener) -> bool {
    let mut mode = rooms_mode(app);
    let Mode::Listen(l) = &mut *mode else { return true };
    let out = match m {
        ToListener::Now { now } => {
            l.now = now;
            Event::Now { now: l.local() }
        }
        ToListener::Tick { position_ms, playing, at, seq } => {
            // A tick of another song than the one known here: the song's own message is on its way.
            if seq != l.now.seq {
                return false;
            }
            l.now = Now { position_ms, playing, at, ..l.now.clone() };
            Event::Now { now: l.local() }
        }
        ToListener::Pong { sent, at } => {
            let first = !l.clock.known();
            l.clock.add(sent, at, now_ms());
            if !first {
                return false;
            }
            // The first offset: the song's time on this clock.
            Event::Now { now: l.local() }
        }
        ToListener::Next { songs } => {
            l.next = songs.clone();
            Event::Next { songs }
        }
        ToListener::People { people } => {
            l.people = people;
            Event::State
        }
        ToListener::React { from, reaction } => Event::React { from, reaction },
        ToListener::End => return true,
        ToListener::Welcome { .. } => return false,
    };
    drop(mode);
    emit(app, out);
    false
}

/// Leaves the room joined.
#[tauri::command]
pub async fn room_leave(app: AppHandle, rooms: State<'_, Rooms>) -> CmdResult<()> {
    let taken = std::mem::take(&mut *rooms.mode.lock().unwrap());
    match taken {
        Mode::Listen(l) => {
            let Listening { link, tasks, .. } = *l;
            for t in &tasks {
                t.abort();
            }
            if let Ok(link) = Arc::try_unwrap(link) {
                link.leave().await;
            }
        }
        other => *rooms.mode.lock().unwrap() = other,
    }
    emit(&app, Event::State);
    Ok(())
}

/// A room's song on this side: the listener's library (ISRC, the same YouTube id, then title + artist + duration), the
/// YouTube video itself, else ONE YouTube search, paced (`searchpace`: never quicker; a refusal means "not found here").
/// `now`: it plays now (a search waits out the pace's gap); else ahead of time (no search unless the pace is ready).
#[tauri::command]
pub async fn room_resolve(state: State<'_, AppState>, rooms: State<'_, Rooms>, song: RoomSong, now: bool) -> CmdResult<Find> {
    let Some(song) = song.checked(allowed) else { return Ok(Find::Missing) };
    let track = song.track();
    if let Some(id) = state.lib().find(&track).map_err(err)? {
        return Ok(Find::Library { id });
    }
    if track.ids.contains_key(&Source::Youtube) {
        return Ok(Find::Track { track });
    }
    if let Ok(Some(video)) = state.lib().known_youtube(&track) {
        let mut t = track;
        t.ids.insert(Source::Youtube, video);
        return Ok(Find::Track { track: t });
    }
    let mut pace = rooms.pace.lock().await;
    if !pace.wait_left(Instant::now()).is_zero() {
        return Ok(if now { Find::Missing } else { Find::Later });
    }
    if !pace.ready(Instant::now()) {
        if !now {
            return Ok(Find::Later);
        }
        let until = Instant::now() + GAP_WAIT;
        while !pace.ready(Instant::now()) {
            if Instant::now() >= until {
                return Ok(Find::Missing);
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }
    pace.started(Instant::now());
    let Some(answer) = crate::youtube_version(&state, &track).await else {
        pace.refused(Instant::now());
        crate::diag::warn("rooms", "YouTube refused a search", "");
        return Ok(Find::Missing);
    };
    pace.answered(Instant::now());
    let found = answer.song;
    Ok(if found.ids.contains_key(&Source::Youtube) || found.ids.contains_key(&Source::Spotify) { Find::Track { track: found } } else { Find::Missing })
}
