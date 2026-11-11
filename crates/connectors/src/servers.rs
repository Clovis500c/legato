//! What every kind of personal server shares (`subsonic.rs`, `jellyfin.rs`, `plex.rs`): one HTTP client, a song's
//! answer, network failures in words, and `Conn`, the one the shell (`src-tauri/src/servers.rs`) talks to whatever the
//! kind. Auth stays in Rust: no URL or header with a password or token reaches the interface or a log.

use crate::art::Signed;
use crate::jellyfin::Jellyfin;
use crate::plex::Plex;
use crate::subsonic::Subsonic;
use anyhow::{Result, anyhow};
use music_core::model::{PlaylistRef, Track};
use music_core::server::{self, Account, Kind};
use std::time::Duration;
use url::Url;

/// One HTTP client for servers: a short connect timeout (a server that's off answers nothing), redirects on the same
/// host only (`X-Plex-Token` isn't a header reqwest drops on the way to another host).
pub(crate) fn http() -> reqwest::Client {
    static HTTP: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
        let same = reqwest::redirect::Policy::custom(|a| match a.previous().last() {
            _ if a.previous().len() > 5 => a.error("Your music server redirected too many times"),
            Some(from) if stays(from, a.url()) => a.follow(),
            _ => a.stop(),
        });
        crate::builder().connect_timeout(Duration::from_secs(10)).redirect(same).build().unwrap_or_default()
    });
    HTTP.clone()
}

/// A redirect a server's auth may follow: the same host, never from https down to http.
pub(crate) fn stays(from: &Url, to: &Url) -> bool {
    from.host_str() == to.host_str() && !(from.scheme() == "https" && to.scheme() != "https")
}

/// Lists can be long on a slow NAS.
pub(crate) const LIST_TIMEOUT: Duration = Duration::from_secs(60);
/// Covers asked at most this big (px): a folder's own scan can pass the art cache's 5 MB limit and show none; the
/// server cuts it (and keeps the cut). Twice the largest thumbnail (`artcache::SIZES`), enough for the full-screen cover.
pub(crate) const COVER_SIZE: &str = "1200";

/// A song's audio answer: status and headers for the player to judge (`music_player::http`), the body read on.
pub struct Streamed {
    pub status: u16,
    pub content_length: Option<u64>,
    pub content_range: Option<String>,
    pub content_type: Option<String>,
    pub body: Body,
}

impl Streamed {
    pub(crate) fn of(res: reqwest::Response) -> Self {
        let header = |h: reqwest::header::HeaderName| res.headers().get(h).and_then(|v| v.to_str().ok()).map(str::to_string);
        Self { status: res.status().as_u16(), content_length: res.content_length(), content_range: header(reqwest::header::CONTENT_RANGE), content_type: header(reqwest::header::CONTENT_TYPE), body: Body(res) }
    }
}

/// A stream's body, chunk by chunk.
pub struct Body(reqwest::Response);

impl Body {
    /// Next bytes; None = the end. Errors carry no URL (it may hold the auth).
    pub async fn chunk(&mut self) -> Result<Option<Vec<u8>>> {
        Ok(self.0.chunk().await.map_err(|e| anyhow!("{}", e.without_url()))?.map(|b| b.to_vec()))
    }
}

/// Network failures in words (English, `shared/errors.ts` maps them).
pub(crate) fn reach(e: reqwest::Error) -> anyhow::Error {
    // Its URL may carry the auth: never in an error the interface or a log sees.
    let chain = format!("{:#}", anyhow::Error::from(e.without_url()));
    let lower = chain.to_lowercase();
    if lower.contains("certificate") || lower.contains("self signed") || lower.contains("self-signed") || lower.contains("unknownissuer") {
        anyhow!("Your music server's certificate isn't trusted (a self-signed one?): give the server a certificate from a known authority, or use its http:// address on your network ({chain})")
    } else {
        anyhow!("Your music server doesn't answer: check that it's on and its address is right ({chain})")
    }
}

/// An HTTP refusal of a token-signed server (Jellyfin, Plex) in words; None = not one.
pub(crate) fn refusal(status: reqwest::StatusCode) -> Option<anyhow::Error> {
    let n = status.as_u16();
    match n {
        401 => Some(anyhow!("Your music server no longer accepts this sign-in: sign in again in Settings › Accounts")),
        403 => Some(anyhow!("Your music server doesn't let this user do that (HTTP 403)")),
        404 | 410 => Some(anyhow!("Your music server doesn't have this item (HTTP {n})")),
        500..=599 => Some(anyhow!("Your music server failed (HTTP {n})")),
        _ if !status.is_success() => Some(anyhow!("Your music server said: HTTP {n}")),
        _ => None,
    }
}

/// The server refused this account (wrong password, a token revoked): a sync stops at once.
pub fn refused(e: &anyhow::Error) -> bool {
    let t = e.to_string();
    t.starts_with("Your music server refused the sign-in") || t.starts_with("Your music server no longer accepts this sign-in")
}

/// An address by number skips the resolver (`Noted`): Settings › Privacy learns it here.
pub(crate) fn note(base: &str) {
    if server::host_of(base).is_some_and(|h| h.parse::<std::net::IpAddr>().is_ok()) {
        music_core::netlog::note_url(base, music_core::netlog::Via::App, false);
    }
}

/// An address as kept → as `Url` writes it (scheme and host in lowercase, a default port dropped): cover URLs built
/// from it start with it (`sign_cover`, `art::allow_server`).
pub(crate) fn base_of(address: &str) -> String {
    let typed = address.trim_end_matches('/');
    Url::parse(typed).map(|u| u.to_string().trim_end_matches('/').to_string()).unwrap_or_else(|_| typed.to_string())
}

/// An address `server::normalize` let through that URLs can be built on ("http://nas:99999" isn't one).
pub fn usable(address: &str) -> bool {
    Url::parse(&format!("{}/x", address.trim_end_matches('/'))).is_ok_and(|u| matches!(u.scheme(), "http" | "https") && u.host_str().is_some_and(|h| !h.is_empty()))
}

/// A server's own item id, safe inside a URL path (ids come from the server; a library row could be edited).
pub(crate) fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 100 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Random hex id (`bytes` long): a sign-in's own device id, never the PC's.
pub(crate) fn random_id(bytes: usize) -> String {
    (0..bytes).map(|_| format!("{:02x}", rand::random::<u8>())).collect()
}

/// A whole read of a server.
#[derive(Debug, Default)]
pub struct Read {
    pub songs: Vec<Track>,
    /// Its likes (Subsonic's stars, Jellyfin's favourites, Plex's 5 stars).
    pub liked: Vec<Track>,
    /// Parts that failed to come (albums, libraries): nothing is dropped when there are some.
    pub failed: usize,
}

/// One signed-in server, whatever its kind.
#[derive(Debug, Clone)]
pub enum Conn {
    Subsonic(Subsonic),
    Jellyfin(Jellyfin),
    Plex(Plex),
}

impl Conn {
    pub fn from_account(a: &Account) -> Self {
        match a.kind {
            Kind::Subsonic => Self::Subsonic(Subsonic::from_account(a)),
            Kind::Jellyfin => Self::Jellyfin(Jellyfin::from_account(a)),
            Kind::Plex => Self::Plex(Plex::from_account(a)),
        }
    }

    /// The account's key (library ids).
    pub fn key(&self) -> &str {
        match self {
            Self::Subsonic(s) => s.key(),
            Self::Jellyfin(j) => j.key(),
            Self::Plex(p) => p.key(),
        }
    }

    /// Base URL as `Url` writes it: its covers start with it.
    pub fn base(&self) -> &str {
        match self {
            Self::Subsonic(s) => s.base(),
            Self::Jellyfin(j) => j.base(),
            Self::Plex(p) => p.base(),
        }
    }

    /// What its cover URLs start with: its base (Plex: its key, the address in use changes).
    pub fn cover_base(&self) -> String {
        match self {
            Self::Plex(p) => p.cover_base(),
            _ => self.base().to_string(),
        }
    }

    /// One of its cover URLs (as the library keeps them, no auth) with the auth added; None = not one of its covers.
    pub fn sign_cover(&self, url: &str) -> Option<Signed> {
        match self {
            Self::Subsonic(s) => url.starts_with(&format!("{}/rest/getCoverArt.view?", s.base())).then(|| s.sign(url)).flatten().map(|url| Signed { url, headers: Vec::new() }),
            Self::Jellyfin(j) => j.sign(url),
            Self::Plex(p) => p.sign(url),
        }
    }

    pub async fn library(&self) -> Result<Read> {
        match self {
            Self::Subsonic(s) => {
                let (songs, failed) = s.library().await?;
                Ok(Read { songs, liked: s.starred().await?, failed })
            }
            Self::Jellyfin(j) => j.library().await,
            Self::Plex(p) => p.library().await,
        }
    }

    pub async fn playlists(&self) -> Result<Vec<PlaylistRef>> {
        match self {
            Self::Subsonic(s) => s.playlists().await,
            Self::Jellyfin(j) => j.playlists().await,
            Self::Plex(p) => p.playlists().await,
        }
    }

    pub async fn playlist(&self, id: &str) -> Result<Vec<Track>> {
        match self {
            Self::Subsonic(s) => s.playlist(id).await,
            Self::Jellyfin(j) => j.playlist(id).await,
            Self::Plex(p) => p.playlist(id).await,
        }
    }

    /// A song's lyrics as its server keeps them (Against Liner 14). Plex: lyrics are a Plex Pass extra, not asked.
    pub async fn lyrics(&self, item: &str, artist: &str, title: &str) -> Result<Option<music_core::lyrics::Record>> {
        match self {
            Self::Subsonic(s) => s.lyrics(item, artist, title).await,
            Self::Jellyfin(j) => j.lyrics(item).await,
            Self::Plex(_) => Ok(None),
        }
    }

    /// A song's ReplayGain as its server keeps it. Subsonic only (OpenSubsonic's `replayGain`): Jellyfin and Plex give
    /// their own loudness measures, not read.
    pub async fn replay_gain(&self, item: &str) -> Result<Option<music_core::local::ReplayGain>> {
        match self {
            Self::Subsonic(s) => s.replay_gain(item).await,
            _ => Ok(None),
        }
    }

    /// Songs added at the end of one of the server's playlists. Subsonic only for now.
    pub async fn playlist_add(&self, id: &str, items: &[String]) -> Result<()> {
        match self {
            Self::Subsonic(s) => s.playlist_add(id, items).await,
            _ => Err(anyhow::anyhow!(READ_ONLY)),
        }
    }

    /// A song out of one of the server's playlists, every occurrence. Subsonic only for now.
    pub async fn playlist_remove(&self, id: &str, item: &str) -> Result<()> {
        match self {
            Self::Subsonic(s) => s.playlist_remove(id, item).await,
            _ => Err(anyhow::anyhow!(READ_ONLY)),
        }
    }

    /// Songs matching `query` on the server itself.
    pub async fn search(&self, query: &str, count: usize) -> Result<Vec<Track>> {
        match self {
            Self::Subsonic(s) => s.search(query, count).await,
            Self::Jellyfin(j) => j.search(query, count).await,
            Self::Plex(p) => p.search(query, count).await,
        }
    }

    /// Like here = the server's own like (`item` = its id).
    pub async fn like(&self, item: &str, on: bool) -> Result<()> {
        match self {
            Self::Subsonic(s) => s.star(item, on).await,
            Self::Jellyfin(j) => j.favourite(item, on).await,
            Self::Plex(p) => p.rate(item, on).await,
        }
    }

    /// A play back to the server. At a song's start: `submission` false, no position (now playing). At its end:
    /// the position heard, `submission` = it counts (past half the song or 4 minutes).
    pub async fn played(&self, item: &str, started_at_ms: i64, submission: bool, position_ms: Option<u64>) -> Result<()> {
        match self {
            // Subsonic has no "stopped": only now playing and a listen.
            Self::Subsonic(s) => match (submission, position_ms) {
                (false, Some(_)) => Ok(()),
                _ => s.scrobble(item, started_at_ms, submission).await,
            },
            Self::Jellyfin(j) => match position_ms {
                None => j.now_playing(item).await,
                Some(at) => j.stopped(item, at, submission).await,
            },
            Self::Plex(p) => if submission { p.scrobble(item).await } else { Ok(()) },
        }
    }

    /// A song's audio from byte `from`: raw, or the server's MP3 (`transcode`, when the engine can't read the file).
    pub async fn stream(&self, item: &str, from: u64, transcode: bool) -> Result<Streamed> {
        match self {
            Self::Subsonic(s) => s.stream(item, from, transcode).await,
            Self::Jellyfin(j) => j.stream(item, from, transcode).await,
            Self::Plex(p) => p.stream(item, from, transcode).await,
        }
    }

    /// Sign out: Jellyfin's token ended on the server; Subsonic and Plex keep nothing there.
    pub async fn sign_out(&self) -> Result<()> {
        match self {
            Self::Jellyfin(j) => j.sign_out().await,
            _ => Ok(()),
        }
    }
}

/// Said when a playlist of a Jellyfin or Plex server is edited here.
pub const READ_ONLY: &str = "Playlists of a Jellyfin or Plex server can't be changed from Legato yet: change them on the server";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_from_a_server_stay_inside_their_path() {
        assert!(safe_id("4f1c9e0a2b") && safe_id("12345") && safe_id("tr-1_a"));
        assert!(!safe_id("") && !safe_id("../x") && !safe_id("a/b") && !safe_id("a?b") && !safe_id(&"a".repeat(101)));
    }

    #[test]
    fn a_servers_auth_follows_redirects_on_its_own_host_only() {
        let u = |s: &str| Url::parse(s).unwrap();
        assert!(stays(&u("http://nas:32400/a"), &u("https://nas:32400/a")));
        assert!(stays(&u("https://nas/a"), &u("https://nas:8443/b")));
        assert!(!stays(&u("https://nas/a"), &u("http://nas/a")), "never down to http");
        assert!(!stays(&u("https://nas/a"), &u("https://elsewhere.example/a")));
    }

    #[tokio::test]
    async fn a_redirect_to_another_host_is_not_followed() {
        let mut s = mockito::Server::new_async().await;
        s.mock("GET", "/away").with_status(302).with_header("location", "http://127.0.0.2:9/stolen").create_async().await;
        let res = http().get(format!("{}/away", s.url())).header("X-Plex-Token", "t").send().await.unwrap();
        assert_eq!(res.status().as_u16(), 302, "stopped, not followed");
    }

    #[test]
    fn http_refusals_in_words() {
        let said = |n: u16| refusal(reqwest::StatusCode::from_u16(n).unwrap()).map(|e| e.to_string());
        assert!(said(401).unwrap().starts_with("Your music server no longer accepts this sign-in"));
        assert!(refused(&refusal(reqwest::StatusCode::UNAUTHORIZED).unwrap()));
        assert!(said(404).unwrap().starts_with("Your music server doesn't have this item"));
        assert!(said(502).unwrap().starts_with("Your music server failed (HTTP 502)"));
        assert_eq!(said(200), None);
        assert_eq!(said(206), None);
        assert!(!refused(&anyhow!("Your music server doesn't answer")));
    }

    #[test]
    fn a_plex_account_plays_by_its_own_kind() {
        let a = Account { kind: Kind::Plex, address: "https://10-0-0-2.abc.plex.direct:32400".into(), user: "me".into(), token: "t".into(), device: "d".into(), server_id: "m".into(), connections: vec!["https://10-0-0-2.abc.plex.direct:32400".into()], ..Default::default() };
        let c = Conn::from_account(&a);
        assert!(matches!(c, Conn::Plex(_)));
        assert_eq!(c.key(), a.key());
        assert!(!format!("{c:?}").contains("\"t\""));
        let j = Account { kind: Kind::Jellyfin, address: "HTTP://NAS:8096".into(), user: "me".into(), token: "t".into(), user_id: "u".into(), device: "d".into(), ..Default::default() };
        let c = Conn::from_account(&j);
        assert_eq!((c.key(), c.base()), (j.key().as_str(), "http://nas:8096"));
        assert!(usable("http://nas:8096") && !usable("http://nas:99999"));
    }
}
