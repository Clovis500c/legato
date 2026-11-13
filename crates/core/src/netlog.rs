//! Hosts the app talked to today (Settings › Privacy): its own requests, seen by its HTTP clients' resolver
//! (`music_connectors::Noted`) or noted at the call (updates, the shield's lists), its windows' (WebView2: YouTube's
//! player, sign-in and Connect pages), seen by the shield hook, and plugins', at their gateway. Memory only; a new day
//! starts over.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{LazyLock, Mutex};

/// Who asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Via {
    /// The app's core.
    App,
    /// A page in an app window.
    Window,
    /// A plugin, through its gateway.
    Plugin,
}

/// Why, by host: the service or job it belongs to (the website's privacy rows).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Why {
    YouTube,
    GoogleSignIn,
    Spotify,
    ConnectSpotify,
    AppleMusic,
    Deezer,
    SoundCloud,
    Covers,
    Lyrics,
    SkipParts,
    Scrobbling,
    Detector,
    Discord,
    Updates,
    AdLists,
    Plugin,
    Other,
}

/// One host today.
#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Contact {
    /// A window's: its site (`googlevideo.com` for its many servers).
    pub host: String,
    pub via: Via,
    pub why: Why,
    /// Requests (a window's, a plugin's) or connections (the app's: one carries many requests).
    pub count: u32,
    /// Refused by the shield.
    pub blocked: u32,
    /// Unix ms.
    pub last: i64,
}

/// Host suffix → why; first match wins (sign-in and image hosts before their company's).
const WHY: &[(&str, Why)] = &[
    ("accounts.google.com", Why::GoogleSignIn),
    ("accounts.youtube.com", Why::GoogleSignIn),
    ("ytimg.com", Why::Covers),
    ("ggpht.com", Why::Covers),
    ("googleusercontent.com", Why::Covers),
    ("mzstatic.com", Why::Covers),
    ("scdn.co", Why::Covers),
    ("spotifycdn.com", Why::Covers),
    ("dzcdn.net", Why::Covers),
    ("sndcdn.com", Why::Covers),
    ("youtube.com", Why::YouTube),
    ("youtube-nocookie.com", Why::YouTube),
    ("googlevideo.com", Why::YouTube),
    ("googleapis.com", Why::YouTube),
    ("gstatic.com", Why::YouTube),
    ("google.com", Why::YouTube),
    ("exportify.app", Why::ConnectSpotify),
    ("spotify.com", Why::Spotify),
    ("apple.com", Why::AppleMusic),
    ("deezer.com", Why::Deezer),
    ("soundcloud.com", Why::SoundCloud),
    ("lrclib.net", Why::Lyrics),
    ("mymemory.translated.net", Why::Lyrics),
    ("sponsor.ajay.app", Why::SkipParts),
    ("audioscrobbler.com", Why::Scrobbling),
    ("last.fm", Why::Scrobbling),
    ("listenbrainz.org", Why::Scrobbling),
    ("audd.io", Why::Detector),
    ("acoustid.org", Why::Detector),
    ("discord.com", Why::Discord),
    ("discordapp.com", Why::Discord),
    ("github.com", Why::Updates),
    ("githubusercontent.com", Why::Updates),
    ("easylist.to", Why::AdLists),
];

/// Most hosts kept a day: past it, new ones aren't (a page can't fill memory).
const MAX: usize = 500;
const DAY: i64 = 86_400;

pub fn why(host: &str, via: Via) -> Why {
    if via == Via::Plugin {
        return Why::Plugin;
    }
    WHY.iter().find(|(d, _)| host == *d || host.strip_suffix(d).is_some_and(|h| h.ends_with('.'))).map_or(Why::Other, |(_, w)| *w)
}

/// A host's site: its last two labels, three under a country's own (`bbc.co.uk`).
pub fn site(host: &str) -> &str {
    let dots: Vec<usize> = host.match_indices('.').map(|(i, _)| i).collect();
    let keep = match dots.len() {
        0 | 1 => return host,
        n => {
            let (tld, second) = (&host[dots[n - 1] + 1..], &host[dots[n - 2] + 1..dots[n - 1]]);
            if tld.len() == 2 && ["co", "com", "net", "org", "ac", "gov", "ne", "or"].contains(&second) { 3 } else { 2 }
        }
    };
    if host.parse::<std::net::IpAddr>().is_ok() || dots.len() < keep { host } else { &host[dots[dots.len() - keep] + 1..] }
}

/// A URL's host, lower case, without port or user; None: not http(s), or this PC (the app's own pages).
pub fn host_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let auth = rest.split(['/', '?', '#']).next()?;
    let auth = auth.rsplit('@').next()?;
    let host = if let Some(v6) = auth.strip_prefix('[') { v6.split(']').next()? } else { auth.split(':').next()? };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let local = host.is_empty() || host == "localhost" || host.ends_with(".localhost") || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback());
    (!local).then_some(host)
}

#[derive(Default)]
pub struct Log {
    seen: HashMap<(String, Via, Why), Contact>,
}

impl Log {
    /// `now` unix ms; `offset` = local time's from UTC, seconds (a day = a local day).
    pub fn note(&mut self, host: &str, via: Via, blocked: bool, now: i64, offset: i64) {
        let host = host.trim_end_matches('.').to_ascii_lowercase();
        if host.is_empty() || host == "localhost" || host.ends_with(".localhost") {
            return;
        }
        let why = why(&host, via);
        let key = if via == Via::Window { site(&host).to_owned() } else { host };
        let day = |t: i64| (t / 1000 + offset).div_euclid(DAY);
        let key = (key, via, why);
        if self.seen.len() >= MAX && !self.seen.contains_key(&key) {
            return;
        }
        let c = self.seen.entry(key).or_insert_with_key(|(host, via, why)| Contact { host: host.clone(), via: *via, why: *why, count: 0, blocked: 0, last: now });
        if day(c.last) != day(now) {
            (c.count, c.blocked) = (0, 0);
        }
        c.count += 1;
        c.blocked += u32::from(blocked);
        c.last = now;
    }

    /// Today's, most asked first; earlier days dropped.
    pub fn today(&mut self, now: i64, offset: i64) -> Vec<Contact> {
        let day = |t: i64| (t / 1000 + offset).div_euclid(DAY);
        self.seen.retain(|_, c| day(c.last) == day(now));
        let mut out: Vec<Contact> = self.seen.values().cloned().collect();
        out.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.host.cmp(&b.host)));
        out
    }
}

static LOG: LazyLock<Mutex<Log>> = LazyLock::new(Mutex::default);
/// Local time's offset, from the interface's last ask (UTC until then).
static OFFSET: AtomicI64 = AtomicI64::new(0);

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

/// The app's log: one more contact with `host`.
pub fn note(host: &str, via: Via, blocked: bool) {
    if let Ok(mut log) = LOG.lock() {
        log.note(host, via, blocked, now_ms(), OFFSET.load(Ordering::Relaxed));
    }
}

/// Same, from a URL (this PC's own pages left out).
pub fn note_url(url: &str, via: Via, blocked: bool) {
    if let Some(host) = host_of(url) {
        note(&host, via, blocked);
    }
}

/// The app's log, today's (`offset`: local time's from UTC, seconds).
pub fn today(offset: i64) -> Vec<Contact> {
    OFFSET.store(offset, Ordering::Relaxed);
    LOG.lock().map(|mut log| log.today(now_ms(), offset)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOON: i64 = 1_700_000_000_000 - 1_700_000_000_000 % (DAY * 1000) + 12 * 3_600_000;

    #[test]
    fn hosts_say_why() {
        assert_eq!(why("music.youtube.com", Via::App), Why::YouTube);
        assert_eq!(why("accounts.google.com", Via::Window), Why::GoogleSignIn);
        assert_eq!(why("i.ytimg.com", Via::App), Why::Covers);
        assert_eq!(why("rr3---sn-4g5e.googlevideo.com", Via::Window), Why::YouTube);
        assert_eq!(why("api.deezer.com", Via::App), Why::Deezer);
        assert_eq!(why("lrclib.net", Via::App), Why::Lyrics);
        assert_eq!(why("api.mymemory.translated.net", Via::App), Why::Lyrics, "translated lyrics");
        assert_eq!(why("ws.audioscrobbler.com", Via::App), Why::Scrobbling);
        assert_eq!(why("lrclib.net", Via::Plugin), Why::Plugin);
        // A suffix is a whole label: notyoutube.com isn't YouTube's.
        assert_eq!(why("notyoutube.com", Via::App), Why::Other);
        assert_eq!(why("doubleclick.net", Via::Window), Why::Other);
    }

    #[test]
    fn sites_and_hosts() {
        assert_eq!(site("rr3---sn-4g5e.googlevideo.com"), "googlevideo.com");
        assert_eq!(site("www.bbc.co.uk"), "bbc.co.uk");
        assert_eq!(site("lrclib.net"), "lrclib.net");
        assert_eq!(site("142.250.1.1"), "142.250.1.1");
        assert_eq!(host_of("https://User@Music.YouTube.com:443/youtubei/v1/search?x=1").as_deref(), Some("music.youtube.com"));
        assert_eq!(host_of("http://[2001:db8::1]:8080/a").as_deref(), Some("2001:db8::1"));
        assert_eq!(host_of("http://tauri.localhost/index.html"), None);
        assert_eq!(host_of("http://127.0.0.1:1420/"), None);
        assert_eq!(host_of("art://cover/abc"), None);
    }

    #[test]
    fn a_day_of_contacts() {
        let mut log = Log::default();
        log.note("rr1---sn-a.googlevideo.com", Via::Window, false, NOON, 0);
        log.note("rr2---sn-b.googlevideo.com", Via::Window, false, NOON + 1, 0);
        log.note("pagead2.googlesyndication.com", Via::Window, true, NOON + 2, 0);
        log.note("music.youtube.com", Via::App, false, NOON + 3, 0);
        log.note("tauri.localhost", Via::Window, false, NOON + 4, 0);
        let today = log.today(NOON + 5, 0);
        assert_eq!(today.len(), 3);
        assert_eq!((today[0].host.as_str(), today[0].count, today[0].via), ("googlevideo.com", 2, Via::Window));
        let ad = today.iter().find(|c| c.host == "googlesyndication.com").unwrap();
        assert_eq!((ad.blocked, ad.why), (1, Why::Other));
        // Next day: yesterday's are gone, a host seen again counts from 0.
        let tomorrow = NOON + DAY * 1000;
        log.note("music.youtube.com", Via::App, false, tomorrow, 0);
        let today = log.today(tomorrow, 0);
        assert_eq!(today.len(), 1);
        assert_eq!((today[0].count, today[0].last), (1, tomorrow));
        // The local day: 23:30 UTC is tomorrow at UTC+1.
        let late = NOON + 11 * 3_600_000 + 30 * 60_000;
        let mut log = Log::default();
        log.note("lrclib.net", Via::App, false, NOON, 3_600);
        log.note("lrclib.net", Via::App, false, late, 3_600);
        assert_eq!(log.today(late, 3_600)[0].count, 1);
    }
}
