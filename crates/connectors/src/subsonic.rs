//! Subsonic-compatible servers (Navidrome, Airsonic, Gonic, Ampache…): the user's own music on the user's own server,
//! Subsonic API 1.16.1 (docs checked 2026-11-06, with OpenSubsonic's additions when the server has them).
//! Token auth: `t` = md5(password + salt), a fresh random salt per request; the password stays in Rust (keychain),
//! a URL with auth never goes to the interface or a log. Reads the library, playlists, search and stars; sends stars and
//! plays back. Audio: `stream.view` as the server keeps it (raw), or its transcoding to MP3 at a max bit rate.

pub use crate::servers::{Body, Streamed};
use crate::servers::{COVER_SIZE, LIST_TIMEOUT, base_of, http, note, reach};
use anyhow::{Context, Result, anyhow, bail, ensure};
use md5::{Digest, Md5};
use music_core::local::ReplayGain;
use music_core::lyrics::{self, Record};
use music_core::model::{PlaylistRef, Source, Track};
use music_core::server;
use serde_json::Value;
use std::collections::BTreeMap;
use std::time::Duration;
use url::Url;

pub const API_VERSION: &str = "1.16.1";
pub const CLIENT: &str = "Legato";
/// Albums / songs asked per page.
pub const PAGE: usize = 500;
/// Albums read at once during a sync (the user's own server: a few, not a flood).
const AT_ONCE: usize = 6;
/// Transcoded streams: MP3 at this bit rate (kbps), for formats the native engine can't read.
pub const MAX_BIT_RATE: u32 = 320;

/// What `ping` learnt.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Ping {
    pub version: String,
    /// OpenSubsonic's server name ("navidrome", "gonic"…).
    pub server: Option<String>,
}

#[derive(Clone)]
pub struct Subsonic {
    base: String,
    user: String,
    password: String,
    /// Code 41's way: the password hex-encoded, https only.
    plain: bool,
    key: String,
    http: reqwest::Client,
}

impl std::fmt::Debug for Subsonic {
    // Never the password.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Subsonic").field("base", &self.base).field("user", &self.user).finish_non_exhaustive()
    }
}

/// md5(password + salt), hex: Subsonic's token.
pub fn token(password: &str, salt: &str) -> String {
    Md5::digest(format!("{password}{salt}").as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// A fresh salt: 12 random hex characters.
fn salt() -> String {
    (0..6).map(|_| format!("{:02x}", rand::random::<u8>())).collect()
}

/// Subsonic error codes in words.
fn failed(code: i64, message: &str) -> anyhow::Error {
    match code {
        40 | 44 => anyhow!("Your music server refused the sign-in: check the user and the password"),
        41 => anyhow!("Your music server only takes the password sent as it is ({message}): use its https:// address, then confirm"),
        42 => anyhow!("Your music server doesn't take this kind of sign-in for this user ({message})"),
        30 => anyhow!("Your music server is too old for Legato: it needs the Subsonic API 1.13 or newer ({message})"),
        20 => anyhow!("Your music server speaks a newer API than Legato knows ({message})"),
        50 => anyhow!("Your music server doesn't let this user do that ({message})"),
        70 => anyhow!("Your music server doesn't have this item ({message})"),
        _ => anyhow!("Your music server said: {message} (code {code})"),
    }
}

/// `subsonic-response`, checked: its status ok, else its error in words.
pub fn answer(body: &str) -> Result<Value> {
    let v: Value = serde_json::from_str(body).map_err(|_| anyhow!("That address isn't a Subsonic server: check it (Navidrome's is like http://192.168.1.10:4533)"))?;
    let r = v.get("subsonic-response").cloned().ok_or_else(|| anyhow!("That address isn't a Subsonic server: check it (Navidrome's is like http://192.168.1.10:4533)"))?;
    if r.get("status").and_then(Value::as_str) == Some("ok") {
        return Ok(r);
    }
    let e = r.get("error");
    Err(failed(e.and_then(|e| e.get("code")).and_then(Value::as_i64).unwrap_or(0), e.and_then(|e| e.get("message")).and_then(Value::as_str).unwrap_or("failed")))
}

/// A list field: Subsonic gives an array, some servers one object alone, or nothing.
fn list(v: Option<&Value>) -> Vec<&Value> {
    match v {
        Some(Value::Array(a)) => a.iter().collect(),
        Some(o @ Value::Object(_)) => vec![o],
        _ => Vec::new(),
    }
}

/// OpenSubsonic's structured lyrics → a record: timed lines as LRC (`offset` > 0 shows them sooner), else plain.
fn structured(l: &Value) -> Option<Record> {
    let offset = l.get("offset").and_then(Value::as_i64).unwrap_or(0);
    let lines: Vec<(Option<i64>, String)> = list(l.get("line")).iter().map(|x| (x.get("start").and_then(Value::as_i64), text(x, "value").unwrap_or_default())).collect();
    if lines.iter().all(|(_, t)| t.trim().is_empty()) {
        return None;
    }
    if l.get("synced").and_then(Value::as_bool) == Some(true) {
        let timed = lines.into_iter().filter_map(|(at, t)| Some(((at? - offset).max(0) as u64, t)));
        return Some(Record { synced: Some(lyrics::to_lrc(timed)), ..Default::default() });
    }
    Some(Record { plain: Some(lines.into_iter().map(|(_, t)| t).collect::<Vec<_>>().join("\n")), ..Default::default() })
}

/// OpenSubsonic's `replayGain` object, values out of ReplayGain's range left out (as for a file's tags).
fn gain_of(rg: &Value) -> Option<ReplayGain> {
    let num = |k: &str, range: std::ops::RangeInclusive<f64>| rg.get(k).and_then(Value::as_f64).filter(|v| range.contains(v)).map(|v| v as f32);
    let peak = |k| num(k, 0.000_01..=10.0);
    Some(ReplayGain { track_db: num("trackGain", -60.0..=60.0)?, track_peak: peak("trackPeak"), album: num("albumGain", -60.0..=60.0).map(|db| (db, peak("albumPeak"))) })
}

fn text(v: &Value, k: &str) -> Option<String> {
    match v.get(k)? {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

impl Subsonic {
    /// `address` as `server::normalize` left it.
    pub fn new(address: &str, user: &str, password: &str) -> Self {
        // Key from the address as kept (`Account::key`); base as `Url` writes it, so the cover URLs built from it start
        // with it (`sign`, `art::allow_server`).
        let key = server::key(server::Kind::Subsonic, address.trim_end_matches('/'), user);
        Self { base: base_of(address), user: user.to_string(), password: password.to_string(), plain: false, key, http: http(address) }
    }

    pub fn from_account(a: &server::Account) -> Self {
        Self { plain: a.plain_password, ..Self::new(&a.address, &a.user, &a.password) }
    }

    /// This server account's key (library ids).
    pub fn key(&self) -> &str {
        &self.key
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    /// An address `server::normalize` let through that URLs can be built on ("http://nas:99999" isn't one).
    pub fn usable(address: &str) -> bool {
        crate::servers::usable(address)
    }

    /// A method's URL without auth (covers in the library: `sign` adds it when Rust fetches). None: the base isn't one.
    pub fn public_url(&self, method: &str, params: &[(&str, &str)]) -> Option<String> {
        let mut u = Url::parse(&format!("{}/rest/{method}.view", self.base)).ok()?;
        u.query_pairs_mut().extend_pairs(params);
        Some(u.to_string().trim_end_matches('?').to_string())
    }

    /// A URL of this server with auth added (fresh salt), or None when it isn't this server's API.
    pub fn sign(&self, url: &str) -> Option<String> {
        let mut u = Url::parse(url).ok()?;
        if !url.starts_with(&format!("{}/rest/", self.base)) || !self.may_send() {
            return None;
        }
        let kept: Vec<(String, String)> = u.query_pairs().filter(|(k, _)| !["u", "t", "s", "p", "v", "c", "f"].contains(&k.as_ref())).map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        u.query_pairs_mut().clear().extend_pairs(kept).extend_pairs(self.auth());
        Some(u.to_string())
    }

    /// The password as it is only goes over https.
    fn may_send(&self) -> bool {
        !self.plain || self.base.starts_with("https://")
    }

    fn auth(&self) -> Vec<(&'static str, String)> {
        let rest = [("v", API_VERSION.into()), ("c", CLIENT.into()), ("f", "json".into())];
        if self.plain {
            let hex: String = self.password.bytes().map(|b| format!("{b:02x}")).collect();
            return [("u", self.user.clone()), ("p", format!("enc:{hex}"))].into_iter().chain(rest).collect();
        }
        let s = salt();
        [("u", self.user.clone()), ("t", token(&self.password, &s)), ("s", s)].into_iter().chain(rest).collect()
    }

    fn url(&self, method: &str, params: &[(&str, &str)]) -> Result<Url> {
        ensure!(self.may_send(), "Your music server only takes the password sent as it is: use its https:// address, then confirm");
        note(&self.base);
        let mut u = Url::parse(&format!("{}/rest/{method}.view", self.base)).context("Your music server's address isn't right")?;
        u.query_pairs_mut().extend_pairs(params).extend_pairs(self.auth());
        Ok(u)
    }

    async fn call(&self, method: &str, params: &[(&str, &str)], timeout: Duration) -> Result<Value> {
        let res = self.http.get(self.url(method, params)?).timeout(timeout).send().await.map_err(reach)?;
        let status = res.status();
        let body = res.text().await.map_err(reach)?;
        // Some servers say a refusal in HTTP (401) with or without the JSON.
        match answer(&body) {
            Err(e) if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN => {
                if e.to_string().contains("isn't a Subsonic server") { Err(failed(40, "")) } else { Err(e) }
            }
            Err(e) if status.is_server_error() => Err(anyhow!("Your music server failed (HTTP {}): {e:#}", status.as_u16())),
            r => r,
        }
    }

    /// Sign-in check: the server answers, the user and password are right.
    pub async fn ping(&self) -> Result<Ping> {
        let r = self.call("ping", &[], crate::linklist::REQUEST_TIMEOUT).await?;
        Ok(Ping { version: text(&r, "version").unwrap_or_default(), server: text(&r, "type") })
    }

    /// A song entry (`child`) as a library track. Directories and videos: None.
    pub fn track(&self, v: &Value) -> Option<Track> {
        if v.get("isDir").and_then(Value::as_bool) == Some(true) || v.get("isVideo").and_then(Value::as_bool) == Some(true) {
            return None;
        }
        let id = text(v, "id")?;
        let title = text(v, "title")?;
        let isrc = match v.get("isrc") {
            Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).find(|s| s.len() == 12).map(str::to_uppercase),
            Some(Value::String(s)) if s.len() == 12 => Some(s.to_uppercase()),
            _ => None,
        };
        Some(Track {
            title,
            artist: text(v, "artist").or_else(|| text(v, "displayArtist")).unwrap_or_default(),
            album: text(v, "album"),
            duration_ms: v.get("duration").and_then(Value::as_u64).filter(|d| *d > 0).map(|d| (d * 1000).min(u64::from(u32::MAX)) as u32),
            isrc,
            ids: BTreeMap::from([(Source::Server, server::item_id(&self.key, &id))]),
            art: text(v, "coverArt").and_then(|c| self.public_url("getCoverArt", &[("id", &c), ("size", COVER_SIZE)])),
            musicness: None,
            explicit: false,
        })
    }

    fn tracks(&self, entries: Vec<&Value>) -> Vec<Track> {
        entries.into_iter().filter_map(|v| self.track(v)).collect()
    }

    /// Every album id, page by page (`getAlbumList2`, alphabetical).
    pub async fn album_ids(&self) -> Result<Vec<String>> {
        let mut ids = Vec::new();
        for page in 0.. {
            let offset = (page * PAGE).to_string();
            let r = self.call("getAlbumList2", &[("type", "alphabeticalByName"), ("size", &PAGE.to_string()), ("offset", &offset)], LIST_TIMEOUT).await?;
            let got = list(r.get("albumList2").and_then(|l| l.get("album")));
            let n = got.len();
            ids.extend(got.into_iter().filter_map(|a| text(a, "id")));
            // 100 000 albums at most: a server that ignores the offset can't loop forever.
            if n < PAGE || page >= 200 {
                break;
            }
        }
        Ok(ids)
    }

    /// One album's songs.
    pub async fn album(&self, id: &str) -> Result<Vec<Track>> {
        let r = self.call("getAlbum", &[("id", id)], LIST_TIMEOUT).await?;
        Ok(self.tracks(list(r.get("album").and_then(|a| a.get("song")))))
    }

    /// The whole library: every album's songs, a few albums at once. An album that fails is skipped (counted).
    pub async fn library(&self) -> Result<(Vec<Track>, usize)> {
        let ids = self.album_ids().await?;
        let (mut songs, mut failed) = (Vec::new(), 0);
        for chunk in ids.chunks(AT_ONCE) {
            let mut set = tokio::task::JoinSet::new();
            for (i, id) in chunk.iter().enumerate() {
                let (me, id) = (self.clone(), id.clone());
                set.spawn(async move { (i, me.album(&id).await) });
            }
            let mut done: Vec<(usize, Result<Vec<Track>>)> = set.join_all().await;
            done.sort_by_key(|(i, _)| *i);
            for (_, r) in done {
                match r {
                    Ok(t) => songs.extend(t),
                    Err(e) if e.to_string().starts_with("Your music server refused the sign-in") => return Err(e),
                    Err(_) => failed += 1,
                }
            }
        }
        Ok((songs, failed))
    }

    pub async fn playlists(&self) -> Result<Vec<PlaylistRef>> {
        let r = self.call("getPlaylists", &[], LIST_TIMEOUT).await?;
        Ok(list(r.get("playlists").and_then(|p| p.get("playlist"))).into_iter().filter_map(|p| Some(PlaylistRef { id: text(p, "id")?, name: text(p, "name").unwrap_or_else(|| "Playlist".into()) })).collect())
    }

    pub async fn playlist(&self, id: &str) -> Result<Vec<Track>> {
        let r = self.call("getPlaylist", &[("id", id)], LIST_TIMEOUT).await?;
        Ok(self.tracks(list(r.get("playlist").and_then(|p| p.get("entry")))))
    }

    /// Songs added at a playlist's end (`updatePlaylist`), a hundred per request (they travel in the URL).
    pub async fn playlist_add(&self, id: &str, items: &[String]) -> Result<()> {
        for chunk in items.chunks(100) {
            let mut params = vec![("playlistId", id)];
            params.extend(chunk.iter().map(|i| ("songIdToAdd", i.as_str())));
            self.call("updatePlaylist", &params, LIST_TIMEOUT).await?;
        }
        Ok(())
    }

    /// A playlist made on the server (`createPlaylist`) with these songs (the first hundred; `playlist_add` takes the
    /// rest): its id there. Servers that answer the new playlist give its id; older ones answer nothing, so the id is
    /// read from the lists, the newest of that name.
    pub async fn playlist_create(&self, name: &str, items: &[String]) -> Result<String> {
        let first = items.len().min(100);
        let mut params = vec![("name", name)];
        params.extend(items[..first].iter().map(|i| ("songId", i.as_str())));
        let r = self.call("createPlaylist", &params, LIST_TIMEOUT).await?;
        let id = match r.get("playlist").and_then(|p| text(p, "id")) {
            Some(id) => id,
            None => self.playlists().await?.into_iter().rev().find(|p| p.name == name).map(|p| p.id).context("The server didn't say which playlist it made")?,
        };
        self.playlist_add(&id, &items[first..]).await?;
        Ok(id)
    }

    /// A song out of a playlist, every occurrence. `updatePlaylist` removes by position: the playlist is read again
    /// first, so a mirror gone stale never takes another song out.
    pub async fn playlist_remove(&self, id: &str, item: &str) -> Result<()> {
        let r = self.call("getPlaylist", &[("id", id)], LIST_TIMEOUT).await?;
        let at: Vec<String> = list(r.get("playlist").and_then(|p| p.get("entry"))).iter().enumerate().filter(|(_, e)| text(e, "id").as_deref() == Some(item)).map(|(i, _)| i.to_string()).collect();
        if at.is_empty() {
            return Ok(());
        }
        let mut params = vec![("playlistId", id)];
        params.extend(at.iter().map(|i| ("songIndexToRemove", i.as_str())));
        self.call("updatePlaylist", &params, LIST_TIMEOUT).await.map(|_| ())
    }

    /// Songs matching `query` (`search3`).
    pub async fn search(&self, query: &str, count: usize) -> Result<Vec<Track>> {
        let n = count.clamp(1, 100).to_string();
        let r = self.call("search3", &[("query", query), ("songCount", &n), ("albumCount", "0"), ("artistCount", "0")], crate::linklist::REQUEST_TIMEOUT).await?;
        Ok(self.tracks(list(r.get("searchResult3").and_then(|s| s.get("song")))))
    }

    /// Starred songs (`getStarred2`): the server's likes.
    pub async fn starred(&self) -> Result<Vec<Track>> {
        let r = self.call("getStarred2", &[], LIST_TIMEOUT).await?;
        Ok(self.tracks(list(r.get("starred2").and_then(|s| s.get("song")))))
    }

    /// Like here = star there (`star` / `unstar`). `item` = the server's own id.
    pub async fn star(&self, item: &str, on: bool) -> Result<()> {
        self.call(if on { "star" } else { "unstar" }, &[("id", item)], crate::linklist::REQUEST_TIMEOUT).await.map(|_| ())
    }

    /// A song's lyrics (Against Liner 14): OpenSubsonic's `getLyricsBySongId` (timed ones first), else the classic
    /// `getLyrics` by artist and title (plain). None: the server has none.
    pub async fn lyrics(&self, item: &str, artist: &str, title: &str) -> Result<Option<Record>> {
        if let Ok(r) = self.call("getLyricsBySongId", &[("id", item)], crate::linklist::REQUEST_TIMEOUT).await {
            let all = list(r.get("lyricsList").and_then(|l| l.get("structuredLyrics")));
            let timed = all.iter().find(|l| l.get("synced").and_then(Value::as_bool) == Some(true));
            if let Some(found) = timed.or(all.first()).and_then(|l| structured(l)) {
                return Ok(Some(found));
            }
        }
        let r = self.call("getLyrics", &[("artist", artist), ("title", title)], crate::linklist::REQUEST_TIMEOUT).await?;
        Ok(r.get("lyrics").and_then(|l| text(l, "value")).filter(|t| !t.trim().is_empty()).map(|plain| Record { plain: Some(plain), ..Default::default() }))
    }

    /// A song's ReplayGain as the server read it from the file's tags (OpenSubsonic's `replayGain`, to -18 LUFS).
    /// None: the server doesn't give it, or the song has no track gain.
    pub async fn replay_gain(&self, item: &str) -> Result<Option<ReplayGain>> {
        let r = self.call("getSong", &[("id", item)], crate::linklist::REQUEST_TIMEOUT).await?;
        Ok(r.get("song").and_then(|s| s.get("replayGain")).and_then(gain_of))
    }

    /// A play: `submission` false = now playing (at the start), true = a listen (past half the song or 4 minutes,
    /// `lastfm::Scrobble::counts`). `at` = when it started, unix ms.
    pub async fn scrobble(&self, item: &str, at_ms: i64, submission: bool) -> Result<()> {
        let time = at_ms.to_string();
        self.call("scrobble", &[("id", item), ("time", &time), ("submission", if submission { "true" } else { "false" })], crate::linklist::REQUEST_TIMEOUT).await.map(|_| ())
    }

    /// A song's audio from byte `from`: raw, or MP3 at `MAX_BIT_RATE` (`transcode`). The answer's status and headers
    /// are the player's to judge (`music_player::http`).
    pub async fn stream(&self, item: &str, from: u64, transcode: bool) -> Result<Streamed> {
        let rate = MAX_BIT_RATE.to_string();
        let params: Vec<(&str, &str)> = if transcode { vec![("id", item), ("format", "mp3"), ("maxBitRate", &rate)] } else { vec![("id", item), ("format", "raw")] };
        let res = self.http.get(self.url("stream", &params)?).header(reqwest::header::RANGE, format!("bytes={from}-")).send().await.map_err(reach)?;
        // A refusal comes as a Subsonic answer in JSON or XML, not audio.
        let kind = res.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
        if res.status().is_success() && (kind.contains("json") || kind.contains("xml")) {
            let body = res.text().await.map_err(reach)?;
            answer(&body)?;
            bail!("Your music server sent no audio for this song");
        }
        Ok(Streamed::of(res))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};

    fn ok(extra: &str) -> String {
        format!(r#"{{"subsonic-response":{{"status":"ok","version":"1.16.1","type":"navidrome","serverVersion":"0.53.3","openSubsonic":true{extra}}}}}"#)
    }

    fn signed(user: &str) -> Matcher {
        Matcher::AllOf(vec![Matcher::UrlEncoded("u".into(), user.into()), Matcher::Regex("t=[0-9a-f]{32}".into()), Matcher::Regex("s=[0-9a-f]{12}".into()), Matcher::UrlEncoded("v".into(), API_VERSION.into()), Matcher::UrlEncoded("c".into(), CLIENT.into()), Matcher::UrlEncoded("f".into(), "json".into())])
    }

    const SONG: &str = r#"{"id":"tr-1","parent":"al-1","isDir":false,"title":"Nightcall","album":"OutRun","artist":"Kavinsky","track":1,"year":2013,"coverArt":"al-1","size":5000000,"contentType":"audio/flac","suffix":"flac","duration":258,"bitRate":900,"isrc":["frz031300055"],"albumId":"al-1","type":"music"}"#;

    #[test]
    fn the_token_is_md5_of_password_and_salt() {
        // Subsonic's own example: password "sesame", salt "c19b2d".
        assert_eq!(token("sesame", "c19b2d"), "26719a1196d2a940705a59634eb18eab");
        assert_ne!(salt(), salt());
    }

    #[test]
    fn an_address_urls_cant_be_built_on_is_refused_not_a_panic() {
        // Past `normalize` (a host is there), not a URL: Sync Mode's accounts are checked so, songs never panic on it.
        assert!(server::normalize("http://nas:99999").is_ok() && !Subsonic::usable("http://nas:99999"));
        assert!(Subsonic::usable("http://nas:4533") && Subsonic::usable("https://music.example.com/navidrome") && Subsonic::usable("HTTP://[fd00::5]:4533"));
        let sub = Subsonic::new("http://nas:99999", "me", "pw");
        let t = sub.track(&serde_json::json!({ "id": "1", "title": "T", "coverArt": "al-1" })).unwrap();
        assert_eq!(t.art, None);
    }

    #[test]
    fn covers_of_an_address_typed_in_capitals_are_still_this_servers() {
        let a = server::Account { kind: server::Kind::Subsonic, address: "HTTP://NAS:80/Music".into(), user: "me".into(), password: "pw".into(), ..Default::default() };
        let sub = Subsonic::from_account(&a);
        // Same key as the account's (library ids), base as URLs write it.
        assert_eq!((sub.key(), sub.base()), (a.key().as_str(), "http://nas/Music"));
        let t = sub.track(&serde_json::json!({ "id": "1", "title": "T", "coverArt": "al-1" })).unwrap();
        let art = t.art.unwrap();
        assert!(art.starts_with(sub.base()), "{art}");
        assert!(sub.sign(&art).is_some_and(|s| s.contains("&t=")));
    }

    #[test]
    fn code_41_asks_for_the_password_as_it_is_sent_hex_encoded_over_https_only() {
        let body = r#"{"subsonic-response":{"status":"failed","error":{"code":41,"message":"Token authentication not supported for LDAP users"}}}"#;
        assert!(answer(body).unwrap_err().to_string().starts_with("Your music server only takes the password sent as it is"));
        let a = |address: &str| server::Account { kind: server::Kind::Subsonic, address: address.into(), user: "me".into(), password: "pä".into(), plain_password: true, ..Default::default() };
        let https = Subsonic::from_account(&a("https://nas"));
        let auth = https.auth();
        assert!(auth.contains(&("p", "enc:70c3a4".into())) && !auth.iter().any(|(k, _)| ["t", "s"].contains(k)), "{auth:?}");
        assert!(https.url("ping", &[]).is_ok() && https.sign("https://nas/rest/stream.view?id=1").is_some_and(|u| u.contains("p=enc%3A70c3a4") || u.contains("p=enc:70c3a4")));
        // Plain http: nothing is built, nothing is sent; the account isn't complete either.
        let http = Subsonic::from_account(&a("http://nas:4533"));
        assert!(http.url("ping", &[]).is_err() && http.sign("http://nas:4533/rest/stream.view?id=1").is_none());
        assert!(a("https://nas").complete() && !a("http://nas:4533").complete());
    }

    #[tokio::test]
    async fn ping_signs_with_a_fresh_salt_and_reads_the_server() {
        let mut s = Server::new_async().await;
        let m = s.mock("GET", "/rest/ping.view").match_query(signed("me")).with_body(ok("")).expect(2).create_async().await;
        let sub = Subsonic::new(&s.url(), "me", "pw");
        let p = sub.ping().await.unwrap();
        assert_eq!(p, Ping { version: "1.16.1".into(), server: Some("navidrome".into()) });
        sub.ping().await.unwrap();
        m.assert_async().await;
        // The password itself never travels.
        assert!(!format!("{sub:?}").contains("pw"));
    }

    #[tokio::test]
    async fn a_songs_replay_gain_comes_from_the_server_when_it_has_one() {
        let mut s = Server::new_async().await;
        let song = |id: &str, extra: &str| (Matcher::UrlEncoded("id".into(), id.into()), ok(&format!(r#","song":{{"id":"{id}","title":"T"{extra}}}"#)));
        for (id, extra) in [
            ("full", r#","replayGain":{"trackGain":-6.5,"trackPeak":0.98,"albumGain":-5,"albumPeak":1,"baseGain":0}"#),
            ("track", r#","replayGain":{"trackGain":2.1}"#),
            ("peaks", r#","replayGain":{"trackPeak":1,"albumPeak":1}"#),
            ("odd", r#","replayGain":{"trackGain":900,"albumGain":-3}"#),
            ("none", ""),
        ] {
            let (q, body) = song(id, extra);
            s.mock("GET", "/rest/getSong.view").match_query(q).with_body(body).create_async().await;
        }
        let sub = Subsonic::new(&s.url(), "me", "pw");
        assert_eq!(sub.replay_gain("full").await.unwrap(), Some(ReplayGain { track_db: -6.5, track_peak: Some(0.98), album: Some((-5.0, Some(1.0))) }));
        assert_eq!(sub.replay_gain("track").await.unwrap(), Some(ReplayGain { track_db: 2.1, track_peak: None, album: None }));
        for id in ["peaks", "odd", "none"] {
            assert_eq!(sub.replay_gain(id).await.unwrap(), None, "{id}");
        }
    }

    #[tokio::test]
    async fn a_playlist_made_here_is_created_with_its_first_hundred_and_the_rest_added() {
        let mut s = Server::new_async().await;
        let q = |pairs: &[(&str, &str)]| Matcher::AllOf(pairs.iter().map(|(k, v)| Matcher::UrlEncoded((*k).into(), (*v).into())).chain([signed("me")]).collect());
        let ids: Vec<String> = (0..101).map(|i| format!("tr-{i}")).collect();
        // A server that answers the new playlist, then one that answers nothing and is asked for its lists.
        let made = s.mock("GET", "/rest/createPlaylist.view").match_query(Matcher::AllOf(vec![q(&[("name", "Road")]), Matcher::Regex("songId=tr-0&songId=tr-1&".into())])).with_body(ok(r#","playlist":{"id":"pl-9","name":"Road"}"#)).expect(1).create_async().await;
        let rest = s.mock("GET", "/rest/updatePlaylist.view").match_query(Matcher::AllOf(vec![q(&[("playlistId", "pl-9")]), Matcher::Regex("songIdToAdd=tr-100&".into())])).with_body(ok("")).expect(1).create_async().await;
        let sub = Subsonic::new(&s.url(), "me", "pw");
        assert_eq!(sub.playlist_create("Road", &ids).await.unwrap(), "pl-9");
        made.assert_async().await;
        rest.assert_async().await;
        let mut old = Server::new_async().await;
        old.mock("GET", "/rest/createPlaylist.view").match_query(Matcher::Any).with_body(ok("")).create_async().await;
        old.mock("GET", "/rest/getPlaylists.view").match_query(Matcher::Any).with_body(ok(r#","playlists":{"playlist":[{"id":"a","name":"Road"},{"id":"b","name":"Road"}]}"#)).create_async().await;
        assert_eq!(Subsonic::new(&old.url(), "me", "pw").playlist_create("Road", &["tr-1".into()]).await.unwrap(), "b");
    }

    #[tokio::test]
    async fn playlist_edits_add_by_id_and_remove_by_the_servers_own_positions() {
        let mut s = Server::new_async().await;
        let q = |pairs: &[(&str, &str)]| Matcher::AllOf(pairs.iter().map(|(k, v)| Matcher::UrlEncoded((*k).into(), (*v).into())).chain([signed("me")]).collect());
        let add = s.mock("GET", "/rest/updatePlaylist.view").match_query(Matcher::AllOf(vec![q(&[("playlistId", "pl-1")]), Matcher::Regex("songIdToAdd=tr-8&songIdToAdd=tr-9".into())])).with_body(ok("")).create_async().await;
        // The server's list: the song twice, a video between that the library never shows.
        s.mock("GET", "/rest/getPlaylist.view").match_query(q(&[("id", "pl-1")])).with_body(ok(r#","playlist":{"id":"pl-1","entry":[{"id":"tr-1","title":"A"},{"id":"v-1","title":"V","isVideo":true},{"id":"tr-2","title":"B"},{"id":"tr-1","title":"A"}]}"#)).create_async().await;
        let remove = s.mock("GET", "/rest/updatePlaylist.view").match_query(Matcher::AllOf(vec![q(&[("playlistId", "pl-1")]), Matcher::Regex("songIndexToRemove=0&songIndexToRemove=3".into())])).with_body(ok("")).create_async().await;
        let sub = Subsonic::new(&s.url(), "me", "pw");
        sub.playlist_add("pl-1", &["tr-8".into(), "tr-9".into()]).await.unwrap();
        sub.playlist_remove("pl-1", "tr-1").await.unwrap();
        // Gone from the server already: nothing asked.
        sub.playlist_remove("pl-1", "tr-7").await.unwrap();
        add.assert_async().await;
        remove.assert_async().await;
    }

    #[tokio::test]
    async fn server_errors_are_said_in_words() {
        let mut s = Server::new_async().await;
        let fail = |code: u32, msg: &str| format!(r#"{{"subsonic-response":{{"status":"failed","version":"1.16.1","error":{{"code":{code},"message":"{msg}"}}}}}}"#);
        s.mock("GET", "/rest/ping.view").match_query(Matcher::UrlEncoded("u".into(), "bad".into())).with_body(fail(40, "Wrong username or password")).create_async().await;
        s.mock("GET", "/rest/ping.view").match_query(Matcher::UrlEncoded("u".into(), "old".into())).with_body(fail(30, "Incompatible Subsonic REST protocol version. Server must upgrade.")).create_async().await;
        s.mock("GET", "/rest/ping.view").match_query(Matcher::UrlEncoded("u".into(), "web".into())).with_body("<html>Welcome</html>").create_async().await;
        s.mock("GET", "/rest/ping.view").match_query(Matcher::UrlEncoded("u".into(), "down".into())).with_status(502).with_body("Bad Gateway").create_async().await;
        let said = |u: &str| {
            let sub = Subsonic::new(&s.url(), u, "pw");
            async move { sub.ping().await.unwrap_err().to_string() }
        };
        assert!(said("bad").await.starts_with("Your music server refused the sign-in"));
        assert!(said("old").await.starts_with("Your music server is too old for Legato"));
        assert!(said("web").await.starts_with("That address isn't a Subsonic server"));
        assert!(said("down").await.starts_with("Your music server failed (HTTP 502)"));
        // Nobody there.
        let gone = Subsonic::new("http://127.0.0.1:9", "me", "pw").ping().await.unwrap_err().to_string();
        assert!(gone.starts_with("Your music server doesn't answer"), "{gone}");
        assert!(!gone.contains("t=") && !gone.contains("s=") && !gone.contains("u=me"), "no auth in words: {gone}");
    }

    #[tokio::test]
    async fn the_library_comes_album_by_album_page_by_page() {
        let mut s = Server::new_async().await;
        // A first full page, then a short one.
        let page: Vec<String> = (0..PAGE).map(|i| format!(r#"{{"id":"al-{i}","name":"A{i}"}}"#)).collect();
        s.mock("GET", "/rest/getAlbumList2.view").match_query(Matcher::AllOf(vec![signed("me"), Matcher::UrlEncoded("offset".into(), "0".into()), Matcher::UrlEncoded("type".into(), "alphabeticalByName".into())])).with_body(ok(&format!(r#","albumList2":{{"album":[{}]}}"#, page.join(",")))).create_async().await;
        s.mock("GET", "/rest/getAlbumList2.view").match_query(Matcher::UrlEncoded("offset".into(), PAGE.to_string())).with_body(ok(r#","albumList2":{"album":{"id":"al-last","name":"Z"}}"#)).create_async().await;
        let m = s.mock("GET", "/rest/getAlbum.view").match_query(signed("me")).with_body(ok(&format!(r#","album":{{"id":"al-1","name":"OutRun","song":[{SONG}]}}"#))).expect(PAGE + 1).create_async().await;
        let sub = Subsonic::new(&s.url(), "me", "pw");
        assert_eq!(sub.album_ids().await.unwrap().len(), PAGE + 1);
        let (songs, failed) = sub.library().await.unwrap();
        assert_eq!((songs.len(), failed), (PAGE + 1, 0));
        m.assert_async().await;
        let t = &songs[0];
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.album.as_deref(), t.duration_ms, t.isrc.as_deref()), ("Nightcall", "Kavinsky", Some("OutRun"), Some(258_000), Some("FRZ031300055")));
        assert_eq!(t.ids.get(&Source::Server), Some(&format!("{}:tr-1", sub.key())));
        // The cover's URL carries no auth: Rust signs it when it fetches.
        let art = t.art.clone().unwrap();
        assert_eq!(art, format!("{}/rest/getCoverArt.view?id=al-1&size=1200", s.url()));
        let signed_art = sub.sign(&art).unwrap();
        assert!(signed_art.contains("id=al-1&size=1200") && signed_art.contains("&t=") && signed_art.contains("&s="));
        assert_eq!(sub.sign("https://elsewhere.example/rest/getCoverArt.view?id=1"), None);
    }

    #[tokio::test]
    async fn playlists_search_and_stars() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/rest/getPlaylists.view").match_query(Matcher::Any).with_body(ok(r#","playlists":{"playlist":[{"id":"pl-1","name":"Road","songCount":1},{"id":"pl-2","name":"Empty","songCount":0}]}"#)).create_async().await;
        s.mock("GET", "/rest/getPlaylist.view").match_query(Matcher::UrlEncoded("id".into(), "pl-1".into())).with_body(ok(&format!(r#","playlist":{{"id":"pl-1","name":"Road","entry":[{SONG},{{"id":"d","isDir":true,"title":"x"}}]}}"#))).create_async().await;
        s.mock("GET", "/rest/getPlaylist.view").match_query(Matcher::UrlEncoded("id".into(), "pl-2".into())).with_body(ok(r#","playlist":{"id":"pl-2","name":"Empty"}"#)).create_async().await;
        s.mock("GET", "/rest/search3.view").match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("query".into(), "night call".into()), Matcher::UrlEncoded("songCount".into(), "20".into())])).with_body(ok(&format!(r#","searchResult3":{{"song":[{SONG}]}}"#))).create_async().await;
        s.mock("GET", "/rest/getStarred2.view").match_query(Matcher::Any).with_body(ok(&format!(r#","starred2":{{"song":{SONG}}}"#))).create_async().await;
        let star = s.mock("GET", "/rest/star.view").match_query(Matcher::UrlEncoded("id".into(), "tr-1".into())).with_body(ok("")).create_async().await;
        let unstar = s.mock("GET", "/rest/unstar.view").match_query(Matcher::UrlEncoded("id".into(), "tr-1".into())).with_body(ok("")).create_async().await;
        let sub = Subsonic::new(&s.url(), "me", "pw");
        assert_eq!(sub.playlists().await.unwrap().iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["Road", "Empty"]);
        assert_eq!(sub.playlist("pl-1").await.unwrap().len(), 1, "a folder entry isn't a song");
        assert!(sub.playlist("pl-2").await.unwrap().is_empty());
        assert_eq!(sub.search("night call", 20).await.unwrap()[0].title, "Nightcall");
        assert_eq!(sub.starred().await.unwrap().len(), 1, "one object alone is a list of one");
        sub.star("tr-1", true).await.unwrap();
        sub.star("tr-1", false).await.unwrap();
        star.assert_async().await;
        unstar.assert_async().await;
    }

    #[tokio::test]
    async fn plays_go_back_now_playing_then_a_submission() {
        let mut s = Server::new_async().await;
        let now = s.mock("GET", "/rest/scrobble.view").match_query(Matcher::AllOf(vec![signed("me"), Matcher::UrlEncoded("submission".into(), "false".into()), Matcher::UrlEncoded("time".into(), "1700000000000".into())])).with_body(ok("")).create_async().await;
        let done = s.mock("GET", "/rest/scrobble.view").match_query(Matcher::UrlEncoded("submission".into(), "true".into())).with_body(ok("")).create_async().await;
        let sub = Subsonic::new(&s.url(), "me", "pw");
        sub.scrobble("tr-1", 1_700_000_000_000, false).await.unwrap();
        sub.scrobble("tr-1", 1_700_000_000_000, true).await.unwrap();
        now.assert_async().await;
        done.assert_async().await;
    }

    #[tokio::test]
    async fn the_stream_asks_a_range_raw_or_transcoded() {
        let mut s = Server::new_async().await;
        let raw = s.mock("GET", "/rest/stream.view").match_query(Matcher::AllOf(vec![signed("me"), Matcher::UrlEncoded("format".into(), "raw".into())])).match_header("range", "bytes=100-").with_status(206).with_header("content-type", "audio/flac").with_header("content-range", "bytes 100-199/200").with_body(vec![1u8; 100]).create_async().await;
        let mp3 = s.mock("GET", "/rest/stream.view").match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("format".into(), "mp3".into()), Matcher::UrlEncoded("maxBitRate".into(), "320".into())])).with_header("content-type", "audio/mpeg").with_body(vec![2u8; 50]).create_async().await;
        let refused = s.mock("GET", "/rest/stream.view").match_query(Matcher::UrlEncoded("id".into(), "gone".into())).with_header("content-type", "application/json").with_body(r#"{"subsonic-response":{"status":"failed","error":{"code":70,"message":"Song not found"}}}"#).create_async().await;
        let sub = Subsonic::new(&s.url(), "me", "pw");
        let r = sub.stream("tr-1", 100, false).await.unwrap();
        assert_eq!((r.status, r.content_range.as_deref(), r.content_type.as_deref()), (206, Some("bytes 100-199/200"), Some("audio/flac")));
        let mut r = sub.stream("tr-1", 0, true).await.unwrap();
        let mut got = 0;
        while let Some(b) = r.body.chunk().await.unwrap() {
            got += b.len();
        }
        assert_eq!(got, 50);
        assert!(sub.stream("gone", 0, false).await.err().unwrap().to_string().starts_with("Your music server doesn't have this item"));
        raw.assert_async().await;
        mp3.assert_async().await;
        refused.assert_async().await;
    }

    #[tokio::test]
    async fn lyrics_come_timed_from_opensubsonic_else_plain_by_name() {
        let mut s = Server::new_async().await;
        let timed = r#","lyricsList":{"structuredLyrics":[{"lang":"eng","synced":false,"line":[{"value":"Plain one"}]},{"lang":"eng","synced":true,"offset":500,"line":[{"start":2000,"value":"Giving you a call"},{"start":65500,"value":"How I feel"}]}]}"#;
        s.mock("GET", "/rest/getLyricsBySongId.view").match_query(Matcher::UrlEncoded("id".into(), "tr-1".into())).with_body(ok(timed)).create_async().await;
        let none = r#"{"subsonic-response":{"status":"failed","version":"1.16.1","error":{"code":70,"message":"Lyrics not found"}}}"#;
        s.mock("GET", "/rest/getLyricsBySongId.view").match_query(Matcher::UrlEncoded("id".into(), "tr-2".into())).with_body(none).create_async().await;
        s.mock("GET", "/rest/getLyrics.view").match_query(Matcher::UrlEncoded("title".into(), "Odd Look".into())).with_body(ok(r#","lyrics":{"artist":"Kavinsky","title":"Odd Look","value":"Line one\nLine two"}"#)).create_async().await;
        let sub = Subsonic::new(&s.url(), "me", "pw");
        let r = sub.lyrics("tr-1", "Kavinsky", "Nightcall").await.unwrap().unwrap();
        assert_eq!(r.synced.as_deref(), Some("[00:01.50]Giving you a call\n[01:05.00]How I feel"), "timed first, the offset applied");
        let r = sub.lyrics("tr-2", "Kavinsky", "Odd Look").await.unwrap().unwrap();
        assert_eq!(r.plain.as_deref(), Some("Line one\nLine two"));
    }
}
