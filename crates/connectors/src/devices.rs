//! Your devices on the same network, the wire (Sync Mode v2, `docs/sync-mode.md`): a hello in clear, SPAKE2 from the
//! 6-digit code (pairing) or from the pair key (trusted), then sealed messages: both intros, both snapshots, an ack.
//! Presence over mDNS (`_legato._tcp`). Kinds and rules: `music_core::devices`; shell: `src-tauri` `devices.rs`.

use crate::nearby::{read_frame_max, write_frame};
use anyhow::{Result, anyhow, bail, ensure};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use music_core::devices::{Card, Heard, heard};
use music_core::remote::private;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use spake2::{Ed25519Group, Identity, Password, Spake2};
use std::fmt;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

pub const SERVICE: &str = "_legato._tcp.local.";
/// Listened on when free; another port else (mDNS and the QR code say which).
pub const PORT: u16 = 47822;
const VERSION: u32 = 2;
const PAIR_ID: &[u8] = b"legato-pair-v2";
const HELLO_MAX: u32 = 1024;
const SPAKE_MAX: u32 = 256;
const INTRO_MAX: u32 = 4096;
const SNAPSHOT_MAX: u32 = 64 << 20;
const TAG: u32 = 16;
const STEP: Duration = Duration::from_secs(10);
const SWAP: Duration = Duration::from_secs(60);
/// The listener's word after a hello: go on; not you (unknown device, or no code shown); not the device asked for.
const GO: u8 = 1;
const NO: u8 = 0;
const ELSE: u8 = 2;

/// Sealed, each side's first message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Intro {
    pub card: Card,
    /// Where it listens; 0 = not listening.
    pub port: u16,
    /// Trusts the other (pairing): a pair key is kept only when both do.
    pub trust: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Hello {
    Pair,
    Sync { from: String, to: String },
}

#[derive(Serialize, Deserialize)]
struct Envelope {
    v: u32,
    #[serde(flatten)]
    hello: Hello,
}

/// The code was wrong (pairing): the offer counts a try.
#[derive(Debug)]
pub struct WrongCode;

/// The device doesn't know this one any more (it forgot it), or shows no code now.
#[derive(Debug)]
pub struct Refused;

impl fmt::Display for WrongCode {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("Wrong code")
    }
}

impl fmt::Display for Refused {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("The other device said no")
    }
}

impl std::error::Error for WrongCode {}
impl std::error::Error for Refused {}

/// A sealed session: one key, a counter nonce per direction.
pub struct Session {
    s: TcpStream,
    cipher: ChaCha20Poly1305,
    server: bool,
    sent: u64,
    got: u64,
}

impl Session {
    fn new(s: TcpStream, key: &[u8], server: bool) -> Result<Session> {
        let cipher = ChaCha20Poly1305::new_from_slice(&Sha256::new().chain_update(b"legato-session-v2").chain_update(key).finalize()[..]).map_err(|_| anyhow!("Bad key"))?;
        Ok(Session { s, cipher, server, sent: 0, got: 0 })
    }

    fn nonce(from_server: bool, n: u64) -> Nonce {
        let mut b = [0u8; 12];
        b[0] = u8::from(!from_server);
        b[4..].copy_from_slice(&n.to_be_bytes());
        Nonce::from(b)
    }

    async fn send(&mut self, data: &[u8]) -> Result<()> {
        let sealed = self.cipher.encrypt(&Self::nonce(self.server, self.sent), data).map_err(|_| anyhow!("Encrypt failed"))?;
        self.sent += 1;
        write_frame(&mut self.s, &sealed).await
    }

    async fn recv(&mut self, max: u32) -> Result<Vec<u8>> {
        let sealed = read_frame_max(&mut self.s, max + TAG).await?;
        let data = self.cipher.decrypt(&Self::nonce(!self.server, self.got), sealed.as_slice()).map_err(|_| WrongCode)?;
        self.got += 1;
        Ok(data)
    }

    /// The other side's address.
    pub fn peer_addr(&self) -> Option<SocketAddr> {
        self.s.peer_addr().ok()
    }

    /// Both snapshots swapped: the listener's first, then the other's, then the listener's ack.
    pub async fn swap(mut self, mine: &[u8]) -> Result<Vec<u8>> {
        timeout(SWAP, async {
            if self.server {
                self.send(mine).await?;
                let theirs = self.recv(SNAPSHOT_MAX).await?;
                self.s.write_u8(GO).await?;
                Ok(theirs)
            } else {
                let theirs = self.recv(SNAPSHOT_MAX).await?;
                self.send(mine).await?;
                ensure!(self.s.read_u8().await? == GO, "No ack");
                Ok(theirs)
            }
        })
        .await
        .map_err(|_| anyhow!("The other device stopped answering"))?
    }
}

/// SPAKE2 both ways: the session's shared key.
async fn spake(s: &mut TcpStream, password: &[u8], id: &[u8]) -> Result<Vec<u8>> {
    let (spake, msg) = Spake2::<Ed25519Group>::start_symmetric(&Password::new(password), &Identity::new(id));
    write_frame(s, &msg).await?;
    spake.finish(&read_frame_max(s, SPAKE_MAX).await?).map_err(|e| anyhow!("Handshake failed: {e:?}"))
}

/// The key kept for a trusted device: from the pairing's session key, one way.
fn pair_key(session_key: &[u8]) -> [u8; 32] {
    let mut k = [0u8; 32];
    k.copy_from_slice(&Sha256::new().chain_update(b"legato-pair-key-v2").chain_update(session_key).finalize()[..]);
    k
}

/// A trusted session's SPAKE2 identity: both ids, in order.
fn sync_id(a: &str, b: &str) -> Vec<u8> {
    let (lo, hi) = if a < b { (a, b) } else { (b, a) };
    format!("legato-sync-v2:{lo}:{hi}").into_bytes()
}

fn checked(raw: &[u8]) -> Result<Intro> {
    let intro: Intro = serde_json::from_slice(raw)?;
    let card = intro.card.checked().ok_or_else(|| anyhow!("Bad intro"))?;
    Ok(Intro { card, ..intro })
}

/// Pairing done: the session (snapshots next), the other's intro, the key to keep if both trust.
pub struct Paired {
    pub session: Session,
    pub theirs: Intro,
    pub key: [u8; 32],
}

/// A connection to this device's listener, its hello read.
pub struct Incoming {
    s: TcpStream,
    pub hello: Hello,
}

/// Reads a connection's hello (1 KB, 10 s at most).
pub async fn incoming(mut s: TcpStream) -> Result<Incoming> {
    let raw = timeout(STEP, read_frame_max(&mut s, HELLO_MAX)).await.map_err(|_| anyhow!("No hello"))??;
    let env: Envelope = serde_json::from_slice(&raw)?;
    ensure!(env.v == VERSION, "Another version");
    Ok(Incoming { s, hello: env.hello })
}

impl Incoming {
    /// Unknown device, or no code shown here: said, then closed.
    pub async fn refuse(mut self) {
        let _ = self.s.write_u8(NO).await;
    }

    /// Asked for another device (an old address): said, then closed.
    pub async fn not_me(mut self) {
        let _ = self.s.write_u8(ELSE).await;
    }

    /// Pairing with the code shown here. `WrongCode`: count a try.
    pub async fn pair(mut self, code: &str, mine: &Intro) -> Result<Paired> {
        timeout(STEP, async {
            self.s.write_u8(GO).await?;
            let key = spake(&mut self.s, code.as_bytes(), PAIR_ID).await?;
            let mut session = Session::new(self.s, &key, true)?;
            session.send(&serde_json::to_vec(mine)?).await?;
            // No intro back (wrong code on that side, or gone): a try all the same, it guessed.
            let theirs = checked(&session.recv(INTRO_MAX).await.map_err(|_| WrongCode)?)?;
            Ok(Paired { session, theirs, key: pair_key(&key) })
        })
        .await
        .map_err(|_| anyhow!(WrongCode))?
    }

    /// Trusted: `key` = the one kept for the hello's `from`.
    pub async fn sync(mut self, me: &str, key: &[u8; 32], mine: &Intro) -> Result<(Session, Intro)> {
        let Hello::Sync { from, .. } = &self.hello else { bail!("Not a sync") };
        let (from, id) = (from.clone(), sync_id(me, from));
        timeout(STEP, async {
            self.s.write_u8(GO).await?;
            let k = spake(&mut self.s, key, &id).await?;
            let mut session = Session::new(self.s, &k, true)?;
            session.send(&serde_json::to_vec(mine)?).await?;
            let theirs = checked(&session.recv(INTRO_MAX).await?)?;
            ensure!(theirs.card.id == from, "Another device");
            Ok((session, theirs))
        })
        .await
        .map_err(|_| anyhow!("The other device stopped answering"))?
    }
}

async fn open(addr: SocketAddr, hello: Hello) -> Result<TcpStream> {
    let mut s = timeout(STEP, TcpStream::connect(addr)).await.map_err(|_| anyhow!("Unreachable"))??;
    write_frame(&mut s, &serde_json::to_vec(&Envelope { v: VERSION, hello })?).await?;
    match timeout(STEP, s.read_u8()).await.map_err(|_| anyhow!("No answer"))?? {
        GO => Ok(s),
        NO => Err(Refused.into()),
        _ => bail!("Another device answers there"),
    }
}

async fn pair_at(addr: SocketAddr, code: &str, mine: &Intro) -> Result<Paired> {
    let mut s = open(addr, Hello::Pair).await?;
    timeout(STEP, async {
        let key = spake(&mut s, code.as_bytes(), PAIR_ID).await?;
        let mut session = Session::new(s, &key, false)?;
        let theirs = checked(&session.recv(INTRO_MAX).await?)?;
        session.send(&serde_json::to_vec(mine)?).await?;
        Ok(Paired { session, theirs, key: pair_key(&key) })
    })
    .await
    .map_err(|_| anyhow!("The other device stopped answering"))?
}

/// Pairs with the device showing `code`, its addresses in turn. Stops at a wrong code: another address of the same
/// device would only spend another try.
pub async fn pair(addrs: &[SocketAddr], code: &str, mine: &Intro) -> Result<Paired> {
    let mut last = anyhow!("No device is showing a code on this network");
    for addr in addrs {
        match pair_at(*addr, code, mine).await {
            Ok(p) => return Ok(p),
            Err(e) if e.is::<WrongCode>() => return Err(e),
            Err(e) => last = e,
        }
    }
    Err(last)
}

async fn sync_at(addr: SocketAddr, me: &str, peer: &str, key: &[u8; 32], mine: &Intro) -> Result<(Session, Intro)> {
    let mut s = open(addr, Hello::Sync { from: me.into(), to: peer.into() }).await?;
    timeout(STEP, async {
        let k = spake(&mut s, key, &sync_id(me, peer)).await?;
        let mut session = Session::new(s, &k, false)?;
        // Its intro won't open: it kept another key (paired again elsewhere). As good as forgotten.
        let theirs = checked(&session.recv(INTRO_MAX).await.map_err(|_| Refused)?)?;
        ensure!(theirs.card.id == peer, "Another device");
        session.send(&serde_json::to_vec(mine)?).await?;
        Ok((session, theirs))
    })
    .await
    .map_err(|_| anyhow!("The other device stopped answering"))?
}

/// Syncs with trusted `peer`, its addresses in turn. `Refused`: it forgot this device.
pub async fn sync(addrs: &[SocketAddr], me: &str, peer: &str, key: &[u8; 32], mine: &Intro) -> Result<(Session, Intro)> {
    let mut last = anyhow!("Not on this network");
    for addr in addrs {
        match sync_at(*addr, me, peer, key, mine).await {
            Ok(s) => return Ok(s),
            Err(e) if e.is::<Refused>() => return Err(e),
            Err(e) => last = e,
        }
    }
    Err(last)
}

/// This device on mDNS, and what it hears. Withdrawn on drop.
pub struct Presence {
    daemon: ServiceDaemon,
}

/// What mDNS said: a device heard (with its addresses), or one gone (its id).
#[derive(Debug, PartialEq)]
pub enum Event {
    Heard(Heard, Vec<SocketAddr>),
    Gone(String),
}

fn instance(id: &str) -> String {
    format!("legato-{id}")
}

impl Presence {
    /// Starts hearing the others: read with `recv_async`, each through `event`.
    pub fn start() -> Result<(Presence, mdns_sd::Receiver<ServiceEvent>)> {
        let daemon = ServiceDaemon::new()?;
        let events = daemon.browse(SERVICE)?;
        Ok((Presence { daemon }, events))
    }

    /// Announces this device, or its new words (same name: an update).
    pub fn announce(&self, id: &str, port: u16, words: &[(&'static str, String)]) -> Result<()> {
        let name = instance(id);
        let props: Vec<(&str, &str)> = words.iter().map(|(k, v)| (*k, v.as_str())).collect();
        self.daemon.register(ServiceInfo::new(SERVICE, &name, &format!("{name}.local."), "", port, &props[..])?.enable_addr_auto())?;
        Ok(())
    }

    /// No longer announced (still hearing).
    pub fn withdraw(&self, id: &str) {
        let _ = self.daemon.unregister(&format!("{}.{SERVICE}", instance(id)));
    }
}

impl Drop for Presence {
    fn drop(&mut self) {
        let _ = self.daemon.shutdown();
    }
}

/// One mDNS event read. Private IPv4 addresses only.
pub fn event(e: ServiceEvent) -> Option<Event> {
    match e {
        ServiceEvent::ServiceResolved(r) => {
            let h = heard(|k| r.get_property_val_str(k).map(str::to_string))?;
            let mut addrs: Vec<SocketAddr> = r.get_addresses_v4().into_iter().filter(|ip| private(IpAddr::V4(*ip))).map(|ip| SocketAddr::from((ip, r.get_port()))).collect();
            addrs.sort();
            Some(Event::Heard(h, addrs))
        }
        ServiceEvent::ServiceRemoved(_, fullname) => {
            let id = fullname.strip_prefix("legato-")?.split('.').next()?;
            music_core::syncmode::device_file(id).map(|_| Event::Gone(id.to_string()))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use music_core::devices::{Form, Os};
    use tokio::net::TcpListener;

    const A: &str = "0123456789abcdef0123456789abcdef";
    const B: &str = "fedcba9876543210fedcba9876543210";

    fn intro(id: &str, name: &str, trust: bool) -> Intro {
        Intro { card: Card { id: id.into(), name: name.into(), os: Os::Windows, form: Form::Tower }, port: PORT, trust }
    }

    /// A listener answering one connection with `serve`.
    async fn listen<F, Fut, T>(serve: F) -> (SocketAddr, tokio::task::JoinHandle<T>)
    where
        F: FnOnce(Incoming) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = T> + Send,
        T: Send + 'static,
    {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        (addr, tokio::spawn(async move { serve(incoming(l.accept().await.unwrap().0).await.unwrap()).await }))
    }

    #[tokio::test]
    async fn pairing_with_the_right_code_swaps_intros_snapshots_and_one_key() {
        let (addr, server) = listen(|inc| async move {
            assert_eq!(inc.hello, Hello::Pair);
            let p = inc.pair("042917", &intro(A, "Tower", true)).await.unwrap();
            let theirs = p.session.swap(b"tower snapshot").await.unwrap();
            (p.theirs, p.key, theirs)
        })
        .await;
        let p = pair(&[addr], "042917", &intro(B, "Phone", false)).await.unwrap();
        assert_eq!(p.theirs, intro(A, "Tower", true));
        let key = p.key;
        assert_eq!(p.session.swap(b"phone snapshot").await.unwrap(), b"tower snapshot");
        let (theirs, server_key, snapshot) = server.await.unwrap();
        assert_eq!(theirs, intro(B, "Phone", false), "its trust said as is: the shell keeps a key only when both trust");
        assert_eq!(server_key, key, "both sides derive the same pair key");
        assert_eq!(snapshot, b"phone snapshot");
    }

    #[tokio::test]
    async fn a_wrong_code_fails_on_both_sides() {
        let (addr, server) = listen(|inc| async move { inc.pair("042917", &intro(A, "Tower", true)).await.err().unwrap() }).await;
        let e = pair(&[addr], "111111", &intro(B, "Phone", true)).await.err().unwrap();
        assert!(e.is::<WrongCode>(), "{e}");
        assert!(server.await.unwrap().is::<WrongCode>(), "the listener counts a try");
    }

    #[tokio::test]
    async fn no_code_shown_is_a_refusal() {
        let (addr, server) = listen(|inc| inc.refuse()).await;
        let e = pair(&[addr], "042917", &intro(B, "Phone", true)).await.err().unwrap();
        assert!(e.is::<Refused>(), "{e}");
        server.await.unwrap();
    }

    #[tokio::test]
    async fn trusted_devices_sync_with_their_key() {
        let key = [7u8; 32];
        let (addr, server) = listen(move |inc| async move {
            assert_eq!(inc.hello, Hello::Sync { from: B.into(), to: A.into() });
            let (session, theirs) = inc.sync(A, &key, &intro(A, "Tower", false)).await.unwrap();
            (theirs, session.swap(b"tower").await.unwrap())
        })
        .await;
        let (session, theirs) = sync(&[addr], B, A, &key, &intro(B, "Phone", false)).await.unwrap();
        assert_eq!(theirs.card.name, "Tower");
        assert_eq!(session.swap(b"phone").await.unwrap(), b"tower");
        let (theirs, snapshot) = server.await.unwrap();
        assert_eq!((theirs.card.id.as_str(), snapshot.as_slice()), (B, b"phone".as_slice()));
    }

    #[tokio::test]
    async fn another_key_reads_as_forgotten() {
        let (addr, server) = listen(|inc| async move { inc.sync(A, &[1u8; 32], &intro(A, "Tower", false)).await.is_err() }).await;
        let e = sync(&[addr], B, A, &[2u8; 32], &intro(B, "Phone", false)).await.err().unwrap();
        assert!(e.is::<Refused>(), "{e}");
        assert!(server.await.unwrap());
    }

    #[tokio::test]
    async fn an_unknown_device_is_refused_and_another_address_tried_past_a_stranger() {
        let (stranger, s1) = listen(|inc| inc.not_me()).await;
        let (forgot, s2) = listen(|inc| inc.refuse()).await;
        let e = sync(&[stranger, forgot], B, A, &[2u8; 32], &intro(B, "Phone", false)).await.err().unwrap();
        assert!(e.is::<Refused>(), "past the stranger, the right one refused: {e}");
        s1.await.unwrap();
        s2.await.unwrap();
    }

    #[tokio::test]
    async fn a_big_frame_before_the_code_is_never_read() {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        let server = tokio::spawn(async move { incoming(l.accept().await.unwrap().0).await.err().unwrap() });
        let mut s = TcpStream::connect(addr).await.unwrap();
        s.write_u32(64 << 20).await.unwrap();
        assert!(server.await.unwrap().to_string().contains("too big"));
    }

    #[test]
    fn mdns_removals_name_the_device() {
        assert_eq!(event(ServiceEvent::ServiceRemoved(SERVICE.into(), format!("legato-{A}.{SERVICE}"))), Some(Event::Gone(A.into())));
        assert_eq!(event(ServiceEvent::ServiceRemoved(SERVICE.into(), format!("other-1.{SERVICE}"))), None);
        assert_eq!(event(ServiceEvent::ServiceRemoved(SERVICE.into(), format!("legato-nope.{SERVICE}"))), None);
    }
}
