//! Listening rooms on the local network, the wire (`docs/rooms.md`): a version in clear, the host's word (go, full,
//! another version), SPAKE2 from the room's 6-digit code (one handshake per listener), then ChaCha20-Poly1305 sealed
//! frames both ways, each length checked before it is read. Presence over mDNS (`_legatoroom._tcp`). Messages and rules: `music_core::rooms`; shell: `src-tauri` `rooms.rs`.

use crate::nearby::{read_frame_max, write_frame};
use anyhow::{Result, anyhow, bail};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use music_core::library::now_ms;
use music_core::remote::private;
use music_core::rooms::{self as rm, Heard, Now, Reaction, RoomSong, ToHost, ToListener};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use spake2::{Ed25519Group, Identity, Password, Spake2};
use std::fmt;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Semaphore, mpsc, watch};
use tokio::task::JoinHandle;
use tokio::time::timeout;

pub const SERVICE: &str = "_legatoroom._tcp.local.";
/// Listened on when free; another port else (mDNS and the QR code say which).
pub const PORT: u16 = 47823;
const ROOM_ID: &[u8] = b"legato-room-v1";
const OPENING_MAX: u32 = 256;
const SPAKE_MAX: u32 = 256;
const TAG: u32 = 16;
const STEP: Duration = Duration::from_secs(10);
/// Handshakes answered at once (members don't count).
const AT_ONCE: usize = 4;
/// A listener silent this long (it pings every tick) is gone; a host too (it ticks).
const SILENT: Duration = Duration::from_millis(3 * rm::TICK_MS as u64);
/// One reaction per listener this often at most (ms): no flood.
const REACT_GAP: i64 = 400;
/// The host's word after the opening.
const GO: u8 = 1;
const FULL: u8 = 3;
const OLD: u8 = 4;
const SHUT: u8 = 5;

#[derive(Serialize, Deserialize)]
struct Opening {
    v: u32,
}

/// The code was wrong: the host counts a try.
#[derive(Debug)]
pub struct WrongCode;

/// 8 listeners already.
#[derive(Debug)]
pub struct Full;

/// Too many wrong codes lately: joins shut a while (`rooms::shut_ms`).
#[derive(Debug)]
pub struct Shut;

impl fmt::Display for Shut {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("Too many wrong codes")
    }
}

impl std::error::Error for Shut {}

impl fmt::Display for WrongCode {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("Wrong code")
    }
}

impl fmt::Display for Full {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("This room is full")
    }
}

impl std::error::Error for WrongCode {}
impl std::error::Error for Full {}

fn cipher(key: &[u8]) -> Result<ChaCha20Poly1305> {
    ChaCha20Poly1305::new_from_slice(&Sha256::new().chain_update(b"legato-room-session-v1").chain_update(key).finalize()[..]).map_err(|_| anyhow!("Bad key"))
}

/// One direction's nonce: who sends, then a counter.
fn nonce(from_host: bool, n: u64) -> Nonce {
    let mut b = [0u8; 12];
    b[0] = u8::from(!from_host);
    b[4..].copy_from_slice(&n.to_be_bytes());
    Nonce::from(b)
}

/// The sending half of a sealed connection.
struct Seal {
    w: OwnedWriteHalf,
    cipher: ChaCha20Poly1305,
    host: bool,
    n: u64,
}

impl Seal {
    async fn send(&mut self, data: &[u8]) -> Result<()> {
        let sealed = self.cipher.encrypt(&nonce(self.host, self.n), data).map_err(|_| anyhow!("Encrypt failed"))?;
        self.n += 1;
        write_frame(&mut self.w, &sealed).await
    }
}

/// The reading half.
struct Opener {
    r: OwnedReadHalf,
    cipher: ChaCha20Poly1305,
    host: bool,
    n: u64,
}

impl Opener {
    async fn recv(&mut self) -> Result<Vec<u8>> {
        let sealed = read_frame_max(&mut self.r, rm::FRAME_MAX + TAG).await?;
        let data = self.cipher.decrypt(&nonce(!self.host, self.n), sealed.as_slice()).map_err(|_| WrongCode)?;
        self.n += 1;
        Ok(data)
    }
}

async fn spake(s: &mut TcpStream, code: &str) -> Result<Vec<u8>> {
    let (spake, msg) = Spake2::<Ed25519Group>::start_symmetric(&Password::new(code.as_bytes()), &Identity::new(ROOM_ID));
    write_frame(s, &msg).await?;
    spake.finish(&read_frame_max(s, SPAKE_MAX).await?).map_err(|e| anyhow!("Handshake failed: {e:?}"))
}

fn halves(s: TcpStream, key: &[u8], host: bool) -> Result<(Opener, Seal)> {
    let c = cipher(key)?;
    let (r, w) = s.into_split();
    Ok((Opener { r, cipher: c.clone(), host, n: 0 }, Seal { w, cipher: c, host, n: 0 }))
}

/// What the host's shell hears.
#[derive(Debug, Clone, PartialEq)]
pub enum HostEvent {
    Joined(String),
    Left(String),
    React { from: String, reaction: Reaction },
    /// Too many wrong codes: this one shows now.
    NewCode(String),
}

struct Member {
    id: u64,
    name: String,
    tx: mpsc::UnboundedSender<Vec<u8>>,
}

struct Room {
    room: String,
    host: String,
    code: String,
    tries: u8,
    /// New codes so far, and joins shut until then (unix ms): guesses limited, not only the code changed.
    changed: u32,
    shut_until: i64,
    members: Vec<Member>,
    now: Now,
    next: Vec<RoomSong>,
    ids: u64,
    events: mpsc::UnboundedSender<HostEvent>,
}

impl Room {
    fn people(&self) -> Vec<String> {
        self.members.iter().map(|m| m.name.clone()).collect()
    }

    /// To every listener but `except`.
    fn broadcast(&self, m: &ToListener, except: Option<u64>) {
        let Some(bytes) = rm::encode(m) else { return };
        for x in self.members.iter().filter(|x| Some(x.id) != except) {
            let _ = x.tx.send(bytes.clone());
        }
    }

    fn wrong(&mut self) {
        self.tries += 1;
        if self.tries >= rm::MAX_TRIES {
            self.tries = 0;
            self.code = rm::new_code();
            self.shut_until = now_ms() + rm::shut_ms(self.changed);
            self.changed = self.changed.saturating_add(1);
            let _ = self.events.send(HostEvent::NewCode(self.code.clone()));
        }
    }

    fn leave(&mut self, id: u64) {
        let Some(at) = self.members.iter().position(|m| m.id == id) else { return };
        let m = self.members.remove(at);
        let _ = self.events.send(HostEvent::Left(m.name));
        self.broadcast(&ToListener::People { people: self.people() }, None);
    }
}

/// A room led here. Its listener closes and every listener hears the end on `end` (or drop: no end said).
pub struct Host {
    room: Arc<Mutex<Room>>,
    tasks: Vec<JoinHandle<()>>,
    /// Dropped with the host: every connection's task stops (handshakes too), whatever its listener still sends.
    _open: watch::Sender<()>,
}

impl Host {
    /// Leads a room on `listener` under `code`; what happens comes on `events`.
    pub fn start(listener: TcpListener, room: String, host: String, code: String, events: mpsc::UnboundedSender<HostEvent>) -> Host {
        let r = Arc::new(Mutex::new(Room { room, host, code, tries: 0, changed: 0, shut_until: 0, members: Vec::new(), now: Now { at: now_ms(), ..Now::default() }, next: Vec::new(), ids: 0, events }));
        let (open, closed) = watch::channel(());
        let shared = r.clone();
        let accept = tokio::spawn(async move {
            let gate = Arc::new(Semaphore::new(AT_ONCE));
            loop {
                let Ok((s, from)) = listener.accept().await else {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    continue;
                };
                // Only this network; a few handshakes at a time.
                if !private(from.ip()) {
                    continue;
                }
                let Ok(permit) = gate.clone().try_acquire_owned() else { continue };
                let shared = shared.clone();
                let mut gone = closed.clone();
                tokio::spawn(async move {
                    tokio::select! {
                        () = serve(shared, s, permit) => {}
                        _ = gone.changed() => {}
                    }
                });
            }
        });
        let shared = r.clone();
        let tick = tokio::spawn(async move {
            let mut every = tokio::time::interval(Duration::from_millis(rm::TICK_MS as u64));
            every.tick().await;
            loop {
                every.tick().await;
                let room = shared.lock().unwrap();
                let t = now_ms();
                let n = &room.now;
                room.broadcast(&ToListener::Tick { position_ms: n.position_at(t), playing: n.playing, at: t, seq: n.seq }, None);
            }
        });
        Host { room: r, tasks: vec![accept, tick], _open: open }
    }

    pub fn code(&self) -> String {
        self.room.lock().unwrap().code.clone()
    }

    pub fn people(&self) -> Vec<String> {
        self.room.lock().unwrap().people()
    }

    /// What plays here now (song change, play / pause, seek): kept for newcomers, sent to everyone.
    pub fn set_now(&self, now: Now) {
        let mut room = self.room.lock().unwrap();
        room.now = now.clone();
        room.broadcast(&ToListener::Now { now }, None);
    }

    /// Up next's first songs, sent when they changed.
    pub fn set_next(&self, mut songs: Vec<RoomSong>) {
        songs.truncate(rm::UP_NEXT);
        let mut room = self.room.lock().unwrap();
        if room.next != songs {
            room.next = songs.clone();
            room.broadcast(&ToListener::Next { songs }, None);
        }
    }

    /// The host's own reaction, to everyone.
    pub fn react(&self, reaction: Reaction) {
        let room = self.room.lock().unwrap();
        room.broadcast(&ToListener::React { from: room.host.clone(), reaction }, None);
    }

    /// The room ends: everyone hears it, the listener closes.
    pub async fn end(self) {
        self.room.lock().unwrap().broadcast(&ToListener::End, None);
        drop(self);
        // Their writers finish what they hold (the end), then close.
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

impl Drop for Host {
    /// No more listening, ticks or members: each writer closes once its messages are out, each listener sees the end
    /// of its connection.
    fn drop(&mut self) {
        for t in &self.tasks {
            t.abort();
        }
        if let Ok(mut room) = self.room.lock() {
            room.members.clear();
        }
    }
}

async fn serve(room: Arc<Mutex<Room>>, mut s: TcpStream, permit: tokio::sync::OwnedSemaphorePermit) {
    let Ok(Ok(raw)) = timeout(STEP, read_frame_max(&mut s, OPENING_MAX)).await else { return };
    let Ok(open) = serde_json::from_slice::<Opening>(&raw) else { return };
    if open.v != rm::VERSION {
        let _ = s.write_u8(OLD).await;
        return;
    }
    let (full, shut, code) = {
        let r = room.lock().unwrap();
        (r.members.len() >= rm::LISTENERS_MAX, now_ms() < r.shut_until, r.code.clone())
    };
    if full {
        let _ = s.write_u8(FULL).await;
        return;
    }
    if shut {
        let _ = s.write_u8(SHUT).await;
        return;
    }
    let Ok(()) = s.write_u8(GO).await else { return };
    let Ok(Ok(key)) = timeout(STEP, spake(&mut s, &code)).await else { return };
    let Ok((mut opener, mut seal)) = halves(s, &key, true) else { return };
    // Its hello unopened (or none at all): a guess, a try spent.
    let name = match timeout(STEP, opener.recv()).await {
        Ok(Ok(raw)) => match ToHost::read(&raw) {
            Some(ToHost::Hello { name }) => name,
            _ => return,
        },
        _ => return room.lock().unwrap().wrong(),
    };
    drop(permit);
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let id = {
        let mut r = room.lock().unwrap();
        if r.members.len() >= rm::LISTENERS_MAX {
            return;
        }
        r.ids += 1;
        let id = r.ids;
        let welcome = ToListener::Welcome { room: r.room.clone(), host: r.host.clone(), people: r.people().into_iter().chain([name.clone()]).collect(), now: r.now.clone(), next: r.next.clone() };
        let Some(bytes) = rm::encode(&welcome) else { return };
        let _ = tx.send(bytes);
        r.members.push(Member { id, name: name.clone(), tx });
        let _ = r.events.send(HostEvent::Joined(name.clone()));
        r.broadcast(&ToListener::People { people: r.people() }, Some(id));
        id
    };
    let writer = tokio::spawn(async move {
        while let Some(bytes) = rx.recv().await {
            if seal.send(&bytes).await.is_err() {
                break;
            }
        }
        let _ = seal.w.shutdown().await;
    });
    let mut last_react = 0;
    loop {
        let Ok(Ok(raw)) = timeout(SILENT, opener.recv()).await else { break };
        match ToHost::read(&raw) {
            Some(ToHost::Ping { sent }) => {
                let r = room.lock().unwrap();
                if let (Some(m), Some(bytes)) = (r.members.iter().find(|m| m.id == id), rm::encode(&ToListener::Pong { sent, at: now_ms() })) {
                    let _ = m.tx.send(bytes);
                }
            }
            Some(ToHost::React { reaction }) => {
                let t = now_ms();
                if t - last_react < REACT_GAP {
                    continue;
                }
                last_react = t;
                let r = room.lock().unwrap();
                r.broadcast(&ToListener::React { from: name.clone(), reaction }, Some(id));
                let _ = r.events.send(HostEvent::React { from: name.clone(), reaction });
            }
            Some(ToHost::Leave) | None => break,
            Some(ToHost::Hello { .. }) => {}
        }
    }
    room.lock().unwrap().leave(id);
    let _ = writer.await;
}

/// What a listener got on joining.
#[derive(Debug, Clone, PartialEq)]
pub struct Welcome {
    pub room: String,
    pub host: String,
    pub people: Vec<String>,
    pub now: Now,
    pub next: Vec<RoomSong>,
}

/// A room joined: its welcome, the way to the host, the host's messages (closed: the host is gone).
pub struct Joined {
    pub welcome: Welcome,
    pub link: Link,
    pub messages: mpsc::UnboundedReceiver<ToListener>,
}

/// The way to the host. Dropped: the connection closes.
pub struct Link {
    tx: mpsc::UnboundedSender<ToHost>,
    tasks: Vec<JoinHandle<()>>,
}

impl Link {
    pub fn send(&self, m: ToHost) {
        let _ = self.tx.send(m);
    }

    /// Says goodbye, then closes.
    pub async fn leave(mut self) {
        let _ = self.tx.send(ToHost::Leave);
        let writer = self.tasks.remove(0);
        let _ = timeout(Duration::from_secs(2), writer).await;
    }
}

impl Drop for Link {
    fn drop(&mut self) {
        for t in &self.tasks {
            t.abort();
        }
    }
}

/// `silent`: the host heard of (ticks every 5 s) at least this often, else gone (asleep, off the network).
async fn join_at(addr: SocketAddr, code: &str, name: &str, silent: Duration) -> Result<Joined> {
    let mut s = timeout(STEP, TcpStream::connect(addr)).await.map_err(|_| anyhow!("Unreachable"))??;
    write_frame(&mut s, &serde_json::to_vec(&Opening { v: rm::VERSION })?).await?;
    match timeout(STEP, s.read_u8()).await.map_err(|_| anyhow!("No answer"))?? {
        GO => {}
        FULL => return Err(Full.into()),
        OLD => bail!("This room runs another version of Legato"),
        SHUT => return Err(Shut.into()),
        _ => bail!("Not a room"),
    }
    let key = timeout(STEP, spake(&mut s, code)).await.map_err(|_| anyhow!("No answer"))??;
    let (mut opener, mut seal) = halves(s, &key, false)?;
    seal.send(&rm::encode(&ToHost::Hello { name: name.to_string() }).ok_or_else(|| anyhow!("Name too long"))?).await?;
    // Closed or unopened: the host couldn't read the hello, the code was wrong.
    let raw = timeout(STEP, opener.recv()).await.map_err(|_| WrongCode)?.map_err(|_| WrongCode)?;
    let Some(ToListener::Welcome { room, host, people, now, next }) = ToListener::read(&raw, crate::art::allowed) else { bail!("Not a room") };
    let (tx, mut out) = mpsc::unbounded_channel::<ToHost>();
    let writer = tokio::spawn(async move {
        while let Some(m) = out.recv().await {
            let leave = m == ToHost::Leave;
            let Some(bytes) = rm::encode(&m) else { continue };
            if seal.send(&bytes).await.is_err() || leave {
                break;
            }
        }
        let _ = seal.w.shutdown().await;
    });
    let (into, messages) = mpsc::unbounded_channel();
    let reader = tokio::spawn(async move {
        while let Ok(Ok(raw)) = timeout(silent, opener.recv()).await {
            let Some(m) = ToListener::read(&raw, crate::art::allowed) else { continue };
            let end = m == ToListener::End;
            if into.send(m).is_err() || end {
                break;
            }
        }
    });
    Ok(Joined { welcome: Welcome { room, host, people, now, next }, link: Link { tx, tasks: vec![writer, reader] }, messages })
}

/// Joins the room at `addrs` (one room's, in turn) with `code`. Stops at a wrong code, a full or shut room: another address
/// of the same host would only spend another try.
pub async fn join(addrs: &[SocketAddr], code: &str, name: &str) -> Result<Joined> {
    let mut last = anyhow!("No room on this network");
    for addr in addrs {
        match join_at(*addr, code, name, SILENT).await {
            Ok(j) => return Ok(j),
            Err(e) if e.is::<WrongCode>() || e.is::<Full>() || e.is::<Shut>() => return Err(e),
            Err(e) => last = e,
        }
    }
    Err(last)
}

fn instance(id: &str) -> String {
    format!("legatoroom-{id}")
}

/// A room announced on mDNS. Withdrawn on drop.
pub struct Advert {
    daemon: ServiceDaemon,
}

impl Advert {
    pub fn start() -> Result<Advert> {
        Ok(Advert { daemon: ServiceDaemon::new()? })
    }

    /// Announces the room, or its new words (same name: an update).
    pub fn announce(&self, id: &str, port: u16, words: &[(&'static str, String)]) -> Result<()> {
        let name = instance(id);
        let props: Vec<(&str, &str)> = words.iter().map(|(k, v)| (*k, v.as_str())).collect();
        self.daemon.register(ServiceInfo::new(SERVICE, &name, &format!("{name}.local."), "", port, &props[..])?.enable_addr_auto())?;
        Ok(())
    }
}

impl Drop for Advert {
    fn drop(&mut self) {
        let _ = self.daemon.shutdown();
    }
}

/// Rooms on this network (3 s of mDNS), each with its private IPv4 addresses.
pub async fn browse() -> Result<Vec<(Heard, Vec<SocketAddr>)>> {
    let daemon = ServiceDaemon::new()?;
    let events = daemon.browse(SERVICE)?;
    let found = tokio::task::spawn_blocking(move || {
        let end = std::time::Instant::now() + Duration::from_secs(3);
        let mut out: Vec<(Heard, Vec<SocketAddr>)> = Vec::new();
        while let Some(left) = end.checked_duration_since(std::time::Instant::now()) {
            match events.recv_timeout(left) {
                Ok(ServiceEvent::ServiceResolved(r)) => {
                    let Some(h) = rm::heard(|k| r.get_property_val_str(k).map(str::to_string)) else { continue };
                    let mut addrs: Vec<SocketAddr> = r.get_addresses_v4().into_iter().filter(|ip| private(IpAddr::V4(*ip))).map(|ip| SocketAddr::from((ip, r.get_port()))).collect();
                    addrs.sort();
                    if addrs.is_empty() {
                        continue;
                    }
                    out.retain(|(x, _)| x.id != h.id);
                    out.push((h, addrs));
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        out
    })
    .await?;
    let _ = daemon.shutdown();
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CODE: &str = "042917";

    fn song(title: &str) -> RoomSong {
        RoomSong { title: title.into(), artist: "Band".into(), youtube: Some("dQw4w9WgXcQ".into()), ..RoomSong::default() }
    }

    async fn host() -> (Host, SocketAddr, mpsc::UnboundedReceiver<HostEvent>) {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        let (tx, rx) = mpsc::unbounded_channel();
        (Host::start(l, "Salon".into(), "TOUR".into(), CODE.into(), tx), addr, rx)
    }

    async fn next(rx: &mut mpsc::UnboundedReceiver<ToListener>) -> ToListener {
        loop {
            let m = timeout(Duration::from_secs(5), rx.recv()).await.expect("a message").expect("open");
            if !matches!(m, ToListener::Tick { .. }) {
                return m;
            }
        }
    }

    async fn event(rx: &mut mpsc::UnboundedReceiver<HostEvent>) -> HostEvent {
        timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap()
    }

    #[tokio::test]
    async fn a_host_and_two_listeners_follow_one_song() {
        let (host, addr, mut ev) = host().await;
        host.set_now(Now { song: Some(song("First")), position_ms: 5000, playing: true, at: now_ms(), seq: 1 });
        host.set_next(vec![song("Second"), song("Third"), song("Fourth"), song("Fifth")]);
        let mut a = join(&[addr], CODE, "Phone").await.unwrap();
        assert_eq!(a.welcome.room, "Salon");
        assert_eq!(a.welcome.host, "TOUR");
        assert_eq!(a.welcome.people, vec!["Phone".to_string()]);
        assert_eq!(a.welcome.now.song.as_ref().unwrap().title, "First");
        assert_eq!(a.welcome.next.len(), rm::UP_NEXT, "three ahead");
        assert_eq!(event(&mut ev).await, HostEvent::Joined("Phone".into()));
        let mut b = join(&[addr], CODE, "Laptop").await.unwrap();
        assert_eq!(b.welcome.people, vec!["Phone".to_string(), "Laptop".to_string()]);
        assert_eq!(next(&mut a.messages).await, ToListener::People { people: vec!["Phone".into(), "Laptop".into()] });
        assert_eq!(host.people(), vec!["Phone".to_string(), "Laptop".to_string()]);
        let paused = Now { song: Some(song("First")), position_ms: 9000, playing: false, at: now_ms(), seq: 2 };
        host.set_now(paused.clone());
        assert_eq!(next(&mut a.messages).await, ToListener::Now { now: paused.clone() });
        assert_eq!(next(&mut b.messages).await, ToListener::Now { now: paused });
        // A reaction: the other listener and the host hear it, not its sender.
        a.link.send(ToHost::React { reaction: Reaction::Fire });
        assert_eq!(next(&mut b.messages).await, ToListener::React { from: "Phone".into(), reaction: Reaction::Fire });
        assert_eq!(event(&mut ev).await, HostEvent::Joined("Laptop".into()));
        assert_eq!(event(&mut ev).await, HostEvent::React { from: "Phone".into(), reaction: Reaction::Fire });
        // The clock: a ping comes back with the host's time.
        let sent = now_ms();
        b.link.send(ToHost::Ping { sent });
        let ToListener::Pong { sent: back, at } = next(&mut b.messages).await else { panic!() };
        assert_eq!(back, sent);
        assert!((at - sent).abs() < 2000);
        // One leaves: the others hear who's left.
        b.link.leave().await;
        assert_eq!(event(&mut ev).await, HostEvent::Left("Laptop".into()));
        assert_eq!(next(&mut a.messages).await, ToListener::People { people: vec!["Phone".into()] });
    }

    #[tokio::test]
    async fn a_wrong_code_is_refused_and_too_many_change_it() {
        let (host, addr, mut ev) = host().await;
        for _ in 0..rm::MAX_TRIES - 1 {
            let e = join(&[addr], "111111", "Guess").await.err().unwrap();
            assert!(e.is::<WrongCode>(), "{e}");
        }
        assert_eq!(host.code(), CODE, "still the same");
        assert!(join(&[addr], "222222", "Guess").await.err().unwrap().is::<WrongCode>());
        let HostEvent::NewCode(code) = event(&mut ev).await else { panic!() };
        assert_ne!(code, CODE);
        assert_eq!(host.code(), code);
        // Shut a while, the right code too: a new code alone would leave guesses unlimited.
        assert!(join(&[addr], &code, "Phone").await.err().unwrap().is::<Shut>(), "shut");
        let until = host.room.lock().unwrap().shut_until;
        assert!(until - now_ms() > rm::shut_ms(0) - 5_000, "the first wait");
        host.room.lock().unwrap().shut_until = 0;
        assert!(join(&[addr], CODE, "Late").await.err().unwrap().is::<WrongCode>(), "the old code no longer works");
        assert_eq!(join(&[addr], &code, "Phone").await.unwrap().welcome.people, vec!["Phone".to_string()]);
        // The next new code shuts longer.
        for _ in 0..rm::MAX_TRIES {
            let _ = join(&[addr], "111111", "Guess").await;
        }
        assert!(host.room.lock().unwrap().shut_until - now_ms() > rm::shut_ms(1) - 5_000);
    }

    #[tokio::test]
    async fn a_full_room_says_so() {
        let (_host, addr, _ev) = host().await;
        let mut in_room = Vec::new();
        for i in 0..rm::LISTENERS_MAX {
            in_room.push(join(&[addr], CODE, &format!("Friend {i}")).await.unwrap());
        }
        let e = join(&[addr], CODE, "One more").await.err().unwrap();
        assert!(e.is::<Full>(), "{e}");
    }

    #[tokio::test]
    async fn the_host_ending_ends_it_for_everyone() {
        let (host, addr, _ev) = host().await;
        let mut a = join(&[addr], CODE, "Phone").await.unwrap();
        let mut b = join(&[addr], CODE, "Laptop").await.unwrap();
        let _ = next(&mut a.messages).await; // Laptop came in.
        host.end().await;
        assert_eq!(next(&mut a.messages).await, ToListener::End);
        assert_eq!(next(&mut b.messages).await, ToListener::End);
        assert!(timeout(Duration::from_secs(5), a.messages.recv()).await.unwrap().is_none(), "closed after");
    }

    #[tokio::test]
    async fn a_host_gone_without_a_word_closes_the_messages() {
        let (host, addr, _ev) = host().await;
        let mut a = join(&[addr], CODE, "Phone").await.unwrap();
        drop(host);
        assert!(timeout(Duration::from_secs(5), a.messages.recv()).await.unwrap().is_none(), "no end said, the connection closed");
    }

    #[tokio::test]
    async fn a_room_gone_leaves_no_task_reading() {
        let (host, addr, _ev) = host().await;
        let mut a = join(&[addr], CODE, "Phone").await.unwrap();
        drop(host);
        assert!(timeout(Duration::from_secs(5), a.messages.recv()).await.unwrap().is_none());
        // Still pinging: the host's side closed all the same, so the writes fail.
        for _ in 0..50 {
            a.link.send(ToHost::Ping { sent: now_ms() });
            if a.link.tasks[0].is_finished() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        panic!("the room gone still reads its listener");
    }

    #[tokio::test]
    async fn a_host_gone_quiet_closes_the_messages() {
        let (_host, addr, _ev) = host().await;
        // Its first tick in 5 s: watched every 300 ms, it went (asleep, off the network).
        let mut a = join_at(addr, CODE, "Phone", Duration::from_millis(300)).await.unwrap();
        assert!(timeout(Duration::from_secs(3), a.messages.recv()).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn another_version_is_told_before_the_code() {
        let (_host, addr, _ev) = host().await;
        let mut s = TcpStream::connect(addr).await.unwrap();
        write_frame(&mut s, br#"{"v":99}"#).await.unwrap();
        assert_eq!(s.read_u8().await.unwrap(), OLD);
    }

    #[tokio::test]
    async fn a_big_frame_before_the_code_is_never_read() {
        let (_host, addr, _ev) = host().await;
        let mut s = TcpStream::connect(addr).await.unwrap();
        s.write_u32(64 << 20).await.unwrap();
        // Closed without an answer.
        assert!(timeout(Duration::from_secs(5), s.read_u8()).await.unwrap().is_err());
    }
}
