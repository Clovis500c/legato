//! Jellyfin (10.9 or newer): the user's own music on the user's own server, its own API (OpenAPI 12.4 checked
//! 2026-11-06 at api.jellyfin.org). Sign-in by `Users/AuthenticateByName`: the password sent once, then only the access
//! token (keychain). Every request carries `Authorization: MediaBrowser Client=…, Device=…, DeviceId=…, Version=…,
//! Token=…`, a header, never in a URL anything shows or logs; the DeviceId is random per sign-in, never the PC's.
//! Reads songs by pages, playlists, favourites and search; sends favourites, playback reports and plays; Sign out ends
//! the token (`Sessions/Logout`). Audio: the file as kept (`static=true`), else the server's MP3 at 320 kbps.

use crate::art::Signed;
use crate::linklist::REQUEST_TIMEOUT;
use crate::servers::{COVER_SIZE, LIST_TIMEOUT, Read, Streamed, base_of, http, note, random_id, reach, refusal, safe_id};
use anyhow::{Result, anyhow, bail};
use music_core::lyrics::{self, Record};
use music_core::model::{PlaylistRef, Source, Track};
use music_core::server::{self, Account, Kind};
use reqwest::Method;
use reqwest::header::{AUTHORIZATION, RANGE};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::time::Duration;
use url::Url;

pub const CLIENT: &str = "Legato";
/// Songs asked per page.
pub const PAGE: usize = 500;
/// Pages read at most: 500 000 songs.
const MAX_PAGES: usize = 1000;
/// `/Items?userId=`, `UserFavoriteItems` and `UserPlayedItems` came with 10.9.
const OLDEST: (u32, u32) = (10, 9);
/// Transcoded streams: MP3 at this bit rate (bit/s).
const MAX_BIT_RATE: &str = "320000";
/// RunTimeTicks: 100 ns.
const TICKS_PER_MS: u64 = 10_000;

/// A sign-in's own device id: random, 32 hex characters.
pub fn device_id() -> String {
    random_id(16)
}

/// The device's name as the server's Dashboard shows it: the app and the system, never the PC's own name.
fn device_name() -> &'static str {
    match std::env::consts::OS {
        "windows" => "Legato on Windows",
        "android" => "Legato on Android",
        "macos" => "Legato on macOS",
        "linux" => "Legato on Linux",
        _ => "Legato",
    }
}

/// Jellyfin's `Authorization` header (`Token` once signed in).
pub fn authorization(device: &str, token: Option<&str>) -> String {
    // Values quoted: no quote or line break inside (ours, or the server's own token).
    let clean = |s: &str| s.replace(['"', '\r', '\n', '\\'], "");
    let mut h = format!(r#"MediaBrowser Client="{CLIENT}", Device="{}", DeviceId="{}", Version="{}""#, device_name(), clean(device), env!("CARGO_PKG_VERSION"));
    if let Some(t) = token {
        h.push_str(&format!(r#", Token="{}""#, clean(t)));
    }
    h
}

/// What `System/Info/Public` says.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Info {
    pub name: String,
    pub version: String,
}

fn not_jellyfin() -> anyhow::Error {
    anyhow!("That address isn't a Jellyfin server: check it (Jellyfin's is like http://192.168.1.10:8096)")
}

/// "10.10.3" → new enough.
pub fn version_ok(v: &str) -> bool {
    let mut n = v.trim().split('.').map(|p| p.parse::<u32>().unwrap_or(0));
    (n.next().unwrap_or(0), n.next().unwrap_or(0)) >= OLDEST
}

fn text(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn items(v: &Value) -> Vec<Value> {
    v.get("Items").and_then(Value::as_array).cloned().unwrap_or_default()
}

/// The server answers as a Jellyfin new enough for Legato. No auth.
pub async fn info(address: &str) -> Result<Info> {
    let base = base_of(address);
    note(&base);
    let url = Url::parse(&format!("{base}/System/Info/Public")).map_err(|_| anyhow!("Your music server's address isn't right"))?;
    let res = http().get(url).timeout(REQUEST_TIMEOUT).send().await.map_err(reach)?;
    if res.status().is_server_error() {
        bail!("Your music server failed (HTTP {})", res.status().as_u16());
    }
    let v: Value = res.json().await.map_err(|_| not_jellyfin())?;
    let version = text(&v, "Version").ok_or_else(not_jellyfin)?;
    // Emby answers the same path: its API parted from Jellyfin's.
    if text(&v, "ProductName").is_some_and(|p| !p.to_lowercase().contains("jellyfin")) {
        return Err(not_jellyfin());
    }
    if !version_ok(&version) {
        bail!("Your music server is too old for Legato: it needs Jellyfin 10.9 or newer (it has {version})");
    }
    Ok(Info { name: text(&v, "ServerName").unwrap_or_default(), version })
}

/// Sign-in: the server checked, the password sent once, the account back with its token (the password not kept).
/// `address` as `server::normalize` left it.
pub async fn sign_in(address: &str, user: &str, password: &str) -> Result<Account> {
    let info = info(address).await?;
    let device = device_id();
    let url = Url::parse(&format!("{}/Users/AuthenticateByName", base_of(address))).map_err(|_| anyhow!("Your music server's address isn't right"))?;
    let res = http().post(url).header(AUTHORIZATION, authorization(&device, None)).json(&json!({ "Username": user, "Pw": password })).timeout(REQUEST_TIMEOUT).send().await.map_err(reach)?;
    let status = res.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        bail!("Your music server refused the sign-in: check the user and the password");
    }
    if let Some(e) = refusal(status) {
        return Err(e);
    }
    let v: Value = res.json().await.map_err(|_| not_jellyfin())?;
    let token = text(&v, "AccessToken").ok_or_else(not_jellyfin)?;
    let user_id = v.get("User").and_then(|u| text(u, "Id")).ok_or_else(not_jellyfin)?;
    Ok(Account { kind: Kind::Jellyfin, address: address.trim_end_matches('/').to_string(), user: user.to_string(), token, user_id, device, name: info.name, ..Default::default() })
}

#[derive(Clone)]
pub struct Jellyfin {
    base: String,
    key: String,
    user_id: String,
    token: String,
    device: String,
    http: reqwest::Client,
}

impl std::fmt::Debug for Jellyfin {
    // Never the token.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Jellyfin").field("base", &self.base).field("user_id", &self.user_id).finish_non_exhaustive()
    }
}

impl Jellyfin {
    pub fn from_account(a: &Account) -> Self {
        Self { base: base_of(&a.address), key: a.key(), user_id: a.user_id.clone(), token: a.token.clone(), device: a.device.clone(), http: http() }
    }

    pub fn key(&self) -> &str {
        &self.key
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    fn header(&self) -> String {
        authorization(&self.device, Some(&self.token))
    }

    fn url(&self, path: &str, query: &[(&str, &str)]) -> Result<Url> {
        note(&self.base);
        let mut u = Url::parse(&format!("{}{path}", self.base)).map_err(|_| anyhow!("Your music server's address isn't right"))?;
        if !query.is_empty() {
            u.query_pairs_mut().extend_pairs(query);
        }
        Ok(u)
    }

    async fn send(&self, method: Method, path: &str, query: &[(&str, &str)], body: Option<Value>, timeout: Duration) -> Result<reqwest::Response> {
        let mut req = self.http.request(method, self.url(path, query)?).header(AUTHORIZATION, self.header()).timeout(timeout);
        if let Some(b) = body {
            req = req.json(&b);
        }
        let res = req.send().await.map_err(reach)?;
        match refusal(res.status()) {
            Some(e) => Err(e),
            None => Ok(res),
        }
    }

    async fn get(&self, path: &str, query: &[(&str, &str)], timeout: Duration) -> Result<Value> {
        self.send(Method::GET, path, query, None, timeout).await?.json().await.map_err(|_| not_jellyfin())
    }

    /// A cover URL without auth (the header is added by `sign` when Rust fetches it).
    fn cover(&self, id: &str, tag: Option<&str>) -> Option<String> {
        if !safe_id(id) {
            return None;
        }
        let mut u = Url::parse(&format!("{}/Items/{id}/Images/Primary", self.base)).ok()?;
        u.query_pairs_mut().append_pair("maxWidth", COVER_SIZE);
        if let Some(t) = tag {
            u.query_pairs_mut().append_pair("tag", t);
        }
        Some(u.to_string())
    }

    /// One of its cover URLs with the token header; None = not one of its covers.
    pub fn sign(&self, url: &str) -> Option<Signed> {
        let rest = url.strip_prefix(&self.base)?.strip_prefix("/Items/")?;
        let (_, after) = rest.split_once('/')?;
        after.starts_with("Images/Primary").then(|| Signed { url: url.to_string(), headers: vec![("authorization", self.header())] })
    }

    /// A song entry (`BaseItemDto`) as a library track. Anything but audio: None.
    pub fn track(&self, v: &Value) -> Option<Track> {
        if text(v, "Type").is_some_and(|t| t != "Audio") {
            return None;
        }
        let id = text(v, "Id").filter(|i| safe_id(i))?;
        let title = text(v, "Name")?;
        let artists: Vec<&str> = v.get("Artists").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).filter(|s| !s.trim().is_empty()).collect()).unwrap_or_default();
        let artist = if artists.is_empty() { text(v, "AlbumArtist").unwrap_or_default() } else { artists.join(", ") };
        let isrc = v.get("ProviderIds").and_then(|p| p.get("ISRC").or_else(|| p.get("Isrc"))).and_then(Value::as_str).filter(|s| s.len() == 12).map(str::to_uppercase);
        let tag = |k: &str| v.get("ImageTags").and_then(|t| t.get(k)).and_then(Value::as_str);
        let art = match tag("Primary") {
            Some(t) => self.cover(&id, Some(t)),
            None => match (text(v, "AlbumId"), v.get("AlbumPrimaryImageTag").and_then(Value::as_str)) {
                (Some(album), Some(t)) => self.cover(&album, Some(t)),
                _ => None,
            },
        };
        Some(Track {
            title,
            artist,
            album: text(v, "Album"),
            duration_ms: v.get("RunTimeTicks").and_then(Value::as_u64).map(|t| t / TICKS_PER_MS).filter(|d| *d > 0).map(|d| d.min(u64::from(u32::MAX)) as u32),
            isrc,
            ids: BTreeMap::from([(Source::Server, server::item_id(&self.key, &id))]),
            art,
            musicness: None,
            explicit: false,
        })
    }

    /// Every entry of a list, page by page.
    async fn pages(&self, path: &str, query: &[(&str, &str)]) -> Result<Vec<Value>> {
        Ok(self.paged(path, query).await?.0)
    }

    /// Every entry of a list, page by page, and whether it all came (false: past `MAX_PAGES`).
    async fn paged(&self, path: &str, query: &[(&str, &str)]) -> Result<(Vec<Value>, bool)> {
        let mut all = Vec::new();
        let limit = PAGE.to_string();
        // A server that ignores the start can't loop forever.
        for _ in 0..MAX_PAGES {
            // From what came: a server that pages less than asked skips nothing.
            let start = all.len().to_string();
            let mut q = query.to_vec();
            q.extend([("startIndex", start.as_str()), ("limit", limit.as_str()), ("enableTotalRecordCount", "true")]);
            let v = self.get(path, &q, LIST_TIMEOUT).await?;
            let got = items(&v);
            let n = got.len();
            all.extend(got);
            // A server (or a proxy) may page less than asked: the total decides when it says one.
            let total = v.get("TotalRecordCount").and_then(Value::as_u64);
            if n == 0 || total.map_or(n < PAGE, |t| all.len() as u64 >= t) {
                return Ok((all, true));
            }
        }
        Ok((all, false))
    }

    fn songs_query<'a>(&'a self, extra: &[(&'a str, &'a str)]) -> Vec<(&'a str, &'a str)> {
        let mut q = vec![("userId", self.user_id.as_str()), ("includeItemTypes", "Audio"), ("recursive", "true"), ("fields", "ProviderIds"), ("enableUserData", "true"), ("enableImageTypes", "Primary"), ("imageTypeLimit", "1")];
        q.extend_from_slice(extra);
        q
    }

    /// Every song, page by page; its favourites among them.
    pub async fn library(&self) -> Result<Read> {
        let (all, whole) = self.paged("/Items", &self.songs_query(&[("sortBy", "SortName"), ("sortOrder", "Ascending")])).await?;
        let liked = all.iter().filter(|v| v.get("UserData").and_then(|u| u.get("IsFavorite")).and_then(Value::as_bool) == Some(true)).filter_map(|v| self.track(v)).collect();
        // Past the last page read: the songs after it aren't gone, nothing dropped.
        Ok(Read { songs: all.iter().filter_map(|v| self.track(v)).collect(), liked, failed: usize::from(!whole) })
    }

    /// Favourite songs only.
    pub async fn favourites(&self) -> Result<Vec<Track>> {
        Ok(self.pages("/Items", &self.songs_query(&[("isFavorite", "true")])).await?.iter().filter_map(|v| self.track(v)).collect())
    }

    pub async fn playlists(&self) -> Result<Vec<PlaylistRef>> {
        let all = self.pages("/Items", &[("userId", self.user_id.as_str()), ("includeItemTypes", "Playlist"), ("recursive", "true")]).await?;
        // Video playlists aren't music.
        Ok(all.iter().filter(|p| text(p, "MediaType").is_none_or(|m| m == "Audio" || m == "Unknown")).filter_map(|p| Some(PlaylistRef { id: text(p, "Id").filter(|i| safe_id(i))?, name: text(p, "Name").unwrap_or_else(|| "Playlist".into()) })).collect())
    }

    pub async fn playlist(&self, id: &str) -> Result<Vec<Track>> {
        if !safe_id(id) {
            bail!("Your music server doesn't have this item");
        }
        let all = self.pages(&format!("/Playlists/{id}/Items"), &[("userId", self.user_id.as_str()), ("fields", "ProviderIds"), ("enableImageTypes", "Primary"), ("imageTypeLimit", "1")]).await?;
        Ok(all.iter().filter_map(|v| self.track(v)).collect())
    }

    /// Songs matching `query`.
    pub async fn search(&self, query: &str, count: usize) -> Result<Vec<Track>> {
        let n = count.clamp(1, 100).to_string();
        let v = self.get("/Items", &self.songs_query(&[("searchTerm", query), ("limit", n.as_str())]), REQUEST_TIMEOUT).await?;
        Ok(items(&v).iter().filter_map(|v| self.track(v)).collect())
    }

    /// A song's lyrics (Against Liner 14; Jellyfin 10.9+, `/Audio/{id}/Lyrics`): timed when its lines have starts (in
    /// ticks of 100 ns), else plain. None: it has none.
    pub async fn lyrics(&self, item: &str) -> Result<Option<Record>> {
        let v = self.get(&format!("/Audio/{}/Lyrics", Self::item(item)?), &[], REQUEST_TIMEOUT).await?;
        let lines: Vec<(Option<i64>, String)> = v.get("Lyrics").and_then(Value::as_array).into_iter().flatten().map(|l| (l.get("Start").and_then(Value::as_i64), l.get("Text").and_then(Value::as_str).unwrap_or_default().to_string())).collect();
        if lines.iter().all(|(_, t)| t.trim().is_empty()) {
            return Ok(None);
        }
        if lines.iter().all(|(at, _)| at.is_some()) {
            let timed = lines.into_iter().filter_map(|(at, t)| Some((at?.max(0) as u64 / TICKS_PER_MS, t)));
            return Ok(Some(Record { synced: Some(lyrics::to_lrc(timed)), ..Default::default() }));
        }
        Ok(Some(Record { plain: Some(lines.into_iter().map(|(_, t)| t).collect::<Vec<_>>().join("\n")), ..Default::default() }))
    }

    fn item(item: &str) -> Result<&str> {
        if safe_id(item) { Ok(item) } else { bail!("Your music server doesn't have this item") }
    }

    /// Like here = favourite there.
    pub async fn favourite(&self, item: &str, on: bool) -> Result<()> {
        let path = format!("/UserFavoriteItems/{}", Self::item(item)?);
        self.send(if on { Method::POST } else { Method::DELETE }, &path, &[("userId", &self.user_id)], None, REQUEST_TIMEOUT).await.map(|_| ())
    }

    /// Now playing, at a song's start.
    pub async fn now_playing(&self, item: &str) -> Result<()> {
        let body = json!({ "ItemId": Self::item(item)?, "PositionTicks": 0, "CanSeek": true, "IsPaused": false, "PlayMethod": "DirectPlay" });
        self.send(Method::POST, "/Sessions/Playing", &[], Some(body), REQUEST_TIMEOUT).await.map(|_| ())
    }

    /// A song's end: the position reached, and a play counted when it was heard long enough (`played`).
    pub async fn stopped(&self, item: &str, position_ms: u64, played: bool) -> Result<()> {
        let id = Self::item(item)?;
        let body = json!({ "ItemId": id, "PositionTicks": position_ms.saturating_mul(TICKS_PER_MS) });
        self.send(Method::POST, "/Sessions/Playing/Stopped", &[], Some(body), REQUEST_TIMEOUT).await?;
        if played {
            self.send(Method::POST, &format!("/UserPlayedItems/{id}"), &[("userId", &self.user_id)], None, REQUEST_TIMEOUT).await?;
        }
        Ok(())
    }

    /// A song's audio from byte `from`: the file as kept, or the server's MP3. Status and headers are the player's to judge.
    pub async fn stream(&self, item: &str, from: u64, transcode: bool) -> Result<Streamed> {
        let path = format!("/Audio/{}/stream", Self::item(item)?);
        let query: &[(&str, &str)] = if transcode { &[("container", "mp3"), ("audioCodec", "mp3"), ("audioBitRate", MAX_BIT_RATE)] } else { &[("static", "true")] };
        let res = self.http.get(self.url(&path, query)?).header(AUTHORIZATION, self.header()).header(RANGE, format!("bytes={from}-")).send().await.map_err(reach)?;
        Ok(Streamed::of(res))
    }

    /// Sign out: the token ends on the server too.
    pub async fn sign_out(&self) -> Result<()> {
        self.send(Method::POST, "/Sessions/Logout", &[], None, REQUEST_TIMEOUT).await.map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};

    const INFO: &str = r#"{"LocalAddress":"http://192.168.1.10:8096","ServerName":"Attic","Version":"10.10.3","ProductName":"Jellyfin Server","OperatingSystem":"","Id":"f00d","StartupWizardCompleted":true}"#;
    const AUTH: &str = r#"{"User":{"Name":"me","Id":"u1","ServerId":"f00d"},"SessionInfo":{},"AccessToken":"tok123","ServerId":"f00d"}"#;
    const SONG: &str = r#"{"Name":"Nightcall","Id":"a1b2","Type":"Audio","Album":"OutRun","AlbumId":"al1","AlbumPrimaryImageTag":"tagA","Artists":["Kavinsky","Lovefoxxx"],"AlbumArtist":"Kavinsky","RunTimeTicks":2580000000,"ProviderIds":{"MusicBrainzTrack":"x"},"ImageTags":{},"UserData":{"IsFavorite":true,"PlayCount":3}}"#;

    fn account(url: &str) -> Account {
        Account { kind: Kind::Jellyfin, address: url.into(), user: "me".into(), token: "tok123".into(), user_id: "u1".into(), device: "dev1".into(), ..Default::default() }
    }

    fn signed() -> Matcher {
        Matcher::Regex(r#"^MediaBrowser Client="Legato", Device="Legato[^"]*", DeviceId="dev1", Version="[^"]+", Token="tok123"$"#.into())
    }

    #[test]
    fn versions_and_the_header() {
        assert!(version_ok("10.9.0") && version_ok("10.10.3") && version_ok("11.0") && !version_ok("10.8.13") && !version_ok("junk"));
        let h = authorization("d\"1", Some("t\r\nX: y"));
        assert!(h.starts_with(r#"MediaBrowser Client="Legato", Device="Legato"#) && h.contains(r#"DeviceId="d1""#) && h.ends_with(r#"Token="tX: y""#), "{h}");
        assert_ne!(device_id(), device_id());
        assert_eq!(device_id().len(), 32);
    }

    #[tokio::test]
    async fn sign_in_sends_the_password_once_and_keeps_the_token() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/System/Info/Public").with_body(INFO).create_async().await;
        let m = s
            .mock("POST", "/Users/AuthenticateByName")
            .match_header("authorization", Matcher::Regex(r#"^MediaBrowser Client="Legato", Device="[^"]+", DeviceId="[0-9a-f]{32}", Version="[^"]+"$"#.into()))
            .match_body(Matcher::Json(json!({ "Username": "me", "Pw": "pw" })))
            .with_body(AUTH)
            .create_async()
            .await;
        let a = sign_in(&s.url(), "me", "pw").await.unwrap();
        m.assert_async().await;
        assert_eq!((a.kind, a.token.as_str(), a.user_id.as_str(), a.name.as_str(), a.password.as_str()), (Kind::Jellyfin, "tok123", "u1", "Attic", ""));
        assert!(a.complete());
    }

    #[tokio::test]
    async fn sign_in_failures_in_words() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/System/Info/Public").with_body(INFO).create_async().await;
        s.mock("POST", "/Users/AuthenticateByName").with_status(401).with_body("Error processing request.").create_async().await;
        assert!(sign_in(&s.url(), "me", "bad").await.unwrap_err().to_string().starts_with("Your music server refused the sign-in"));
        let mut old = Server::new_async().await;
        old.mock("GET", "/System/Info/Public").with_body(INFO.replace("10.10.3", "10.8.13")).create_async().await;
        assert!(info(&old.url()).await.unwrap_err().to_string().starts_with("Your music server is too old for Legato: it needs Jellyfin 10.9"));
        let mut web = Server::new_async().await;
        web.mock("GET", "/System/Info/Public").with_body("<html>").create_async().await;
        assert!(info(&web.url()).await.unwrap_err().to_string().starts_with("That address isn't a Jellyfin server"));
        let mut emby = Server::new_async().await;
        emby.mock("GET", "/System/Info/Public").with_body(INFO.replace("Jellyfin Server", "Emby Server")).create_async().await;
        assert!(info(&emby.url()).await.unwrap_err().to_string().starts_with("That address isn't a Jellyfin server"));
        assert!(info("http://127.0.0.1:9").await.unwrap_err().to_string().starts_with("Your music server doesn't answer"));
    }

    #[tokio::test]
    async fn the_library_comes_page_by_page_with_its_favourites() {
        let mut s = Server::new_async().await;
        let page: Vec<String> = (0..PAGE).map(|i| SONG.replace("a1b2", &format!("s{i}")).replace("\"IsFavorite\":true", "\"IsFavorite\":false")).collect();
        let first = s
            .mock("GET", "/Items")
            .match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("userId".into(), "u1".into()), Matcher::UrlEncoded("includeItemTypes".into(), "Audio".into()), Matcher::UrlEncoded("recursive".into(), "true".into()), Matcher::UrlEncoded("startIndex".into(), "0".into())]))
            .match_header("authorization", signed())
            .with_body(format!(r#"{{"Items":[{}],"TotalRecordCount":{},"StartIndex":0}}"#, page.join(","), PAGE + 1))
            .create_async()
            .await;
        s.mock("GET", "/Items").match_query(Matcher::UrlEncoded("startIndex".into(), PAGE.to_string())).with_body(format!(r#"{{"Items":[{SONG}],"TotalRecordCount":{},"StartIndex":{PAGE}}}"#, PAGE + 1)).create_async().await;
        let j = Jellyfin::from_account(&account(&s.url()));
        let r = j.library().await.unwrap();
        first.assert_async().await;
        assert_eq!((r.songs.len(), r.liked.len(), r.failed), (PAGE + 1, 1, 0));
        let t = &r.liked[0];
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.album.as_deref(), t.duration_ms), ("Nightcall", "Kavinsky, Lovefoxxx", Some("OutRun"), Some(258_000)));
        assert_eq!(t.ids.get(&Source::Server), Some(&format!("{}:a1b2", j.key())));
        // The album's cover, no token in its URL: the header comes when Rust fetches it.
        let art = t.art.clone().unwrap();
        assert_eq!(art, format!("{}/Items/al1/Images/Primary?maxWidth=1200&tag=tagA", s.url()));
        let signed = j.sign(&art).unwrap();
        assert!(signed.url == art && signed.headers[0].1.contains("Token=\"tok123\""));
        assert!(j.sign(&format!("{}/Audio/a1b2/stream", s.url())).is_none() && j.sign("http://elsewhere/Items/1/Images/Primary").is_none());
    }

    #[tokio::test]
    async fn a_server_that_pages_less_than_asked_is_read_to_its_total() {
        let mut s = Server::new_async().await;
        let song = |id: &str| SONG.replace("a1b2", id);
        // Two per page (a proxy's cap), three in all: the short first page isn't the end.
        s.mock("GET", "/Items").match_query(Matcher::UrlEncoded("startIndex".into(), "0".into())).with_body(format!(r#"{{"Items":[{},{}],"TotalRecordCount":3}}"#, song("x1"), song("x2"))).create_async().await;
        s.mock("GET", "/Items").match_query(Matcher::UrlEncoded("startIndex".into(), "2".into())).with_body(format!(r#"{{"Items":[{}],"TotalRecordCount":3}}"#, song("x3"))).create_async().await;
        let r = Jellyfin::from_account(&account(&s.url())).library().await.unwrap();
        assert_eq!((r.songs.len(), r.failed), (3, 0));
    }

    #[tokio::test]
    async fn a_revoked_token_says_sign_in_again() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/Items").match_query(Matcher::Any).with_status(401).create_async().await;
        let e = Jellyfin::from_account(&account(&s.url())).library().await.unwrap_err();
        assert!(crate::servers::refused(&e), "{e}");
    }

    #[tokio::test]
    async fn playlists_favourites_and_search() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/Items").match_query(Matcher::UrlEncoded("includeItemTypes".into(), "Playlist".into())).with_body(r#"{"Items":[{"Id":"p1","Name":"Road","MediaType":"Audio"},{"Id":"p2","Name":"Films","MediaType":"Video"}],"TotalRecordCount":2}"#).create_async().await;
        s.mock("GET", "/Playlists/p1/Items").match_query(Matcher::UrlEncoded("userId".into(), "u1".into())).with_body(format!(r#"{{"Items":[{SONG},{{"Id":"v1","Name":"Clip","Type":"MusicVideo"}}],"TotalRecordCount":2}}"#)).create_async().await;
        s.mock("GET", "/Items").match_query(Matcher::UrlEncoded("isFavorite".into(), "true".into())).with_body(format!(r#"{{"Items":[{SONG}],"TotalRecordCount":1}}"#)).create_async().await;
        s.mock("GET", "/Items").match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("searchTerm".into(), "night call".into()), Matcher::UrlEncoded("limit".into(), "20".into())])).with_body(format!(r#"{{"Items":[{SONG}]}}"#)).create_async().await;
        let j = Jellyfin::from_account(&account(&s.url()));
        let lists = j.playlists().await.unwrap();
        assert_eq!(lists.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["Road"]);
        assert_eq!(j.playlist("p1").await.unwrap().len(), 1, "a video isn't a song");
        assert!(j.playlist("../x").await.is_err());
        assert_eq!(j.favourites().await.unwrap().len(), 1);
        assert_eq!(j.search("night call", 20).await.unwrap()[0].title, "Nightcall");
    }

    #[tokio::test]
    async fn likes_reports_and_sign_out() {
        let mut s = Server::new_async().await;
        let fav = s.mock("POST", "/UserFavoriteItems/a1b2").match_query(Matcher::UrlEncoded("userId".into(), "u1".into())).match_header("authorization", signed()).create_async().await;
        let unfav = s.mock("DELETE", "/UserFavoriteItems/a1b2").match_query(Matcher::UrlEncoded("userId".into(), "u1".into())).create_async().await;
        let start = s.mock("POST", "/Sessions/Playing").match_body(Matcher::PartialJson(json!({ "ItemId": "a1b2", "PositionTicks": 0 }))).with_status(204).create_async().await;
        let stop = s.mock("POST", "/Sessions/Playing/Stopped").match_body(Matcher::PartialJson(json!({ "ItemId": "a1b2", "PositionTicks": 1_500_000_000u64 }))).with_status(204).expect(2).create_async().await;
        let played = s.mock("POST", "/UserPlayedItems/a1b2").match_query(Matcher::UrlEncoded("userId".into(), "u1".into())).expect(1).create_async().await;
        let out = s.mock("POST", "/Sessions/Logout").match_header("authorization", signed()).with_status(204).create_async().await;
        let c = crate::servers::Conn::from_account(&account(&s.url()));
        c.like("a1b2", true).await.unwrap();
        c.like("a1b2", false).await.unwrap();
        c.played("a1b2", 0, false, None).await.unwrap();
        // 150 s heard: a counted play, then one that didn't count (stopped only).
        c.played("a1b2", 0, true, Some(150_000)).await.unwrap();
        c.played("a1b2", 0, false, Some(150_000)).await.unwrap();
        c.sign_out().await.unwrap();
        for m in [fav, unfav, start, stop, played, out] {
            m.assert_async().await;
        }
    }

    #[tokio::test]
    async fn the_stream_asks_a_range_raw_or_transcoded() {
        let mut s = Server::new_async().await;
        let raw = s.mock("GET", "/Audio/a1b2/stream").match_query(Matcher::UrlEncoded("static".into(), "true".into())).match_header("authorization", signed()).match_header("range", "bytes=100-").with_status(206).with_header("content-type", "audio/flac").with_header("content-range", "bytes 100-199/200").with_body(vec![1u8; 100]).create_async().await;
        let mp3 = s.mock("GET", "/Audio/a1b2/stream").match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("audioCodec".into(), "mp3".into()), Matcher::UrlEncoded("audioBitRate".into(), "320000".into())])).with_header("content-type", "audio/mpeg").with_body(vec![2u8; 50]).create_async().await;
        let j = Jellyfin::from_account(&account(&s.url()));
        let r = j.stream("a1b2", 100, false).await.unwrap();
        assert_eq!((r.status, r.content_range.as_deref()), (206, Some("bytes 100-199/200")));
        let mut r = j.stream("a1b2", 0, true).await.unwrap();
        let mut got = 0;
        while let Some(b) = r.body.chunk().await.unwrap() {
            got += b.len();
        }
        assert_eq!(got, 50);
        assert!(j.stream("../../x", 0, false).await.is_err());
        raw.assert_async().await;
        mp3.assert_async().await;
    }

    #[tokio::test]
    async fn lyrics_come_timed_when_their_lines_have_starts() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/Audio/a1b2/Lyrics").match_header("authorization", signed()).with_body(r#"{"Metadata":{},"Lyrics":[{"Text":"Giving you a call","Start":15000000},{"Text":"How I feel","Start":655000000}]}"#).create_async().await;
        s.mock("GET", "/Audio/c3d4/Lyrics").with_body(r#"{"Metadata":{},"Lyrics":[{"Text":"Line one"},{"Text":"Line two"}]}"#).create_async().await;
        let j = Jellyfin::from_account(&account(&s.url()));
        assert_eq!(j.lyrics("a1b2").await.unwrap().unwrap().synced.as_deref(), Some("[00:01.50]Giving you a call\n[01:05.50]How I feel"));
        assert_eq!(j.lyrics("c3d4").await.unwrap().unwrap().plain.as_deref(), Some("Line one\nLine two"));
        assert!(j.lyrics("../x").await.is_err(), "not one of its ids");
    }
}
