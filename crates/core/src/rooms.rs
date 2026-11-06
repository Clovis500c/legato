//! Listening rooms on the local network (`docs/rooms.md`): one device leads a room, friends on the same network follow
//! it, each one playing the song from their own source (no audio sent). Pure part: the messages (versioned, size
//! capped), a song as it travels (never a file path), the room's QR link and mDNS words, the clock offset, the drift
//! rule, the limits. Wire: `music_connectors::rooms`; shell: `src-tauri` `rooms.rs`; interface `features/rooms/`.

use crate::devices::{ADDRS_MAX, clean_name, is_code};
use crate::model::{Source, Track};
use crate::remote::private;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::net::{IpAddr, SocketAddrV4};

/// Messages' version, said in clear before the code: another one is refused.
pub const VERSION: u32 = 1;
/// Largest sealed message read (bytes, its tag left out): read only once its length is checked.
pub const FRAME_MAX: u32 = 16 * 1024;
/// Listeners in a room, the host left out.
pub const LISTENERS_MAX: usize = 8;
/// Wrong codes allowed per code (as Nearby share's): then a new code, and joins shut a while (`shut_ms`).
pub const MAX_TRIES: u8 = 5;
/// Joins shut after a new code (ms), doubled at each one, up to `SHUT_MAX`: 5 guesses a quarter hour at most.
const SHUT_FIRST: i64 = 30_000;
const SHUT_MAX: i64 = 15 * 60_000;
/// Songs of Up next sent ahead: listeners find them before they play.
pub const UP_NEXT: usize = 3;
/// Host's tick, and listener's ping (ms).
pub const TICK_MS: i64 = 5_000;
/// Off by more than this: seek (ms).
pub const DRIFT_MS: i64 = 1_500;
/// After a seek: left alone this long (ms), no seek loops while a player catches up.
pub const SETTLE_MS: i64 = 4_000;
/// Round trips kept for the clock offset.
pub const SAMPLES: usize = 7;
/// A round trip longer than this says nothing of the clocks (ms).
const RTT_MAX: i64 = 3_000;
pub const ROOM_LINK: &str = "legato://room?";
const TEXT_MAX: usize = 200;
const ART_MAX: usize = 600;
/// mDNS words' version.
const WORDS: &str = "1";

/// The fixed set: no free text in a room.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename = "RoomReaction")]
pub enum Reaction {
    Heart,
    Fire,
    Laugh,
    Clap,
    Party,
    Wow,
}

/// A song in a room: what a listener needs to find it on their side. Never a file path (a path can hold a name).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RoomSong {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: Option<u32>,
    pub isrc: Option<String>,
    /// YouTube video id.
    pub youtube: Option<String>,
    /// Spotify track id.
    pub spotify: Option<String>,
    /// A web cover the art scheme allows; none else.
    pub art: Option<String>,
}

fn text(s: &str) -> Option<String> {
    let t: String = s.chars().filter(|c| !c.is_control()).take(TEXT_MAX).collect();
    let t = t.trim();
    (!t.is_empty()).then(|| t.to_string())
}

/// Looks like a file path: `C:\…`, `\\server`, `/home/…`, `file:`.
fn pathlike(s: &str) -> bool {
    let b = s.as_bytes();
    s.contains('\\') || s.starts_with('/') || s.to_ascii_lowercase().starts_with("file:") || (b.len() > 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'/')
}

fn youtube_id(id: &str) -> bool {
    id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn spotify_id(id: &str) -> bool {
    id.len() == 22 && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

fn isrc(code: &str) -> bool {
    code.len() == 12 && code.bytes().all(|b| b.is_ascii_alphanumeric())
}

impl RoomSong {
    /// A library or queue song as it goes out: its ids and web cover, never its path. None: nothing to find it by.
    pub fn of(t: &Track, art_ok: impl Fn(&str) -> bool) -> Option<RoomSong> {
        let song = RoomSong {
            title: t.title.clone(),
            artist: t.artist.clone(),
            album: t.album.clone(),
            duration_ms: t.duration_ms,
            isrc: t.isrc.clone(),
            youtube: t.ids.get(&Source::Youtube).cloned(),
            spotify: t.ids.get(&Source::Spotify).cloned(),
            art: t.art.clone(),
        };
        song.checked(art_ok)
    }

    /// Words from the other side checked: no control characters, 200 at most, ids well formed (others dropped), a
    /// cover only when `art_ok` allows it (https, the art scheme's hosts). None: no title, or a path for one.
    pub fn checked(self, art_ok: impl Fn(&str) -> bool) -> Option<RoomSong> {
        let title = text(&self.title).filter(|t| !pathlike(t))?;
        let artist = text(&self.artist).filter(|a| !pathlike(a)).unwrap_or_default();
        let album = self.album.as_deref().and_then(text).filter(|a| !pathlike(a));
        Some(RoomSong {
            title,
            artist,
            album,
            duration_ms: self.duration_ms.filter(|&d| d > 0 && d <= 24 * 3_600_000),
            isrc: self.isrc.map(|i| i.to_ascii_uppercase()).filter(|i| isrc(i)),
            youtube: self.youtube.filter(|v| youtube_id(v)),
            spotify: self.spotify.filter(|s| spotify_id(s)),
            art: self.art.filter(|a| a.len() <= ART_MAX && a.starts_with("https://") && art_ok(a)),
        })
    }

    /// As a track to look up or play (no library row).
    pub fn track(&self) -> Track {
        let mut t = Track { title: self.title.clone(), artist: self.artist.clone(), album: self.album.clone(), duration_ms: self.duration_ms, isrc: self.isrc.clone(), art: self.art.clone(), ..Track::default() };
        if let Some(v) = &self.youtube {
            t.ids.insert(Source::Youtube, v.clone());
        }
        if let Some(s) = &self.spotify {
            t.ids.insert(Source::Spotify, s.clone());
        }
        t
    }
}

/// What the host plays: the song, where it was at the host's `at`, playing or paused.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "RoomNow")]
pub struct Now {
    /// None: nothing playing.
    pub song: Option<RoomSong>,
    pub position_ms: u32,
    pub playing: bool,
    /// The host's clock (unix ms) when `position_ms` was right; the listener's own once its shell turned it.
    pub at: i64,
    /// Bumped by the host at each song change and seek: a listener follows it at once.
    pub seq: u32,
}

impl Now {
    /// Where the song is at time `t` (same clock as `at`): moving while it plays, never past its end.
    pub fn position_at(&self, t: i64) -> u32 {
        let moved = if self.playing { (t - self.at).max(0) } else { 0 };
        let p = i64::from(self.position_ms) + moved;
        let end = self.song.as_ref().and_then(|s| s.duration_ms).map_or(i64::from(u32::MAX), i64::from);
        p.clamp(0, end) as u32
    }
}

/// Host → listener.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum ToListener {
    /// The first message: the room, its host, who listens, what plays, what comes.
    Welcome { room: String, host: String, people: Vec<String>, now: Now, next: Vec<RoomSong> },
    /// A song change, play / pause, a seek.
    Now { now: Now },
    /// The next songs of Up next.
    Next { songs: Vec<RoomSong> },
    /// Every few seconds: where the song is (its song unchanged).
    Tick { position_ms: u32, playing: bool, at: i64, seq: u32 },
    /// A ping's answer: the listener's time sent back, the host's clock.
    Pong { sent: i64, at: i64 },
    React { from: String, reaction: Reaction },
    People { people: Vec<String> },
    /// The host ended the room.
    End,
}

/// Listener → host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum ToHost {
    Hello { name: String },
    Ping { sent: i64 },
    React { reaction: Reaction },
    Leave,
}

/// A message's bytes; None when over `FRAME_MAX` (never sent).
pub fn encode<T: Serialize>(m: &T) -> Option<Vec<u8>> {
    serde_json::to_vec(m).ok().filter(|b| b.len() <= FRAME_MAX as usize)
}

fn names(people: Vec<String>) -> Option<Vec<String>> {
    (people.len() <= LISTENERS_MAX + 1).then(|| people.iter().filter_map(|p| clean_name(p)).collect())
}

fn songs(list: Vec<RoomSong>, art_ok: &impl Fn(&str) -> bool) -> Option<Vec<RoomSong>> {
    (list.len() <= UP_NEXT).then(|| list.into_iter().filter_map(|s| s.checked(art_ok)).collect())
}

fn now_checked(now: Now, art_ok: &impl Fn(&str) -> bool) -> Now {
    Now { song: now.song.and_then(|s| s.checked(art_ok)), ..now }
}

impl ToListener {
    /// The host's message read and checked: names cleaned, lists capped, songs checked. None: not ours.
    pub fn read(bytes: &[u8], art_ok: impl Fn(&str) -> bool) -> Option<ToListener> {
        if bytes.len() > FRAME_MAX as usize {
            return None;
        }
        Some(match serde_json::from_slice(bytes).ok()? {
            ToListener::Welcome { room, host, people, now, next } => ToListener::Welcome { room: clean_name(&room)?, host: clean_name(&host)?, people: names(people)?, now: now_checked(now, &art_ok), next: songs(next, &art_ok)? },
            ToListener::Now { now } => ToListener::Now { now: now_checked(now, &art_ok) },
            ToListener::Next { songs: list } => ToListener::Next { songs: songs(list, &art_ok)? },
            ToListener::React { from, reaction } => ToListener::React { from: clean_name(&from)?, reaction },
            ToListener::People { people } => ToListener::People { people: names(people)? },
            m @ (ToListener::Tick { .. } | ToListener::Pong { .. } | ToListener::End) => m,
        })
    }
}

impl ToHost {
    pub fn read(bytes: &[u8]) -> Option<ToHost> {
        if bytes.len() > FRAME_MAX as usize {
            return None;
        }
        Some(match serde_json::from_slice(bytes).ok()? {
            ToHost::Hello { name } => ToHost::Hello { name: clean_name(&name)? },
            m => m,
        })
    }
}

/// The host's clock against this one: the median offset of the last round trips.
#[derive(Debug, Default, Clone)]
pub struct Clock {
    offsets: VecDeque<i64>,
}

impl Clock {
    /// A ping sent at `sent`, answered with the host's `at`, back at `got` (this clock). A slow round trip is left out.
    pub fn add(&mut self, sent: i64, at: i64, got: i64) {
        let rtt = got - sent;
        if !(0..=RTT_MAX).contains(&rtt) {
            return;
        }
        self.offsets.push_back(at - (sent + got) / 2);
        if self.offsets.len() > SAMPLES {
            self.offsets.pop_front();
        }
    }

    /// Host time = this time + offset. 0 until a round trip came back.
    pub fn offset(&self) -> i64 {
        let mut v: Vec<i64> = self.offsets.iter().copied().collect();
        v.sort_unstable();
        match v.len() {
            0 => 0,
            n if n % 2 == 1 => v[n / 2],
            n => (v[n / 2 - 1] + v[n / 2]) / 2,
        }
    }

    pub fn known(&self) -> bool {
        !self.offsets.is_empty()
    }

    /// A host time on this clock.
    pub fn local(&self, host_at: i64) -> i64 {
        host_at - self.offset()
    }
}

/// The drift rule: seek when the listener's player is off the room's by more than `DRIFT_MS`, not while a seek
/// settles (until `quiet_until`). Its twin: `ui/src/features/rooms/roomFollow.ts` (keep them alike).
pub fn should_seek(expected_ms: i64, actual_ms: i64, now: i64, quiet_until: i64) -> bool {
    now >= quiet_until && (expected_ms - actual_ms).abs() > DRIFT_MS
}

/// Joins shut this long (ms) after the `n`th new code (from 0): a new code alone leaves guesses unlimited.
pub fn shut_ms(n: u32) -> i64 {
    (SHUT_FIRST << n.min(6)).min(SHUT_MAX)
}

/// A new room code: 6 digits, as Nearby share's.
pub fn new_code() -> String {
    format!("{:06}", rand::random_range(0..1_000_000u32))
}

/// A room's id: 16 hex, new for each room (its mDNS name, its QR link).
pub fn new_id() -> String {
    (0..8).map(|_| format!("{:02x}", rand::random::<u8>())).collect()
}

fn room_id(id: &str) -> bool {
    id.len() == 16 && id.bytes().all(|b| b.is_ascii_hexdigit())
}

/// What a room's QR code holds: the code, where the host listens, the room's id. Private IPv4 addresses only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomLink {
    pub code: String,
    pub hosts: Vec<SocketAddrV4>,
    pub id: String,
}

impl RoomLink {
    pub fn text(&self) -> String {
        let hosts: Vec<String> = self.hosts.iter().map(ToString::to_string).collect();
        format!("{ROOM_LINK}c={}&h={}&r={}", self.code, hosts.join(","), self.id)
    }

    pub fn parse(text: &str) -> Option<RoomLink> {
        let query = text.trim().strip_prefix(ROOM_LINK)?;
        let get = |k: &str| query.split('&').find_map(|kv| kv.strip_prefix(k)?.strip_prefix('='));
        let code = get("c").filter(|c| is_code(c))?.to_string();
        let id = get("r").filter(|i| room_id(i))?.to_string();
        let hosts: Option<Vec<SocketAddrV4>> = get("h")?.split(',').map(|h| h.parse().ok().filter(|a: &SocketAddrV4| private(IpAddr::V4(*a.ip())))).collect();
        let hosts = hosts.filter(|h| !h.is_empty() && h.len() <= ADDRS_MAX)?;
        Some(RoomLink { code, hosts, id })
    }
}

/// A room heard over mDNS.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "RoomHeard")]
pub struct Heard {
    pub id: String,
    pub room: String,
    pub host: String,
    /// Listeners in it now.
    pub people: u32,
    pub full: bool,
}

/// The host's mDNS TXT words (in clear on the network: names and a count, no song).
pub fn txt(id: &str, room: &str, host: &str, people: usize) -> Vec<(&'static str, String)> {
    let mut w = vec![("v", WORDS.to_string()), ("r", id.to_string()), ("n", room.to_string()), ("h", host.to_string()), ("p", people.to_string())];
    if people >= LISTENERS_MAX {
        w.push(("f", "1".into()));
    }
    w
}

/// A room's TXT words (`get` reads one); None when not ours or not well formed.
pub fn heard(get: impl Fn(&str) -> Option<String>) -> Option<Heard> {
    if get("v")? != WORDS {
        return None;
    }
    let id = get("r").filter(|i| room_id(i))?;
    let people = get("p").and_then(|p| p.parse::<u32>().ok()).unwrap_or(0).min(LISTENERS_MAX as u32);
    Some(Heard { id, room: clean_name(&get("n")?)?, host: clean_name(&get("h")?)?, people, full: get("f").as_deref() == Some("1") })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const VIDEO: &str = "dQw4w9WgXcQ";
    const SPOT: &str = "4uLU6hMCjMI75M1A2tKUQC";

    fn art_ok(url: &str) -> bool {
        url.starts_with("https://i.ytimg.com/")
    }

    fn song() -> RoomSong {
        RoomSong { title: "Song".into(), artist: "Band".into(), album: Some("Album".into()), duration_ms: Some(200_000), isrc: Some("usrc17607839".into()), youtube: Some(VIDEO.into()), spotify: Some(SPOT.into()), art: Some(format!("https://i.ytimg.com/vi/{VIDEO}/hqdefault.jpg")) }
    }

    #[test]
    fn a_song_goes_out_with_its_ids_and_web_cover_never_a_path() {
        let s = song().checked(art_ok).unwrap();
        assert_eq!(s.isrc.as_deref(), Some("USRC17607839"));
        let t = s.track();
        assert_eq!(t.ids.get(&Source::Youtube).map(String::as_str), Some(VIDEO));
        assert_eq!(t.ids.get(&Source::Spotify).map(String::as_str), Some(SPOT));
        let mut local = song().track();
        local.ids.insert(Source::Local, r"C:\Users\Clovis\Music\a.mp3".into());
        local.art = Some("file:///C:/Users/Clovis/cover.jpg".into());
        let out = RoomSong::of(&local, art_ok).unwrap();
        let json = String::from_utf8(encode(&out).unwrap()).unwrap();
        assert!(!json.contains("Users") && !json.contains("mp3"), "{json}");
        assert_eq!(out.art, None, "a local cover stays home");
        for path in [r"C:\Music\x.mp3", "/home/me/x.flac", "file:///x", "D:/x.ogg", r"\\nas\x"] {
            assert_eq!(RoomSong { title: path.into(), ..song() }.checked(art_ok), None, "{path}");
        }
        assert_eq!(RoomSong { album: Some(r"C:\Music".into()), ..song() }.checked(art_ok).unwrap().album, None);
    }

    #[test]
    fn bad_words_are_dropped() {
        let s = RoomSong { title: format!("\u{7}{}", "x".repeat(500)), youtube: Some("nope".into()), spotify: Some("bad!".into()), isrc: Some("x".into()), art: Some("http://i.ytimg.com/a.jpg".into()), duration_ms: Some(0), ..song() }.checked(art_ok).unwrap();
        assert_eq!(s.title.chars().count(), TEXT_MAX);
        assert_eq!((s.youtube, s.spotify, s.isrc, s.art, s.duration_ms), (None, None, None, None, None));
        assert_eq!(RoomSong { art: Some("https://evil.example/a.jpg".into()), ..song() }.checked(art_ok).unwrap().art, None);
        assert_eq!(RoomSong { title: "  ".into(), ..song() }.checked(art_ok), None);
    }

    #[test]
    fn messages_round_trip_checked_and_capped() {
        let now = Now { song: Some(song()), position_ms: 1000, playing: true, at: 5, seq: 2 };
        let w = ToListener::Welcome { room: "Salon".into(), host: "TOUR".into(), people: vec!["Phone".into(), "\u{1}".into()], now: now.clone(), next: vec![song(), song()] };
        let read = ToListener::read(&encode(&w).unwrap(), art_ok).unwrap();
        let ToListener::Welcome { people, next, .. } = read else { panic!() };
        assert_eq!(people, vec!["Phone".to_string()], "a name with nothing printable dropped");
        assert_eq!(next.len(), 2);
        let many = ToListener::Next { songs: vec![song(); UP_NEXT + 1] };
        assert_eq!(ToListener::read(&encode(&many).unwrap(), art_ok), None, "Up next capped");
        let crowd = ToListener::People { people: vec!["a".into(); LISTENERS_MAX + 2] };
        assert_eq!(ToListener::read(&encode(&crowd).unwrap(), art_ok), None);
        assert_eq!(ToListener::read(br#"{"t":"chat","text":"hi"}"#, art_ok), None, "no free text kind");
        assert_eq!(ToHost::read(br#"{"t":"react","reaction":"heart"}"#), Some(ToHost::React { reaction: Reaction::Heart }));
        assert_eq!(ToHost::read(br#"{"t":"react","reaction":"poop"}"#), None, "the fixed set only");
        assert_eq!(ToHost::read(&encode(&ToHost::Hello { name: "  Phone\n ".into() }).unwrap()), Some(ToHost::Hello { name: "Phone".into() }));
        assert_eq!(ToHost::read(&encode(&ToHost::Hello { name: "\n".into() }).unwrap()), None);
        let huge = ToListener::Now { now: Now { song: Some(RoomSong { title: "x".repeat(FRAME_MAX as usize), ..song() }), ..now } };
        assert!(encode(&huge).is_none(), "never sent over the cap");
        assert_eq!(ToListener::read(&vec![b' '; FRAME_MAX as usize + 1], art_ok), None);
    }

    #[test]
    fn position_moves_while_playing_and_stops_at_the_end() {
        let now = Now { song: Some(song()), position_ms: 10_000, playing: true, at: 1_000, seq: 0 };
        assert_eq!(now.position_at(3_500), 12_500);
        assert_eq!(now.position_at(500), 10_000, "never back in time");
        assert_eq!(now.position_at(10_000_000), 200_000, "its end");
        assert_eq!(Now { playing: false, ..now }.position_at(3_500), 10_000);
    }

    #[test]
    fn the_clock_offset_is_the_median_of_round_trips() {
        let mut c = Clock::default();
        assert_eq!((c.offset(), c.known()), (0, false));
        // Host 1000 ms ahead, 20 ms round trips.
        for i in 0..5 {
            let sent = i * 5000;
            c.add(sent, sent + 10 + 1000, sent + 20);
        }
        assert_eq!(c.offset(), 1000);
        // One odd sample (a stalled answer still under the cap) moves nothing.
        c.add(30_000, 30_000 + 2_500, 30_020);
        assert_eq!(c.offset(), 1000);
        // Too slow: left out.
        c.add(40_000, 0, 40_000 + RTT_MAX + 1);
        c.add(50_000, 0, 49_000);
        assert_eq!(c.offset(), 1000);
        assert_eq!(c.local(11_000), 10_000);
        for i in 0..SAMPLES as i64 {
            c.add(i, i - 500, i);
        }
        assert_eq!(c.offset(), -500, "the oldest go");
    }

    #[test]
    fn drift_seeks_past_the_threshold_then_waits() {
        assert!(!should_seek(10_000, 9_000, 0, 0), "1 s off: left alone");
        assert!(should_seek(10_000, 8_000, 0, 0));
        assert!(should_seek(8_000, 10_000, 0, 0), "ahead too");
        assert!(!should_seek(10_000, 0, 100, 100 + SETTLE_MS), "settling after a seek");
        assert!(should_seek(10_000, 0, 100 + SETTLE_MS, 100 + SETTLE_MS));
    }

    #[test]
    fn joins_shut_longer_at_each_new_code() {
        assert_eq!(shut_ms(0), 30_000);
        assert_eq!(shut_ms(1), 60_000);
        assert_eq!(shut_ms(4), 480_000);
        assert_eq!(shut_ms(5), SHUT_MAX);
        assert_eq!(shut_ms(u32::MAX), SHUT_MAX, "no overflow");
    }

    #[test]
    fn room_links_read_back_private_hosts_only() {
        let l = RoomLink { code: "042917".into(), hosts: vec!["192.168.1.20:47823".parse().unwrap()], id: "0123456789abcdef".into() };
        assert_eq!(RoomLink::parse(&l.text()), Some(l.clone()));
        assert_eq!(RoomLink::parse(&l.text().replace("192.168.1.20", "8.8.8.8")), None);
        assert_eq!(RoomLink::parse(&l.text().replace("042917", "42917")), None);
        assert_eq!(RoomLink::parse("legato://pair?c=042917&h=192.168.1.20:47822&i=x"), None);
        assert!(is_code(&new_code()) && room_id(&new_id()));
    }

    #[test]
    fn mdns_words_read_back() {
        let w: HashMap<&str, String> = txt("0123456789abcdef", "Salon", "TOUR", LISTENERS_MAX).into_iter().collect();
        let h = heard(|k| w.get(k).cloned()).unwrap();
        assert_eq!(h, Heard { id: "0123456789abcdef".into(), room: "Salon".into(), host: "TOUR".into(), people: LISTENERS_MAX as u32, full: true });
        for (k, v) in [("v", "9"), ("r", "zz"), ("n", "\u{7}")] {
            let mut bad = w.clone();
            bad.insert(k, v.into());
            assert_eq!(heard(|k| bad.get(k).cloned()), None, "{k}");
        }
    }
}
