//! Plex Media Server: the user's own music on the user's own server (developer.plex.tv read 2026-11-06).
//! Sign-in by PIN only: `plex.tv/api/v2/pins?strong=true`, then the user's own browser at Plex's own page
//! (`app.plex.tv/auth`; the app never sees or types a password, never drives that page), the pin read again at a
//! gentle pace until its token or its expiry; then `plex.tv/api/v2/resources` lists the account's servers and their
//! addresses (a local one first, then a direct https one, Plex's relay only when nothing else answers). The server's
//! own token is kept (keychain), the account's forgotten. Every request carries `X-Plex-Token` in a header, never in a
//! URL anything shows or logs. Reads songs by pages (`X-Plex-Container-Start` / `-Size`), playlists, search; sends
//! likes as ratings (5 stars, Plexamp's "loved") and plays (`:/scrobble`). Audio: the part's file as kept.

use crate::art::Signed;
use crate::linklist::REQUEST_TIMEOUT;
use crate::servers::{COVER_SIZE, LIST_TIMEOUT, Read, Streamed, base_of, http, note, random_id, reach, refusal, safe_id};
use anyhow::{Result, anyhow, bail};
use music_core::model::{PlaylistRef, Source, Track};
use music_core::server::{self, Account};
use reqwest::Method;
use reqwest::header::{ACCEPT, RANGE};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use std::time::Duration;
use url::Url;

pub const PLEX_TV: &str = "https://plex.tv";
/// Plex's own sign-in page, opened in the user's browser.
pub const AUTH_APP: &str = "https://app.plex.tv/auth";
pub const PRODUCT: &str = "Legato";
/// Songs asked per page.
pub const PAGE: usize = 500;
/// Pages read at most: 500 000 songs.
const MAX_PAGES: usize = 1000;
/// The library's identifier in `:/rate` and `:/scrobble`.
const LIBRARY: &str = "com.plexapp.plugins.library";
/// A song's rating that means liked (Plex rates 0 to 10: 5 stars).
const LOVED: f64 = 10.0;
/// One address tried this long before the next.
const TRY_WAIT: Duration = Duration::from_secs(6);

/// A sign-in's own client identifier: random, 32 hex characters, never the PC's.
pub fn device_id() -> String {
    random_id(16)
}

fn platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "Windows",
        "android" => "Android",
        "macos" => "macOS",
        "linux" => "Linux",
        _ => "Other",
    }
}

/// What every Plex request says about the app (no PC name, no serial: the random client id only).
fn about(req: reqwest::RequestBuilder, client: &str) -> reqwest::RequestBuilder {
    req.header(ACCEPT, "application/json")
        .header("X-Plex-Product", PRODUCT)
        .header("X-Plex-Version", env!("CARGO_PKG_VERSION"))
        .header("X-Plex-Client-Identifier", client)
        .header("X-Plex-Platform", platform())
        .header("X-Plex-Device-Name", PRODUCT)
}

fn text(v: &Value, k: &str) -> Option<String> {
    match v.get(k)? {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// plex.tv's failures in words.
fn plex_tv(e: reqwest::Error) -> anyhow::Error {
    anyhow!("Plex's sign-in doesn't answer: check your internet connection, then try again ({})", e.without_url())
}

fn plex_tv_status(status: reqwest::StatusCode) -> Result<()> {
    match status.as_u16() {
        401 | 403 => bail!("Plex refused the sign-in: sign in with Plex again"),
        429 => bail!("Plex is busy right now: try again in a minute"),
        n if !status.is_success() => bail!("Plex's sign-in failed (HTTP {n}): try again later"),
        _ => Ok(()),
    }
}

/// A PIN waiting for the user on Plex's page.
#[derive(Debug, Clone, PartialEq)]
pub struct Pin {
    pub id: u64,
    pub code: String,
    /// Seconds left when made.
    pub expires_in: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PinState {
    Waiting,
    /// The account's token.
    Done(String),
    Expired,
}

/// One address of a server, as plex.tv gives it.
#[derive(Debug, Clone, PartialEq)]
pub struct Connection {
    pub uri: String,
    pub local: bool,
    pub relay: bool,
}

/// A server of the account.
#[derive(Clone, PartialEq)]
pub struct Resource {
    /// Machine identifier.
    pub id: String,
    pub name: String,
    pub owned: bool,
    /// The server's own token.
    pub token: String,
    pub connections: Vec<Connection>,
}

impl std::fmt::Debug for Resource {
    // Never the token.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Resource").field("id", &self.id).field("name", &self.name).field("connections", &self.connections).finish_non_exhaustive()
    }
}

/// Addresses in the order they're tried: on this network, then direct https, then direct http, Plex's relay last.
/// Plain http to a public address is left out: the token would cross the internet in clear (Plex's own "insecure
/// connections: on the same network").
pub fn order(all: &[Connection]) -> Vec<Connection> {
    let mut v: Vec<Connection> = all.iter().filter(|c| crate::servers::usable(&c.uri) && server::exposure(&c.uri) != server::Exposure::Open).cloned().collect();
    v.sort_by_key(|c| (c.relay, !c.local, !c.uri.to_ascii_lowercase().starts_with("https://")));
    v.dedup_by(|a, b| a.uri == b.uri);
    v
}

/// plex.tv: the PIN, the account's servers.
pub struct PlexTv {
    base: String,
    auth: String,
    client: String,
    http: reqwest::Client,
}

impl PlexTv {
    pub fn new(client: &str) -> Self {
        Self::with_urls(PLEX_TV, AUTH_APP, client)
    }

    pub fn with_urls(base: &str, auth: &str, client: &str) -> Self {
        Self { base: base.trim_end_matches('/').to_string(), auth: auth.to_string(), client: client.to_string(), http: http() }
    }

    /// A strong PIN (long code, longer life).
    pub async fn pin(&self) -> Result<Pin> {
        let res = about(self.http.post(format!("{}/api/v2/pins?strong=true", self.base)), &self.client).timeout(REQUEST_TIMEOUT).send().await.map_err(plex_tv)?;
        plex_tv_status(res.status())?;
        let v: Value = res.json().await.map_err(|_| anyhow!("Plex's sign-in failed: try again later"))?;
        Ok(Pin { id: v.get("id").and_then(Value::as_u64).ok_or_else(|| anyhow!("Plex's sign-in failed: try again later"))?, code: text(&v, "code").ok_or_else(|| anyhow!("Plex's sign-in failed: try again later"))?, expires_in: v.get("expiresIn").and_then(Value::as_u64).unwrap_or(900) })
    }

    /// Plex's own page for this PIN, for the user's browser.
    pub fn auth_url(&self, code: &str) -> String {
        let q = url::form_urlencoded::Serializer::new(String::new()).append_pair("clientID", &self.client).append_pair("code", code).append_pair("context[device][product]", PRODUCT).finish();
        format!("{}#?{q}", self.auth)
    }

    /// The PIN read again: claimed (its token), still waiting, or gone.
    pub async fn check(&self, pin: &Pin) -> Result<PinState> {
        let res = about(self.http.get(format!("{}/api/v2/pins/{}", self.base, pin.id)), &self.client).timeout(REQUEST_TIMEOUT).send().await.map_err(plex_tv)?;
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(PinState::Expired);
        }
        plex_tv_status(res.status())?;
        let v: Value = res.json().await.map_err(|_| anyhow!("Plex's sign-in failed: try again later"))?;
        Ok(match text(&v, "authToken") {
            Some(t) => PinState::Done(t),
            None if v.get("expiresIn").and_then(Value::as_i64).is_some_and(|s| s <= 0) => PinState::Expired,
            None => PinState::Waiting,
        })
    }

    async fn get(&self, path: &str, token: &str) -> Result<Value> {
        let res = about(self.http.get(format!("{}{path}", self.base)), &self.client).header("X-Plex-Token", token).timeout(REQUEST_TIMEOUT).send().await.map_err(plex_tv)?;
        plex_tv_status(res.status())?;
        res.json().await.map_err(|_| anyhow!("Plex's sign-in failed: try again later"))
    }

    /// The account's name.
    pub async fn user(&self, token: &str) -> Result<String> {
        let v = self.get("/api/v2/user", token).await?;
        Ok(text(&v, "username").or_else(|| text(&v, "title")).unwrap_or_else(|| "Plex".into()))
    }

    /// The account's media servers (owned first), with their addresses.
    pub async fn servers(&self, token: &str) -> Result<Vec<Resource>> {
        let v = self.get("/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1", token).await?;
        let mut all: Vec<Resource> = v
            .as_array()
            .map(|a| a.iter().filter(|r| text(r, "provides").is_some_and(|p| p.split(',').any(|x| x.trim() == "server"))).filter_map(resource).collect())
            .unwrap_or_default();
        all.sort_by_key(|r| !r.owned);
        Ok(all)
    }
}

fn resource(r: &Value) -> Option<Resource> {
    let connections = r
        .get("connections")
        .and_then(Value::as_array)
        .map(|c| c.iter().filter_map(|c| Some(Connection { uri: text(c, "uri")?, local: c.get("local").and_then(Value::as_bool).unwrap_or(false), relay: c.get("relay").and_then(Value::as_bool).unwrap_or(false) })).collect())
        .unwrap_or_default();
    Some(Resource { id: text(r, "clientIdentifier")?, name: text(r, "name").unwrap_or_else(|| "Plex".into()), owned: r.get("owned").and_then(Value::as_bool).unwrap_or(false), token: text(r, "accessToken")?, connections })
}

/// A server's addresses as an account keeps them: direct ones best first, then the relay's.
pub fn split(all: &[Connection]) -> (Vec<String>, Vec<String>) {
    let o = order(all);
    (o.iter().filter(|c| !c.relay).map(|c| c.uri.clone()).collect(), o.iter().filter(|c| c.relay).map(|c| c.uri.clone()).collect())
}

/// The machine at `base`, by `/identity`; None = no answer, or not a Plex server's.
async fn identity(base: &str, client: &str, token: Option<&str>) -> Option<Result<String, u16>> {
    let mut req = about(http().get(format!("{base}/identity")), client).timeout(TRY_WAIT);
    if let Some(t) = token {
        req = req.header("X-Plex-Token", t);
    }
    let res = req.send().await.ok()?;
    if !res.status().is_success() {
        return Some(Err(res.status().as_u16()));
    }
    res.json::<Value>().await.ok()?.get("MediaContainer").and_then(|m| text(m, "machineIdentifier")).map(Ok)
}

/// The first of `addresses` (in their order) that answers as this server (`/identity`). Asked without the token
/// first: whatever answers at a LAN address on another network never gets it. A server that wants it there gets it
/// over https only (a plex.direct certificate is that server's own).
pub async fn pick(addresses: &[String], token: &str, client: &str, server_id: &str) -> Result<String> {
    for c in addresses {
        let base = base_of(c);
        note(&base);
        let id = match identity(&base, client, None).await {
            Some(Err(401)) if base.starts_with("https://") => identity(&base, client, Some(token)).await,
            other => other,
        };
        if id.is_some_and(|id| id.is_ok_and(|id| id == server_id)) {
            return Ok(c.clone());
        }
    }
    bail!("Your music server doesn't answer: none of the addresses Plex gave for it answered (is it on?)")
}

/// Each song's file on its server, learnt at a sync or on a first play (`<server key>:<rating key>` → part path).
static PARTS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn remember(key: &str, item: &str, part: &str) {
    let mut all = PARTS.lock().unwrap();
    let map = all.get_or_insert_with(HashMap::new);
    // 200 000 songs at most in memory: past it, learnt again as they play.
    if map.len() > 200_000 {
        map.clear();
    }
    map.insert(format!("{key}:{item}"), part.to_string());
}

fn part_of(key: &str, item: &str) -> Option<String> {
    PARTS.lock().unwrap().as_ref()?.get(&format!("{key}:{item}")).cloned()
}

/// A part's path as the server gives it: its own library's files only.
fn part_path(v: &Value) -> Option<String> {
    let media = v.get("Media")?.as_array()?.first()?;
    let part = media.get("Part")?.as_array()?.first()?;
    text(part, "key").filter(|k| k.starts_with("/library/parts/") && !k.contains("..") && !k.contains('?') && !k.contains('#'))
}

#[derive(Clone)]
pub struct Plex {
    base: String,
    key: String,
    token: String,
    client: String,
    http: reqwest::Client,
}

impl std::fmt::Debug for Plex {
    // Never the token.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Plex").field("base", &self.base).finish_non_exhaustive()
    }
}

impl Plex {
    pub fn from_account(a: &Account) -> Self {
        Self { base: base_of(&a.address), key: a.key(), token: a.token.clone(), client: a.device.clone(), http: http() }
    }

    pub fn key(&self) -> &str {
        &self.key
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    fn url(&self, path: &str, query: &[(&str, &str)]) -> Result<Url> {
        note(&self.base);
        let mut u = Url::parse(&format!("{}{path}", self.base)).map_err(|_| anyhow!("Your music server's address isn't right"))?;
        if !query.is_empty() {
            u.query_pairs_mut().extend_pairs(query);
        }
        Ok(u)
    }

    fn request(&self, method: Method, url: Url) -> reqwest::RequestBuilder {
        about(self.http.request(method, url), &self.client).header("X-Plex-Token", &self.token)
    }

    async fn send(&self, method: Method, path: &str, query: &[(&str, &str)], page: Option<usize>, timeout: Duration) -> Result<reqwest::Response> {
        let mut req = self.request(method, self.url(path, query)?).timeout(timeout);
        if let Some(start) = page {
            req = req.header("X-Plex-Container-Start", start.to_string()).header("X-Plex-Container-Size", PAGE.to_string());
        }
        let res = req.send().await.map_err(reach)?;
        match refusal(res.status()) {
            Some(e) => Err(e),
            None => Ok(res),
        }
    }

    /// `MediaContainer` of an answer, and the list's whole size when the server says it.
    async fn get(&self, path: &str, query: &[(&str, &str)], page: Option<usize>, timeout: Duration) -> Result<(Value, Option<u64>)> {
        let res = self.send(Method::GET, path, query, page, timeout).await?;
        let header = res.headers().get("X-Plex-Container-Total-Size").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok());
        let v: Value = res.json().await.map_err(|_| anyhow!("That address isn't a Plex server"))?;
        let c = v.get("MediaContainer").cloned().ok_or_else(|| anyhow!("That address isn't a Plex server"))?;
        let total = header.or_else(|| c.get("totalSize").and_then(Value::as_u64));
        Ok((c, total))
    }

    async fn pages(&self, path: &str, query: &[(&str, &str)]) -> Result<Vec<Value>> {
        Ok(self.paged(path, query).await?.0)
    }

    /// Every entry of a list, page by page, and whether it all came (false: past `MAX_PAGES`).
    async fn paged(&self, path: &str, query: &[(&str, &str)]) -> Result<(Vec<Value>, bool)> {
        let mut all = Vec::new();
        // A server that ignores the start can't loop forever.
        for _ in 0..MAX_PAGES {
            // From what came: a server that pages less than asked skips nothing.
            let (c, total) = self.get(path, query, Some(all.len()), LIST_TIMEOUT).await?;
            let got = c.get("Metadata").and_then(Value::as_array).cloned().unwrap_or_default();
            let n = got.len();
            all.extend(got);
            // A server may page less than asked: the total decides when it says one.
            if n == 0 || total.map_or(n < PAGE, |t| all.len() as u64 >= t) {
                return Ok((all, true));
            }
        }
        Ok((all, false))
    }

    fn cover(&self, thumb: &str) -> Option<String> {
        if !thumb.starts_with("/library/") {
            return None;
        }
        let mut u = Url::parse(&format!("{}/photo/:/transcode", self.base)).ok()?;
        u.query_pairs_mut().append_pair("width", COVER_SIZE).append_pair("height", COVER_SIZE).append_pair("minSize", "1").append_pair("upscale", "0").append_pair("url", thumb);
        Some(u.to_string())
    }

    /// One of its cover URLs with the token header; None = not one of its covers.
    pub fn sign(&self, url: &str) -> Option<Signed> {
        url.strip_prefix(&self.base)?.starts_with("/photo/:/transcode?").then(|| Signed { url: url.to_string(), headers: vec![("X-Plex-Token", self.token.clone())] })
    }

    /// A track (`Metadata` of type track) as a library track, and whether it's loved. Its file's path is learnt.
    pub fn track(&self, v: &Value) -> Option<(Track, bool)> {
        if text(v, "type").is_some_and(|t| t != "track") {
            return None;
        }
        let id = text(v, "ratingKey").filter(|i| safe_id(i))?;
        let title = text(v, "title")?;
        if let Some(p) = part_path(v) {
            remember(&self.key, &id, &p);
        }
        let art = text(v, "thumb").or_else(|| text(v, "parentThumb")).and_then(|t| self.cover(&t));
        let loved = v.get("userRating").and_then(Value::as_f64).is_some_and(|r| r >= LOVED);
        Some((
            Track {
                title,
                // A song's own artist when it differs from the album's.
                artist: text(v, "originalTitle").or_else(|| text(v, "grandparentTitle")).unwrap_or_default(),
                album: text(v, "parentTitle"),
                duration_ms: v.get("duration").and_then(Value::as_u64).filter(|d| *d > 0).map(|d| d.min(u64::from(u32::MAX)) as u32),
                isrc: None,
                ids: BTreeMap::from([(Source::Server, server::item_id(&self.key, &id))]),
                art,
                musicness: None,
            },
            loved,
        ))
    }

    fn tracks(&self, entries: &[Value]) -> Vec<Track> {
        entries.iter().filter_map(|v| self.track(v)).map(|(t, _)| t).collect()
    }

    /// Its music libraries.
    pub async fn sections(&self) -> Result<Vec<String>> {
        let (c, _) = self.get("/library/sections", &[], None, REQUEST_TIMEOUT).await?;
        Ok(c.get("Directory").and_then(Value::as_array).map(|d| d.iter().filter(|s| text(s, "type").as_deref() == Some("artist")).filter_map(|s| text(s, "key").filter(|k| safe_id(k))).collect()).unwrap_or_default())
    }

    /// Every song of every music library, page by page; the loved ones among them. A library that fails is counted.
    pub async fn library(&self) -> Result<Read> {
        let mut r = Read::default();
        for k in self.sections().await? {
            match self.paged(&format!("/library/sections/{k}/all"), &[("type", "10")]).await {
                Ok((all, whole)) => {
                    // Past the last page read: the songs after it aren't gone, nothing dropped.
                    r.failed += usize::from(!whole);
                    for (t, loved) in all.iter().filter_map(|v| self.track(v)) {
                        if loved {
                            r.liked.push(t.clone());
                        }
                        r.songs.push(t);
                    }
                }
                Err(e) if crate::servers::refused(&e) => return Err(e),
                Err(_) => r.failed += 1,
            }
        }
        Ok(r)
    }

    pub async fn playlists(&self) -> Result<Vec<PlaylistRef>> {
        let (c, _) = self.get("/playlists", &[("playlistType", "audio")], None, LIST_TIMEOUT).await?;
        Ok(c.get("Metadata").and_then(Value::as_array).map(|a| a.iter().filter_map(|p| Some(PlaylistRef { id: text(p, "ratingKey").filter(|i| safe_id(i))?, name: text(p, "title").unwrap_or_else(|| "Playlist".into()) })).collect()).unwrap_or_default())
    }

    pub async fn playlist(&self, id: &str) -> Result<Vec<Track>> {
        if !safe_id(id) {
            bail!("Your music server doesn't have this item");
        }
        Ok(self.tracks(&self.pages(&format!("/playlists/{id}/items"), &[]).await?))
    }

    /// Songs matching `query` (`hubs/search`, its track hub).
    pub async fn search(&self, query: &str, count: usize) -> Result<Vec<Track>> {
        let n = count.clamp(1, 100).to_string();
        let (c, _) = self.get("/hubs/search", &[("query", query), ("limit", &n)], None, REQUEST_TIMEOUT).await?;
        let hubs = c.get("Hub").and_then(Value::as_array).cloned().unwrap_or_default();
        Ok(hubs.iter().filter(|h| text(h, "type").as_deref() == Some("track")).flat_map(|h| self.tracks(h.get("Metadata").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default())).collect())
    }

    fn item(item: &str) -> Result<&str> {
        if safe_id(item) { Ok(item) } else { bail!("Your music server doesn't have this item") }
    }

    /// Like here = 5 stars there; unlike = no rating.
    pub async fn rate(&self, item: &str, on: bool) -> Result<()> {
        self.send(Method::PUT, "/:/rate", &[("key", Self::item(item)?), ("identifier", LIBRARY), ("rating", if on { "10" } else { "-1" })], None, REQUEST_TIMEOUT).await.map(|_| ())
    }

    /// A play heard long enough.
    pub async fn scrobble(&self, item: &str) -> Result<()> {
        self.send(Method::GET, "/:/scrobble", &[("key", Self::item(item)?), ("identifier", LIBRARY)], None, REQUEST_TIMEOUT).await.map(|_| ())
    }

    /// The song's file on the server: learnt at the sync, else asked once.
    async fn part(&self, item: &str) -> Result<String> {
        if let Some(p) = part_of(&self.key, item) {
            return Ok(p);
        }
        let (c, _) = self.get(&format!("/library/metadata/{item}"), &[], None, REQUEST_TIMEOUT).await?;
        let v = c.get("Metadata").and_then(Value::as_array).and_then(|a| a.first()).ok_or_else(|| anyhow!("Your music server doesn't have this item"))?;
        let p = part_path(v).ok_or_else(|| anyhow!("Your music server sent no audio for this song"))?;
        remember(&self.key, item, &p);
        Ok(p)
    }

    /// A song's audio from byte `from`: the part's file as kept. Plex's transcoder isn't asked (part 2): a format the
    /// engine can't read says so.
    pub async fn stream(&self, item: &str, from: u64, transcode: bool) -> Result<Streamed> {
        let item = Self::item(item)?;
        if transcode {
            bail!("Your music server sent a format Legato can't play");
        }
        let part = self.part(item).await?;
        let res = self.request(Method::GET, self.url(&part, &[])?).header(RANGE, format!("bytes={from}-")).send().await.map_err(reach)?;
        Ok(Streamed::of(res))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};

    const TRACK: &str = r#"{"ratingKey":"101","key":"/library/metadata/101","type":"track","title":"Nightcall","grandparentTitle":"Kavinsky","parentTitle":"OutRun","originalTitle":"Kavinsky & Lovefoxxx","duration":258000,"thumb":"/library/metadata/100/thumb/1700000000","userRating":10.0,"Media":[{"id":1,"Part":[{"id":7,"key":"/library/parts/7/1700000000/file.flac","container":"flac"}]}]}"#;

    fn account(url: &str) -> Account {
        Account { kind: music_core::server::Kind::Plex, address: url.into(), connections: vec![url.into()], user: "me".into(), token: "srv-tok".into(), device: "cli1".into(), server_id: "m1".into(), ..Default::default() }
    }

    fn container(inner: &str) -> String {
        format!(r#"{{"MediaContainer":{{{inner}}}}}"#)
    }

    #[test]
    fn addresses_are_tried_local_then_https_then_the_relay() {
        let c = |uri: &str, local, relay| Connection { uri: uri.into(), local, relay };
        let all = [c("https://1-2-3-4.x.plex.direct:8443", false, true), c("http://203.0.113.5:32400", false, false), c("https://203-0-113-5.x.plex.direct:32400", false, false), c("https://192-168-1-10.x.plex.direct:32400", true, false), c("http://nas:99999", true, false)];
        let got: Vec<String> = order(&all).into_iter().map(|c| c.uri).collect();
        // Plain http to a public address: left out (the token in clear).
        assert_eq!(got, ["https://192-168-1-10.x.plex.direct:32400", "https://203-0-113-5.x.plex.direct:32400", "https://1-2-3-4.x.plex.direct:8443"]);
        let (direct, relays) = split(&all);
        assert_eq!((direct.len(), relays.as_slice()), (2, ["https://1-2-3-4.x.plex.direct:8443".to_string()].as_slice()));
        let lan = [c("http://192.168.1.10:32400", true, false), c("https://192-168-1-10.x.plex.direct:32400", true, false)];
        assert_eq!(order(&lan).into_iter().map(|c| c.uri).collect::<Vec<_>>(), ["https://192-168-1-10.x.plex.direct:32400", "http://192.168.1.10:32400"], "plain http kept on the LAN, after https");
    }

    #[tokio::test]
    async fn the_pin_is_made_its_page_opened_and_read_until_its_token() {
        let mut s = Server::new_async().await;
        let made = s.mock("POST", "/api/v2/pins").match_query(Matcher::UrlEncoded("strong".into(), "true".into())).match_header("x-plex-client-identifier", "cli1").match_header("x-plex-product", "Legato").with_status(201).with_body(r#"{"id":42,"code":"abcdEFGHijkl","authToken":null,"expiresIn":1800}"#).create_async().await;
        let pin = PlexTv::with_urls(&s.url(), "https://app.plex.tv/auth", "cli1");
        let p = pin.pin().await.unwrap();
        made.assert_async().await;
        assert_eq!(p, Pin { id: 42, code: "abcdEFGHijkl".into(), expires_in: 1800 });
        assert_eq!(pin.auth_url(&p.code), "https://app.plex.tv/auth#?clientID=cli1&code=abcdEFGHijkl&context%5Bdevice%5D%5Bproduct%5D=Legato");
        let waiting = s.mock("GET", "/api/v2/pins/42").with_body(r#"{"id":42,"code":"abcdEFGHijkl","authToken":null,"expiresIn":1700}"#).expect(1).create_async().await;
        assert_eq!(pin.check(&p).await.unwrap(), PinState::Waiting);
        waiting.remove_async().await;
        s.mock("GET", "/api/v2/pins/42").with_body(r#"{"id":42,"code":"abcdEFGHijkl","authToken":"acct-tok","expiresIn":1690}"#).create_async().await;
        assert_eq!(pin.check(&p).await.unwrap(), PinState::Done("acct-tok".into()));
        s.mock("GET", "/api/v2/pins/43").with_status(404).create_async().await;
        assert_eq!(pin.check(&Pin { id: 43, ..p.clone() }).await.unwrap(), PinState::Expired);
        s.mock("POST", "/api/v2/pins").match_query(Matcher::Any).match_header("x-plex-client-identifier", "cli2").with_status(429).create_async().await;
        assert!(PlexTv::with_urls(&s.url(), AUTH_APP, "cli2").pin().await.unwrap_err().to_string().starts_with("Plex is busy right now"));
        assert!(PlexTv::with_urls("http://127.0.0.1:9", AUTH_APP, "c").pin().await.unwrap_err().to_string().starts_with("Plex's sign-in doesn't answer"));
    }

    #[tokio::test]
    async fn the_accounts_servers_and_their_addresses() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/api/v2/user").match_header("x-plex-token", "acct-tok").with_body(r#"{"id":1,"uuid":"u","username":"me","title":"Me"}"#).create_async().await;
        s.mock("GET", "/api/v2/resources")
            .match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("includeHttps".into(), "1".into()), Matcher::UrlEncoded("includeRelay".into(), "1".into())]))
            .match_header("x-plex-token", "acct-tok")
            .with_body(r#"[{"name":"Phone","provides":"client,player","clientIdentifier":"p","accessToken":"x","owned":true,"connections":[]},{"name":"Friend","provides":"server","clientIdentifier":"m2","accessToken":"t2","owned":false,"connections":[]},{"name":"Attic","product":"Plex Media Server","provides":"server","clientIdentifier":"m1","accessToken":"srv-tok","owned":true,"connections":[{"protocol":"https","address":"192.168.1.10","port":32400,"uri":"https://192-168-1-10.abc.plex.direct:32400","local":true,"relay":false}]}]"#)
            .create_async()
            .await;
        s.mock("GET", "/api/v2/resources").match_query(Matcher::Any).match_header("x-plex-token", "old").with_status(401).create_async().await;
        let tv = PlexTv::with_urls(&s.url(), AUTH_APP, "cli1");
        assert_eq!(tv.user("acct-tok").await.unwrap(), "me");
        let all = tv.servers("acct-tok").await.unwrap();
        assert_eq!(all.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["Attic", "Friend"], "servers only, owned first");
        assert_eq!((all[0].token.as_str(), all[0].connections[0].local), ("srv-tok", true));
        assert!(!format!("{all:?}").contains("srv-tok"));
        assert!(tv.servers("old").await.unwrap_err().to_string().starts_with("Plex refused the sign-in"));
    }

    #[tokio::test]
    async fn the_first_address_that_answers_as_this_server_wins() {
        let mut s = Server::new_async().await;
        // The token never goes to an address before it answers as this server.
        s.mock("GET", "/identity").match_header("x-plex-token", Matcher::Missing).with_body(container(r#""machineIdentifier":"m1","version":"1.41""#)).create_async().await;
        let mut other = Server::new_async().await;
        let asked = other.mock("GET", "/identity").match_header("x-plex-token", Matcher::Missing).with_body(container(r#""machineIdentifier":"someone-else""#)).create_async().await;
        let mut blank = Server::new_async().await;
        blank.mock("GET", "/identity").with_body(r#"{"MediaContainer":{}}"#).create_async().await;
        let mut shut = Server::new_async().await;
        let no_token = shut.mock("GET", "/identity").with_status(401).expect(1).create_async().await;
        let got = pick(&["http://127.0.0.1:9".into(), other.url(), blank.url(), shut.url(), s.url()], "srv-tok", "cli1", "m1").await.unwrap();
        assert_eq!(got, s.url());
        asked.assert_async().await;
        // Plain http: a 401 isn't asked again with the token.
        no_token.assert_async().await;
        assert!(pick(&["http://127.0.0.1:9".into()], "srv-tok", "cli1", "m1").await.unwrap_err().to_string().starts_with("Your music server doesn't answer"));
    }

    #[tokio::test]
    async fn the_library_comes_by_pages_with_the_container_headers() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/library/sections").match_header("x-plex-token", "srv-tok").with_body(container(r#""Directory":[{"key":"1","type":"movie","title":"Films"},{"key":"3","type":"artist","title":"Music"}]"#)).create_async().await;
        let page: Vec<String> = (0..PAGE).map(|i| TRACK.replace("\"101\"", &format!("\"{}\"", 1000 + i)).replace("\"userRating\":10.0,", "")).collect();
        let first = s
            .mock("GET", "/library/sections/3/all")
            .match_query(Matcher::UrlEncoded("type".into(), "10".into()))
            .match_header("x-plex-container-start", "0")
            .match_header("x-plex-container-size", PAGE.to_string().as_str())
            .with_header("x-plex-container-total-size", (PAGE + 1).to_string().as_str())
            .with_body(container(&format!(r#""size":{PAGE},"Metadata":[{}]"#, page.join(","))))
            .create_async()
            .await;
        s.mock("GET", "/library/sections/3/all").match_query(Matcher::Any).match_header("x-plex-container-start", PAGE.to_string().as_str()).with_body(container(&format!(r#""size":1,"totalSize":{},"Metadata":[{TRACK}]"#, PAGE + 1))).create_async().await;
        let p = Plex::from_account(&account(&s.url()));
        let r = p.library().await.unwrap();
        first.assert_async().await;
        assert_eq!((r.songs.len(), r.liked.len(), r.failed), (PAGE + 1, 1, 0));
        let t = &r.liked[0];
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.album.as_deref(), t.duration_ms), ("Nightcall", "Kavinsky & Lovefoxxx", Some("OutRun"), Some(258_000)));
        assert_eq!(t.ids.get(&Source::Server), Some(&format!("{}:101", p.key())));
        let art = t.art.clone().unwrap();
        assert!(art.starts_with(&format!("{}/photo/:/transcode?width=1200&height=1200", s.url())) && !art.contains("tok"), "{art}");
        let signed = p.sign(&art).unwrap();
        assert_eq!(signed.headers, vec![("X-Plex-Token", "srv-tok".to_string())]);
        assert!(p.sign(&format!("{}/library/parts/7/file.flac", s.url())).is_none());
    }

    #[tokio::test]
    async fn playlists_search_ratings_and_plays() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/playlists").match_query(Matcher::UrlEncoded("playlistType".into(), "audio".into())).with_body(container(r#""Metadata":[{"ratingKey":"55","title":"Road","smart":false}]"#)).create_async().await;
        s.mock("GET", "/playlists/55/items").with_body(container(&format!(r#""totalSize":2,"Metadata":[{TRACK},{{"ratingKey":"9","type":"episode","title":"Pod"}}]"#))).create_async().await;
        s.mock("GET", "/hubs/search").match_query(Matcher::UrlEncoded("query".into(), "night call".into())).with_body(container(&format!(r#""Hub":[{{"type":"artist","Metadata":[{{"ratingKey":"1","type":"artist","title":"K"}}]}},{{"type":"track","Metadata":[{TRACK}]}}]"#))).create_async().await;
        let love = s.mock("PUT", "/:/rate").match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("key".into(), "101".into()), Matcher::UrlEncoded("rating".into(), "10".into()), Matcher::UrlEncoded("identifier".into(), LIBRARY.into())])).match_header("x-plex-token", "srv-tok").create_async().await;
        let unlove = s.mock("PUT", "/:/rate").match_query(Matcher::UrlEncoded("rating".into(), "-1".into())).create_async().await;
        let play = s.mock("GET", "/:/scrobble").match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("key".into(), "101".into()), Matcher::UrlEncoded("identifier".into(), LIBRARY.into())])).expect(1).create_async().await;
        let c = crate::servers::Conn::from_account(&account(&s.url()));
        assert_eq!(c.playlists().await.unwrap()[0].name, "Road");
        assert_eq!(c.playlist("55").await.unwrap().len(), 1, "an episode isn't a song");
        assert_eq!(c.search("night call", 10).await.unwrap().len(), 1);
        c.like("101", true).await.unwrap();
        c.like("101", false).await.unwrap();
        // Now playing and a play that didn't count send nothing; a counted one scrobbles.
        c.played("101", 0, false, None).await.unwrap();
        c.played("101", 0, false, Some(10_000)).await.unwrap();
        c.played("101", 0, true, Some(200_000)).await.unwrap();
        for m in [love, unlove, play] {
            m.assert_async().await;
        }
    }

    #[tokio::test]
    async fn the_stream_reads_the_parts_file_with_the_token_in_a_header() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/library/metadata/202").with_body(container(&format!(r#""Metadata":[{}]"#, TRACK.replace("\"101\"", "\"202\"").replace("/parts/7/", "/parts/8/")))).expect(1).create_async().await;
        let file = s.mock("GET", "/library/parts/8/1700000000/file.flac").match_header("x-plex-token", "srv-tok").match_header("range", "bytes=10-").with_status(206).with_header("content-range", "bytes 10-19/20").with_body(vec![3u8; 10]).expect(2).create_async().await;
        let p = Plex::from_account(&account(&s.url()));
        let r = p.stream("202", 10, false).await.unwrap();
        assert_eq!((r.status, r.content_range.as_deref()), (206, Some("bytes 10-19/20")));
        // The part is learnt once.
        p.stream("202", 10, false).await.unwrap();
        file.assert_async().await;
        assert!(p.stream("202", 0, true).await.err().unwrap().to_string().contains("format Legato can't play"));
        s.mock("GET", "/library/metadata/303").with_status(401).create_async().await;
        assert!(crate::servers::refused(&p.stream("303", 0, false).await.err().unwrap()));
    }
}
