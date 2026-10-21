//! YouTube Music through its own web API ("InnerTube", what music.youtube.com calls), with the user's web session
//! (Google sign-in in the app window, like Pear Desktop / ytmusicapi). No keys, no Data API quota.
//! Unofficial: response shapes change, so parsing walks the JSON for known renderers instead of fixed paths.

use anyhow::{Context, Result, bail};
use async_trait::async_trait;
use music_core::matching::best_match;
use music_core::model::{Connector, PlaylistRef, Source, Track};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha1::{Digest, Sha1};
use std::collections::BTreeMap;
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};

mod home;
pub use home::{HomeItem, ListRef, Shelf};

pub const API: &str = "https://music.youtube.com/youtubei/v1";
const ORIGIN: &str = "https://music.youtube.com";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
/// Search filter "Songs" (protobuf params the site sends).
const SONGS: &str = "EgWKAQIIAWoMEA4QChADEAQQCRAF";
/// Filter "Videos": same message, field II → IQ.
const VIDEOS: &str = "EgWKAQIQAWoMEA4QChADEAQQCRAF";
const MAX_PAGES: usize = 60;

static DURATION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?:(\d+):)?(\d{1,2}):(\d{2})$").unwrap());
static THUMB_SIZE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"=w\d+-h\d+").unwrap());
static AUTHUSER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"authuser=(\d+)").unwrap());

/// One identity in the session: a Google account (authuser) or one of its brand channels (page id).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub name: String,
    pub handle: Option<String>,
    /// Google account the identity belongs to.
    pub email: Option<String>,
    pub authuser: u32,
    pub page_id: Option<String>,
    /// Profile picture (still or animated).
    #[serde(default)]
    pub photo: Option<String>,
}

impl Account {
    /// Stable key for settings ("1" or "1:pageid").
    pub fn key(&self) -> String {
        match &self.page_id {
            Some(p) => format!("{}:{p}", self.authuser),
            None => self.authuser.to_string(),
        }
    }
}

pub struct YouTubeMusic {
    api: String,
    cookie: String,
    sapisid: String,
    authuser: u32,
    page_id: Option<String>,
    /// Set for extra accounts: their Liked Music gets its own id and name.
    account: Option<Account>,
    http: reqwest::Client,
}

pub(crate) fn cookie_value<'a>(cookie: &'a str, name: &str) -> Option<&'a str> {
    cookie.split("; ").find_map(|kv| kv.strip_prefix(name)?.strip_prefix('='))
}

fn client_version() -> String {
    site_version(1)
}

/// "<major>.YYYYMMDD.01.00" like the sites (YouTube Music 1, YouTube 2); today's date keeps it plausible.
pub(crate) fn site_version(major: u32) -> String {
    let days = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() / 86_400) as i64;
    // Civil date from days since epoch (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{major}.{y:04}{m:02}{d:02}.01.00")
}

/// `SAPISIDHASH <ts>_<sha1("<ts> <SAPISID> <origin>")>`: proof of the session, as the site computes it.
pub fn sapisid_hash(sapisid: &str, ts: u64) -> String {
    sapisid_hash_for(sapisid, ts, ORIGIN)
}

/// Same for another Google origin (www.youtube.com).
pub(crate) fn sapisid_hash_for(sapisid: &str, ts: u64, origin: &str) -> String {
    let digest = Sha1::digest(format!("{ts} {sapisid} {origin}").as_bytes());
    format!("SAPISIDHASH {ts}_{}", digest.iter().map(|b| format!("{b:02x}")).collect::<String>())
}

pub(crate) fn text(v: &Value) -> Option<String> {
    v.get("simpleText").and_then(Value::as_str).map(String::from).or_else(|| {
        let runs = v.get("runs")?.as_array()?;
        Some(runs.iter().filter_map(|r| r.get("text")?.as_str()).collect())
    })
}

/// Every object under `key`, depth-first, whatever the layout.
fn find<'a>(v: &'a Value, key: &str, out: &mut Vec<&'a Value>) {
    match v {
        Value::Object(m) => {
            for (k, child) in m {
                if k == key {
                    out.push(child);
                }
                find(child, key, out);
            }
        }
        Value::Array(a) => a.iter().for_each(|c| find(c, key, out)),
        _ => {}
    }
}

pub(crate) fn all<'a>(v: &'a Value, key: &str) -> Vec<&'a Value> {
    let mut out = Vec::new();
    find(v, key, &mut out);
    out
}

/// Result of adding videos to a playlist.
#[derive(Debug, Default, PartialEq)]
pub struct Added {
    pub added: Vec<String>,
    /// Already in the playlist: YouTube refuses duplicates.
    pub already: Vec<String>,
    /// Why some videos were refused, when others went in.
    pub refused: Option<String>,
}

enum Edit {
    Done,
    Duplicate,
    Refused(String),
}

/// Duplicate refusal: STATUS_FAILED + "add anyway?" dialog whose button re-sends with DEDUPE_OPTION_SKIP.
fn is_duplicate(v: &Value) -> bool {
    !all(v, "dedupeOption").is_empty() || all(v, "dialogMessages").iter().filter_map(|m| m.as_array()).flatten().filter_map(text).any(|t| t.to_lowercase().contains("already"))
}

/// Message YouTube shows with a refusal (dialog or toast).
fn refusal(v: &Value) -> Option<String> {
    let dialog = all(v, "dialogMessages").into_iter().filter_map(Value::as_array).flatten().filter_map(text);
    let toast = ["responseText", "successResponseText"].into_iter().flat_map(|k| all(v, k)).filter_map(text);
    dialog.chain(toast).map(|t| t.trim().to_string()).find(|t| !t.is_empty()).map(|t| format!("YouTube Music: {t}"))
}

fn page_type(run: &Value) -> &str {
    run.pointer("/navigationEndpoint/browseEndpoint/browseEndpointContextSupportedConfigs/browseEndpointContextMusicConfig/pageType").and_then(Value::as_str).unwrap_or("")
}

pub(crate) fn parse_duration(s: &str) -> Option<u32> {
    let c = DURATION.captures(s.trim())?;
    let n = |i| c.get(i).map_or(0, |m| m.as_str().parse::<u32>().unwrap_or(0));
    Some(((n(1) * 60 + n(2)) * 60 + n(3)) * 1000)
}

/// One list row (song in search, playlist, library) → track. None for rows without a playable video.
fn row_track(row: &Value) -> Option<Track> {
    row_track_with(row, None)
}

/// Same; `fallback` = artist when the row names none (album pages: in the header).
fn row_track_with(row: &Value, fallback: Option<&str>) -> Option<Track> {
    let video_id = row
        .pointer("/playlistItemData/videoId")
        .or_else(|| all(row, "watchEndpoint").into_iter().find_map(|w| w.get("videoId")))
        .and_then(Value::as_str)?
        .to_string();
    let cols: Vec<&Value> = row.get("flexColumns")?.as_array()?.iter().filter_map(|c| c.pointer("/musicResponsiveListItemFlexColumnRenderer/text")).collect();
    let title = text(cols.first()?)?;
    let runs: Vec<&Value> = cols.iter().skip(1).filter_map(|c| c.get("runs")?.as_array()).flatten().collect();
    let artists: Vec<String> = runs.iter().filter(|r| page_type(r) == "MUSIC_PAGE_TYPE_ARTIST" || page_type(r) == "MUSIC_PAGE_TYPE_USER_CHANNEL").filter_map(|r| r.get("text")?.as_str().map(String::from)).collect();
    let album = runs.iter().find(|r| page_type(r) == "MUSIC_PAGE_TYPE_ALBUM").and_then(|r| r.get("text")?.as_str().map(String::from));
    let fixed = row.get("fixedColumns").map(|f| all(f, "text").into_iter().filter_map(text).collect::<Vec<_>>()).unwrap_or_default();
    let duration_ms = runs.iter().filter_map(|r| r.get("text")?.as_str()).chain(fixed.iter().map(String::as_str)).find_map(parse_duration);
    // No linked artist (plain videos): first plain run that isn't a type label or separator.
    let artist = if artists.is_empty() {
        runs.iter().filter_map(|r| r.get("text")?.as_str()).find(|t| !matches!(*t, "Song" | "Video" | "Episode" | " • " | " & " | ", ") && parse_duration(t).is_none()).or(fallback.filter(|f| !f.is_empty()))?.to_string()
    } else {
        artists.join(", ")
    };
    let art = row.pointer("/thumbnail/musicThumbnailRenderer/thumbnail/thumbnails").and_then(Value::as_array).and_then(|t| t.last()?.get("url")?.as_str()).map(big_thumb);
    Some(Track { title, artist, album, duration_ms, isrc: None, ids: BTreeMap::from([(Source::Youtube, video_id)]), art })
}

/// googleusercontent thumbs are sized in the URL ("=w60-h60-l90-rj"): ask for 544 px.
fn big_thumb(url: &str) -> String {
    THUMB_SIZE.replace(url, "=w544-h544").into_owned()
}

fn rows(v: &Value) -> Vec<Track> {
    all(v, "musicResponsiveListItemRenderer").into_iter().filter_map(row_track).collect()
}

/// Playlist pages also carry a "Suggestions" shelf: keep the playlist shelf (rows + its continuation) only.
fn playlist_rows(page: &Value) -> (Vec<Track>, Option<String>) {
    let shelf = all(page, "musicPlaylistShelfRenderer").into_iter().next().unwrap_or(page);
    (rows(shelf), continuation(shelf))
}

fn continuation(v: &Value) -> Option<String> {
    all(v, "continuationCommand").into_iter().chain(all(v, "nextContinuationData")).find_map(|c| c.get("token").or_else(|| c.get("continuation"))?.as_str().map(String::from))
}

/// Identities from the account switcher response.
fn parse_accounts(v: &Value) -> Vec<Account> {
    let mut out = Vec::new();
    for section in all(v, "accountSectionListRenderer") {
        let email = all(section, "accountItemSectionHeaderRenderer").first().and_then(|h| text(h.get("title")?));
        for item in all(section, "accountItem") {
            let tokens = all(item, "supportedTokens").into_iter().filter_map(Value::as_array).flatten().collect::<Vec<_>>();
            let authuser = tokens.iter().filter_map(|t| t.pointer("/accountSigninToken/signinUrl")?.as_str()).find_map(|u| AUTHUSER.captures(u)?[1].parse().ok()).unwrap_or(0);
            let page_id = tokens.iter().find_map(|t| t.pointer("/pageIdToken/pageId")?.as_str().map(String::from));
            let Some(name) = item.get("accountName").and_then(text) else { continue };
            let photo = item.pointer("/accountPhoto/thumbnails").and_then(Value::as_array).and_then(|t| t.last()?.get("url")?.as_str()).map(String::from);
            out.push(Account { name, handle: item.get("channelHandle").and_then(text), email: email.clone(), authuser, page_id, photo });
        }
    }
    out
}

impl YouTubeMusic {
    /// `cookie` = Cookie header of music.youtube.com from the sign-in window.
    pub fn new(cookie: &str) -> Result<Self> {
        Self::with_api(API, cookie)
    }

    pub fn with_api(api: &str, cookie: &str) -> Result<Self> {
        let sapisid = cookie_value(cookie, "SAPISID").or_else(|| cookie_value(cookie, "__Secure-3PAPISID")).context("Not signed in to YouTube Music")?.to_string();
        Ok(Self { api: api.into(), cookie: cookie.into(), sapisid, authuser: 0, page_id: None, account: None, http: reqwest::Client::new() })
    }

    /// Same session, acting as `account`.
    pub fn as_account(mut self, account: &Account) -> Self {
        self.authuser = account.authuser;
        self.page_id = account.page_id.clone();
        self.account = (account.key() != "0").then(|| account.clone());
        self
    }

    async fn call(&self, endpoint: &str, mut body: Value) -> Result<Value> {
        let version = client_version();
        body["context"] = json!({ "client": { "clientName": "WEB_REMIX", "clientVersion": version, "hl": "en" }, "user": {} });
        let ts = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
        let mut req = self
            .http
            .post(format!("{}/{endpoint}?prettyPrint=false", self.api))
            .header("cookie", &self.cookie)
            .header("authorization", sapisid_hash(&self.sapisid, ts))
            .header("x-goog-authuser", self.authuser.to_string())
            .header("x-origin", ORIGIN)
            .header("origin", ORIGIN)
            .header("user-agent", UA)
            .header("x-youtube-client-name", "67")
            .header("x-youtube-client-version", &version)
            .json(&body);
        if let Some(p) = &self.page_id {
            req = req.header("x-goog-pageid", p);
        }
        let mut res = req.try_clone().context("request not retryable")?.send().await?;
        // Unofficial backend: brief 5xx blips happen. One retry.
        if res.status().is_server_error() {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            res = req.send().await?;
        }
        let status = res.status();
        if !status.is_success() {
            bail!("YouTube Music {endpoint} → {status} {}", res.text().await.unwrap_or_default().chars().take(300).collect::<String>());
        }
        Ok(res.json().await?)
    }

    /// Google accounts and channels signed in to this session.
    pub async fn accounts(&self) -> Result<Vec<Account>> {
        Ok(parse_accounts(&self.call("account/accounts_list", json!({})).await?))
    }

    /// Uploads (other channels' copies of a song included).
    pub async fn search_videos(&self, query: &str) -> Result<Vec<Track>> {
        Ok(rows(&self.call("search", json!({ "query": query, "params": VIDEOS })).await?))
    }

    pub async fn search_songs(&self, query: &str) -> Result<Vec<Track>> {
        Ok(rows(&self.call("search", json!({ "query": query, "params": SONGS })).await?))
    }

    /// Playlist page + continuations, playlist rows only.
    async fn browse_rows(&self, browse_id: &str) -> Result<Vec<Track>> {
        let page = self.call("browse", json!({ "browseId": browse_id })).await?;
        let (mut out, mut token) = playlist_rows(&page);
        for _ in 0..MAX_PAGES {
            let Some(t) = token else { break };
            let next = self.call("browse", json!({ "continuation": t })).await?;
            let more = rows(&next);
            if more.is_empty() {
                break;
            }
            out.extend(more);
            token = continuation(&next);
        }
        Ok(out)
    }

    /// Video ids of a playlist (export resume).
    pub async fn playlist_videos(&self, playlist_id: &str) -> Result<Vec<String>> {
        Ok(self.browse_rows(&format!("VL{playlist_id}")).await?.into_iter().filter_map(|t| t.ids.get(&Source::Youtube).cloned()).collect())
    }

    /// Private playlist with these videos. Returns its id.
    pub async fn create_playlist(&self, title: &str, video_ids: &[String]) -> Result<String> {
        let v = self.call("playlist/create", json!({ "title": title, "description": "Exported from Music App", "privacyStatus": "PRIVATE", "videoIds": video_ids })).await?;
        v.get("playlistId").and_then(Value::as_str).map(String::from).context("YouTube Music didn't return the playlist")
    }

    /// Append videos. No dedupeOption: "DEDUPE_OPTION_SKIP" would skip YouTube's duplicate check (= allow duplicates).
    /// One duplicate or bad video refuses the whole batch: batch retried one by one, so the rest still goes in.
    pub async fn add_videos(&self, playlist_id: &str, video_ids: &[String]) -> Result<Added> {
        let mut out = Added::default();
        let mut reason = None;
        for chunk in video_ids.chunks(100) {
            match self.edit_add(playlist_id, chunk).await? {
                Edit::Done => out.added.extend_from_slice(chunk),
                Edit::Duplicate if chunk.len() == 1 => out.already.extend_from_slice(chunk),
                Edit::Refused(r) if chunk.len() == 1 => reason = Some(r),
                _ => {
                    for v in chunk {
                        match self.edit_add(playlist_id, std::slice::from_ref(v)).await? {
                            Edit::Done => out.added.push(v.clone()),
                            Edit::Duplicate => out.already.push(v.clone()),
                            Edit::Refused(r) => reason = Some(r),
                        }
                    }
                }
            }
        }
        // Nothing taken: owner refused (not their playlist, closed, …).
        match reason {
            Some(r) if out.added.is_empty() && out.already.is_empty() => bail!(r),
            r => Ok(Added { refused: r, ..out }),
        }
    }

    async fn edit_add(&self, playlist_id: &str, video_ids: &[String]) -> Result<Edit> {
        let actions: Vec<Value> = video_ids.iter().map(|v| json!({ "action": "ACTION_ADD_VIDEO", "addedVideoId": v })).collect();
        let v = self.call("browse/edit_playlist", json!({ "playlistId": playlist_id, "actions": actions })).await?;
        // HTTP 200 can still carry a refusal.
        Ok(match v.get("status").and_then(Value::as_str) {
            None | Some("STATUS_SUCCEEDED") => Edit::Done,
            Some(_) if is_duplicate(&v) => Edit::Duplicate,
            Some(status) => Edit::Refused(refusal(&v).unwrap_or_else(|| format!("YouTube Music refused to add the tracks ({status})"))),
        })
    }

    /// Like videos: what "add to Liked Music" means on YouTube Music.
    pub async fn like(&self, video_ids: &[String]) -> Result<()> {
        for v in video_ids {
            self.call("like/like", json!({ "target": { "videoId": v } })).await?;
        }
        Ok(())
    }

    /// Account this client acts as ("0" = signed-in default), as in Liked Music ids (`LM~key`).
    pub fn account_key(&self) -> String {
        self.account.as_ref().map_or_else(|| "0".into(), Account::key)
    }
}

#[async_trait]
impl Connector for YouTubeMusic {
    fn source(&self) -> Source {
        Source::Youtube
    }

    /// Built from a live session only.
    fn is_connected(&self) -> bool {
        true
    }

    async fn connect(&self) -> Result<()> {
        bail!("Sign in from Settings › Accounts")
    }

    fn disconnect(&self) -> Result<()> {
        Ok(())
    }

    /// Library playlists + Liked music.
    async fn list_playlists(&self) -> Result<Vec<PlaylistRef>> {
        let page = self.call("browse", json!({ "browseId": "FEmusic_liked_playlists" })).await?;
        let mut out = Vec::new();
        for item in all(&page, "musicTwoRowItemRenderer") {
            let Some(id) = item.pointer("/navigationEndpoint/browseEndpoint/browseId").and_then(Value::as_str).and_then(|b| b.strip_prefix("VL")) else { continue };
            // SE = Episodes for Later (podcasts, not music).
            if id == "SE" {
                continue;
            }
            let mut name = item.get("title").and_then(text).unwrap_or_else(|| id.to_string());
            // Every account's Liked Music is "LM": keep them apart in the library.
            let id = match (&self.account, id) {
                (Some(a), "LM") => {
                    name = format!("{name} · {}", a.name);
                    format!("LM~{}", a.key())
                }
                _ => id.to_string(),
            };
            if !out.iter().any(|p: &PlaylistRef| p.id == id) {
                out.push(PlaylistRef { id, name });
            }
        }
        Ok(out)
    }

    async fn playlist_tracks(&self, playlist_id: &str) -> Result<Vec<Track>> {
        self.browse_rows(&format!("VL{}", playlist_id.split('~').next().unwrap_or(playlist_id))).await
    }

    async fn search(&self, query: &str) -> Result<Vec<Track>> {
        self.search_songs(query).await
    }

    async fn resolve(&self, track: &Track) -> Result<Option<Track>> {
        let found = self.search_songs(&format!("{} {}", track.artist, track.title)).await?;
        Ok(best_match(track, &found).cloned())
    }

    async fn write_playlist(&self, name: &str, tracks: &[Track]) -> Result<String> {
        self.create_playlist(name, &tracks.iter().filter_map(|t| t.ids.get(&Source::Youtube).cloned()).collect::<Vec<_>>()).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};

    const COOKIE: &str = "YSC=x; SAPISID=abc/def; __Secure-3PAPISID=abc/def";

    fn run(t: &str, artist: Option<(&str, &str)>) -> Value {
        match artist {
            Some((page, id)) => json!({ "text": t, "navigationEndpoint": { "browseEndpoint": { "browseId": id, "browseEndpointContextSupportedConfigs": { "browseEndpointContextMusicConfig": { "pageType": page } } } } }),
            None => json!({ "text": t }),
        }
    }

    fn row(video: &str, title: &str, second: Vec<Value>, fixed: Option<&str>) -> Value {
        let mut r = json!({ "musicResponsiveListItemRenderer": {
            "playlistItemData": { "videoId": video },
            "flexColumns": [
                { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": title }] } } },
                { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": second } } }
            ]
        } });
        if let Some(d) = fixed {
            r["musicResponsiveListItemRenderer"]["fixedColumns"] = json!([{ "musicResponsiveListItemFixedColumnRenderer": { "text": { "runs": [{ "text": d }] } } }]);
        }
        r
    }

    fn with_thumb(mut r: Value) -> Value {
        r["musicResponsiveListItemRenderer"]["thumbnail"] = json!({ "musicThumbnailRenderer": { "thumbnail": { "thumbnails": [{ "url": "https://lh3.googleusercontent.com/abc=w60-h60-l90-rj" }, { "url": "https://lh3.googleusercontent.com/abc=w120-h120-l90-rj" }] } } });
        r
    }

    #[test]
    fn hashes_session_like_the_site() {
        // sha1("1700000000 abc/def https://music.youtube.com")
        let h = sapisid_hash("abc/def", 1_700_000_000);
        assert!(h.starts_with("SAPISIDHASH 1700000000_") && h.len() == "SAPISIDHASH 1700000000_".len() + 40, "{h}");
        assert_eq!(cookie_value(COOKIE, "SAPISID"), Some("abc/def"));
        assert!(YouTubeMusic::new("YSC=x").is_err());
        assert!(client_version().starts_with("1.20") && client_version().len() == 16, "{}", client_version());
    }

    #[test]
    fn parses_rows_from_any_layout() {
        let page = json!({ "contents": { "deep": [
            with_thumb(row("v1", "Get Lucky", vec![run("Song", None), run(" • ", None), run("Daft Punk", Some(("MUSIC_PAGE_TYPE_ARTIST", "UC1"))), run(", ", None), run("Pharrell Williams", Some(("MUSIC_PAGE_TYPE_ARTIST", "UC2"))), run(" • ", None), run("Random Access Memories", Some(("MUSIC_PAGE_TYPE_ALBUM", "MPRE1"))), run(" • ", None), run("6:09", None)], None)),
            row("v2", "Some upload", vec![run("Video", None), run(" • ", None), run("A Channel", None)], Some("1:02:03")),
            { "musicResponsiveListItemRenderer": { "flexColumns": [] } }
        ] } });
        let t = rows(&page);
        assert_eq!(t.len(), 2);
        assert_eq!(t[0].art.as_deref(), Some("https://lh3.googleusercontent.com/abc=w544-h544-l90-rj"));
        assert_eq!(t[1].art, None);
        assert_eq!((t[0].title.as_str(), t[0].artist.as_str(), t[0].album.as_deref(), t[0].duration_ms), ("Get Lucky", "Daft Punk, Pharrell Williams", Some("Random Access Memories"), Some(369_000)));
        assert_eq!((t[1].artist.as_str(), t[1].duration_ms, t[1].ids[&Source::Youtube].as_str()), ("A Channel", Some(3_723_000), "v2"));
    }

    #[tokio::test]
    async fn add_reports_refusals() {
        let mut s = Server::new_async().await;
        let ok = s.mock("POST", "/browse/edit_playlist").match_query(Matcher::Any).match_body(Matcher::PartialJson(json!({ "actions": [{ "addedVideoId": "a" }] }))).with_body(r#"{"status":"STATUS_SUCCEEDED"}"#).create_async().await;
        s.mock("POST", "/browse/edit_playlist").match_query(Matcher::Any).match_body(Matcher::PartialJson(json!({ "actions": [{ "addedVideoId": "b" }] }))).with_body(r#"{"status":"STATUS_FAILED"}"#).create_async().await;
        let yt = YouTubeMusic::with_api(&s.url(), COOKIE).unwrap();
        assert_eq!(yt.add_videos("PL", &["a".into()]).await.unwrap().added, ["a"]);
        assert!(yt.add_videos("PL", &["b".into()]).await.unwrap_err().to_string().contains("STATUS_FAILED"));
        ok.assert_async().await;
    }

    #[tokio::test]
    async fn add_splits_out_duplicates() {
        let mut s = Server::new_async().await;
        let dup = r#"{"status":"STATUS_FAILED","actions":[{"confirmDialogEndpoint":{"content":{"confirmDialogRenderer":{"dialogMessages":[{"runs":[{"text":"This song is already in the playlist"}]}],"confirmButton":{"buttonRenderer":{"serviceEndpoint":{"playlistEditEndpoint":{"actions":[{"addedVideoId":"d","dedupeOption":"DEDUPE_OPTION_SKIP"}]}}}}}}}}]}"#;
        // Any batch holding "d" refused whole: batch, then n alone, then d alone.
        let m = s
            .mock("POST", "/browse/edit_playlist")
            .match_query(Matcher::Any)
            .with_body_from_request(move |req| {
                let body = req.utf8_lossy_body().unwrap_or_default();
                if body.contains(r#""addedVideoId":"d""#) { dup.into() } else { br#"{"status":"STATUS_SUCCEEDED"}"#.to_vec() }
            })
            .expect(3)
            .create_async()
            .await;
        let yt = YouTubeMusic::with_api(&s.url(), COOKIE).unwrap();
        let r = yt.add_videos("PL", &["n".into(), "d".into()]).await.unwrap();
        assert_eq!((r.added, r.already, r.refused), (vec!["n".to_string()], vec!["d".to_string()], None));
        m.assert_async().await;
    }

    #[test]
    fn refusal_reads_youtubes_message() {
        let v = json!({ "status": "STATUS_FAILED", "actions": [{ "addToToastAction": { "item": { "notificationActionRenderer": { "responseText": { "runs": [{ "text": "Playlist is full" }] } } } } }] });
        assert_eq!(refusal(&v).as_deref(), Some("YouTube Music: Playlist is full"));
        assert!(!is_duplicate(&v));
        assert_eq!(refusal(&json!({ "status": "STATUS_FAILED" })), None);
    }

    #[tokio::test]
    async fn like_sends_each_video() {
        let mut s = Server::new_async().await;
        let m = s.mock("POST", "/like/like").match_query(Matcher::Any).match_body(Matcher::PartialJson(json!({ "target": { "videoId": "a" } }))).with_body("{}").create_async().await;
        let yt = YouTubeMusic::with_api(&s.url(), COOKIE).unwrap();
        yt.like(&["a".into()]).await.unwrap();
        m.assert_async().await;
        assert_eq!(yt.account_key(), "0");
    }

    #[test]
    fn playlist_rows_skip_suggestions() {
        let page = json!({ "contents": [
            { "musicPlaylistShelfRenderer": { "contents": [row("v1", "Mine", vec![run("X", None)], None), { "continuationItemRenderer": { "continuationEndpoint": { "continuationCommand": { "token": "P2" } } } }] } },
            { "musicShelfRenderer": { "title": { "runs": [{ "text": "Suggestions" }] }, "contents": [row("v9", "Suggested", vec![run("Y", None)], None)], "continuations": [{ "reloadContinuationData": { "continuation": "S" } }] } }
        ] });
        let (t, token) = playlist_rows(&page);
        assert_eq!((t.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(), token.as_deref()), (vec!["Mine"], Some("P2")));
    }

    #[test]
    fn parses_account_switcher() {
        let item = |name: &str, authuser: u32, page: Option<&str>| {
            let mut tokens = vec![json!({ "accountSigninToken": { "signinUrl": format!("/signin?action_handle_signin=true&authuser={authuser}") } })];
            if let Some(p) = page {
                tokens.push(json!({ "pageIdToken": { "pageId": p } }));
            }
            json!({ "accountItem": { "accountName": { "simpleText": name }, "accountPhoto": { "thumbnails": [{ "url": format!("https://yt3.ggpht.com/{name}=s88") }] }, "channelHandle": { "simpleText": format!("@{name}") }, "serviceEndpoint": { "selectActiveIdentityEndpoint": { "supportedTokens": tokens } } } })
        };
        let v = json!({ "actions": [{ "sections": [
            { "accountSectionListRenderer": { "header": { "accountItemSectionHeaderRenderer": { "title": { "runs": [{ "text": "me@example.com" }] } } }, "contents": [{ "accountItemSectionRenderer": { "contents": [item("Me", 0, None), item("Brand", 0, Some("123"))] } }] } },
            { "accountSectionListRenderer": { "header": { "accountItemSectionHeaderRenderer": { "title": { "runs": [{ "text": "work@example.com" }] } } }, "contents": [{ "accountItemSectionRenderer": { "contents": [item("Work", 1, None)] } }] } }
        ] }] });
        let a = parse_accounts(&v);
        assert_eq!(a.iter().map(|a| (a.name.as_str(), a.authuser, a.key(), a.email.as_deref())).collect::<Vec<_>>(), [("Me", 0, "0".to_string(), Some("me@example.com")), ("Brand", 0, "0:123".to_string(), Some("me@example.com")), ("Work", 1, "1".to_string(), Some("work@example.com"))]);
        assert_eq!(a[2].photo.as_deref(), Some("https://yt3.ggpht.com/Work=s88"));
    }

    #[tokio::test]
    async fn sends_session_headers_and_follows_continuations() {
        let mut s = Server::new_async().await;
        let first = s
            .mock("POST", "/browse")
            .match_query(Matcher::Any)
            .match_header("x-goog-authuser", "1")
            .match_header("x-goog-pageid", "123")
            .match_header("authorization", Matcher::Regex("^SAPISIDHASH \\d+_[0-9a-f]{40}$".into()))
            .match_body(Matcher::PartialJson(json!({ "browseId": "VLPL1", "context": { "client": { "clientName": "WEB_REMIX" } } })))
            .with_body(json!({ "contents": [row("v1", "A", vec![run("X", None)], None)], "continuations": [{ "nextContinuationData": { "continuation": "T2" } }] }).to_string())
            .create_async()
            .await;
        s.mock("POST", "/browse").match_query(Matcher::Any).match_body(Matcher::PartialJson(json!({ "continuation": "T2" }))).with_body(json!({ "items": [row("v2", "B", vec![run("Y", None)], None)] }).to_string()).create_async().await;
        let acct = Account { name: "Brand".into(), handle: None, email: None, authuser: 1, page_id: Some("123".into()), photo: None };
        let yt = YouTubeMusic::with_api(&s.url(), COOKIE).unwrap().as_account(&acct);
        assert_eq!(yt.playlist_videos("PL1").await.unwrap(), ["v1", "v2"]);
        first.assert_async().await;
    }

    #[test]
    fn needs_a_signed_in_session() {
        let Err(e) = YouTubeMusic::with_api("http://127.0.0.1:9", "YSC=x; PREF=f6=8") else { panic!("session without SAPISID") };
        assert!(e.to_string().contains("Not signed in"), "{e}");
        assert!(YouTubeMusic::with_api("http://127.0.0.1:9", "__Secure-3PAPISID=abc").is_ok());
    }

    #[tokio::test]
    async fn retries_one_server_blip_then_gives_up() {
        let mut s = Server::new_async().await;
        // Mockito serves first unsatisfied match: 503 once, then the answer.
        let blip = s.mock("POST", "/search").match_query(Matcher::Any).with_status(503).expect(1).create_async().await;
        s.mock("POST", "/search").match_query(Matcher::Any).with_body(json!({ "contents": [row("v1", "A", vec![run("X", None)], None)] }).to_string()).create_async().await;
        assert_eq!(YouTubeMusic::with_api(&s.url(), COOKIE).unwrap().search_videos("a").await.unwrap().len(), 1);
        blip.assert_async().await;

        let mut s = Server::new_async().await;
        let down = s.mock("POST", "/search").match_query(Matcher::Any).with_status(500).with_body("backend down").expect(2).create_async().await;
        let e = YouTubeMusic::with_api(&s.url(), COOKIE).unwrap().search_videos("a").await.unwrap_err().to_string();
        assert!(e.contains("search") && e.contains("500") && e.contains("backend down"), "{e}");
        down.assert_async().await;
    }

    #[tokio::test]
    async fn expired_session_and_html_pages_are_errors() {
        let mut s = Server::new_async().await;
        s.mock("POST", "/browse").match_query(Matcher::Any).with_status(401).with_body(r#"{"error":{"status":"UNAUTHENTICATED"}}"#).create_async().await;
        // Consent / sign-in page served as 200.
        s.mock("POST", "/search").match_query(Matcher::Any).with_header("content-type", "text/html").with_body("<html>Before you continue to YouTube</html>").create_async().await;
        let yt = YouTubeMusic::with_api(&s.url(), COOKIE).unwrap();
        let e = yt.playlist_videos("PL1").await.unwrap_err().to_string();
        assert!(e.contains("401") && e.contains("UNAUTHENTICATED"), "{e}");
        assert!(yt.search_songs("a").await.is_err());
    }

    /// Unofficial API: a reshuffled answer gives nothing, never a panic.
    #[test]
    fn parsers_survive_unknown_shapes() {
        let odd = [
            json!(null),
            json!({}),
            json!([]),
            json!(42),
            json!({ "contents": { "musicResponsiveListItemRenderer": 5 } }),
            json!({ "musicResponsiveListItemRenderer": { "flexColumns": "nope", "playlistItemData": { "videoId": 7 } } }),
            json!({ "musicPlaylistShelfRenderer": [], "continuations": [{ "nextContinuationData": { "continuation": 9 } }] }),
            json!({ "accountSectionListRenderer": { "contents": [{ "accountItem": { "accountName": 3 } }] } }),
        ];
        for v in &odd {
            assert!(rows(v).is_empty(), "{v}");
            assert_eq!(playlist_rows(v), (vec![], None), "{v}");
            assert!(parse_accounts(v).is_empty(), "{v}");
        }
    }
}
