//! Public Deezer playlists and albums by link, no account and no key: Deezer's public API (api.deezer.com).
//! Metadata only (title, artist, ISRC, length, cover): never its audio, its 30 s preview links are not even read.
//! Limit: 50 requests / 5 s. A page is 100 songs; the quota error comes as HTTP 200 with an `error` object, so the
//! body is read, not only the status.

use crate::linklist::{LinkList, MAX_TRACKS, REQUEST_TIMEOUT};
use anyhow::{Context, Result};
use music_core::model::Track;
use music_core::musicness::Musicness;
use reqwest::StatusCode;
use serde_json::Value;
use std::collections::BTreeMap;
use std::time::Duration;
use url::Url;

pub const API: &str = "https://api.deezer.com";
pub const LINK: &str = "https://link.deezer.com";
const PAGE: usize = 100;
/// Calls per request before giving up on the quota.
const TRIES: u32 = 4;

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Kind {
    Playlist,
    Album,
}

impl Kind {
    fn path(self) -> &'static str {
        match self {
            Kind::Playlist => "playlist",
            Kind::Album => "album",
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Target {
    List(Kind, u64),
    /// link.deezer.com/s/<code>: one redirect to the real page.
    Short(String),
    /// A single song: not an import.
    Track,
}

/// Locale prefix of a Deezer path: /fr/, /en/, /pt-br/…
fn locale(s: &str) -> bool {
    let b = s.as_bytes();
    let low = |x: &[u8]| x.iter().all(u8::is_ascii_lowercase);
    (b.len() == 2 && low(b)) || (b.len() == 5 && b[2] == b'-' && low(&b[..2]) && low(&b[3..]))
}

fn parse(text: &str) -> Option<Url> {
    let text = text.trim();
    if text.is_empty() || text.len() > 2048 || text.contains(char::is_whitespace) {
        return None;
    }
    Url::parse(text).ok().filter(|u| u.has_host()).or_else(|| Url::parse(&format!("https://{text}")).ok())
}

fn deezer_host(host: &str) -> bool {
    matches!(host, "deezer.com" | "www.deezer.com" | "link.deezer.com")
}

/// Does the pasted text name a Deezer host, whatever its path? Picks the service (and the words of the error) for a link
/// `target` turns down, like one with an upper-case locale.
pub fn is_deezer(text: &str) -> bool {
    parse(text).and_then(|u| u.host_str().map(|h| deezer_host(&h.to_ascii_lowercase()))).unwrap_or(false)
}

/// What a pasted text is: real Deezer hosts only (deezer.com, www.deezer.com, link.deezer.com), never another one.
pub fn target(text: &str) -> Option<Target> {
    let url = parse(text)?;
    if !matches!(url.scheme(), "http" | "https") || url.port().is_some() || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let host = url.host_str()?.to_ascii_lowercase();
    let mut segs = url.path_segments()?.filter(|s| !s.is_empty());
    if host == "link.deezer.com" {
        let (s, code) = (segs.next()?, segs.next()?);
        return (s == "s" && segs.next().is_none() && code.len() <= 64 && code.bytes().all(|c| c.is_ascii_alphanumeric())).then(|| Target::Short(code.into()));
    }
    if host != "deezer.com" && host != "www.deezer.com" {
        return None;
    }
    let mut what = segs.next()?;
    if locale(what) {
        what = segs.next()?;
    }
    let id = segs.next()?.parse::<u64>().ok()?;
    match what {
        "playlist" => Some(Target::List(Kind::Playlist, id)),
        "album" => Some(Target::List(Kind::Album, id)),
        "track" => Some(Target::Track),
        _ => None,
    }
}

pub struct Deezer {
    api: String,
    link: String,
    backoff: Duration,
}

impl Default for Deezer {
    fn default() -> Self {
        Self::new()
    }
}

impl Deezer {
    pub fn new() -> Self {
        Self::with_urls(API, LINK)
    }

    /// Injectable base URLs (tests, and the e2e build's mock).
    pub fn with_urls(api: &str, link: &str) -> Self {
        Self { api: api.trim_end_matches('/').into(), link: link.trim_end_matches('/').into(), backoff: Duration::from_secs(5) }
    }

    /// Wait after a quota error (grows with each try).
    pub fn with_backoff(mut self, backoff: Duration) -> Self {
        self.backoff = backoff;
        self
    }

    /// One API answer. Quota / busy errors wait and try again; a gone or private list is said in plain words.
    async fn get(&self, kind: Kind, path: &str) -> Result<Value> {
        let gone = || anyhow::anyhow!(if kind == Kind::Playlist { "This playlist is private or doesn't exist" } else { "This album was removed, or isn't available in its store" });
        for attempt in 1..=TRIES {
            let res = crate::http().get(format!("{}{path}", self.api)).timeout(REQUEST_TIMEOUT).send().await?;
            let status = res.status();
            if status == StatusCode::NOT_FOUND {
                return Err(gone());
            }
            let body: Value = if status == StatusCode::TOO_MANY_REQUESTS { Value::Null } else { res.error_for_status()?.json().await? };
            let code = body.pointer("/error/code").and_then(Value::as_i64);
            match (status, code) {
                // 4 = quota, 700 = service busy.
                (StatusCode::TOO_MANY_REQUESTS, _) | (_, Some(4 | 700)) => {
                    if attempt < TRIES {
                        tokio::time::sleep(self.backoff * attempt).await;
                    }
                }
                // 800 = no data, 200 / 300 = needs a signed-in account (a private list).
                (_, Some(800 | 200 | 300)) => return Err(gone()),
                (_, Some(_)) => anyhow::bail!("Deezer refused: {}", body.pointer("/error/message").and_then(Value::as_str).unwrap_or("unknown error")),
                _ => return Ok(body),
            }
        }
        anyhow::bail!("Deezer is busy right now: try again in a minute")
    }

    /// Short link → the list it leads to. One redirect, read here and followed only to a Deezer page.
    async fn resolve(&self, code: &str) -> Result<(Kind, u64)> {
        let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(REQUEST_TIMEOUT).build()?;
        let res = client.get(format!("{}/s/{code}", self.link)).send().await?;
        let to = res.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()).filter(|_| res.status().is_redirection());
        let to = to.and_then(|l| Url::parse(&self.link).ok()?.join(l).ok());
        match to.as_ref().and_then(|u| target(u.as_str())) {
            Some(Target::List(kind, id)) => Ok((kind, id)),
            Some(Target::Track) => anyhow::bail!("That link is a single song: paste a playlist or album link"),
            _ => anyhow::bail!("This Deezer link doesn't lead to a playlist or an album"),
        }
    }

    /// The list behind a pasted link: name, cover and every song (paged).
    pub async fn fetch(&self, text: &str) -> Result<LinkList> {
        let (kind, id) = match target(text) {
            Some(Target::List(kind, id)) => (kind, id),
            Some(Target::Short(code)) => self.resolve(&code).await?,
            Some(Target::Track) => anyhow::bail!("That link is a single song: paste a playlist or album link"),
            None => anyhow::bail!("Not a Deezer playlist or album link"),
        };
        let what = kind.path();
        let meta = self.get(kind, &format!("/{what}/{id}")).await?;
        anyhow::ensure!(meta.get("public") != Some(&Value::Bool(false)), "This playlist is private or doesn't exist");
        let name = meta["title"].as_str().filter(|n| !n.is_empty()).context("Deezer sent no name for this list")?.to_string();
        let cover = meta.get(if kind == Kind::Album { "cover_big" } else { "picture_big" }).and_then(Value::as_str).map(String::from);
        // Album tracks carry neither album nor cover: the album's own. A playlist's songs have theirs.
        let album = (kind == Kind::Album).then_some(name.as_str());
        let album_cover = if kind == Kind::Album { cover.as_deref() } else { None };
        let mut tracks = Vec::new();
        let mut index = 0;
        loop {
            let page = self.get(kind, &format!("/{what}/{id}/tracks?index={index}&limit={PAGE}")).await?;
            let data = page["data"].as_array().map_or(&[][..], Vec::as_slice);
            tracks.extend(data.iter().filter_map(|t| track(t, album, album_cover)));
            index += data.len();
            let more = page.get("next").is_some_and(|n| !n.is_null()) || page["total"].as_u64().is_some_and(|t| (index as u64) < t);
            if data.is_empty() || !more || tracks.len() >= MAX_TRACKS {
                break;
            }
        }
        tracks.truncate(MAX_TRACKS);
        let total = meta["nb_tracks"].as_u64().map_or(tracks.len(), |n| n as usize);
        Ok(LinkList { kind: if kind == Kind::Album { "album" } else { "playlist" }, name, cover, tracks, total })
    }
}

/// A track object → song (title, artist, album, length, ISRC; no Deezer id, no preview). `album` / `cover`: the album
/// page's own, for album lists whose tracks carry none.
fn track(t: &Value, album: Option<&str>, cover: Option<&str>) -> Option<Track> {
    let text = |p: &str| t.pointer(p).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
    Some(Track {
        title: text("/title")?.to_string(),
        artist: text("/artist/name")?.to_string(),
        album: album.or_else(|| text("/album/title")).map(String::from),
        duration_ms: t.get("duration").and_then(Value::as_u64).filter(|d| *d > 0).map(|d| (d * 1000) as u32),
        isrc: text("/isrc").map(str::to_ascii_uppercase),
        ids: BTreeMap::new(),
        art: cover.or_else(|| text("/album/cover_big")).map(String::from),
        musicness: Some(Musicness::Music),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    // Fixtures recorded by hand from api.deezer.com on 2026-10-31 (public data, no key), cut down to the fields read.
    const PLAYLIST: &str = include_str!("../../../e2e/fixtures/deezer-playlist.json");
    const PLAYLIST_TRACKS: &str = include_str!("../../../e2e/fixtures/deezer-playlist-tracks.json");
    const ALBUM: &str = include_str!("../../../e2e/fixtures/deezer-album.json");
    const ALBUM_TRACKS: &str = include_str!("../../../e2e/fixtures/deezer-album-tracks.json");
    /// Deezer's answers to a private or missing list, and to the quota, both with HTTP 200.
    const NO_DATA: &str = r#"{"error":{"type":"DataException","message":"no data","code":800}}"#;
    const QUOTA: &str = r#"{"error":{"type":"Exception","message":"Quota limit exceeded","code":4}}"#;

    fn client(s: &Server) -> Deezer {
        Deezer::with_urls(&s.url(), &s.url()).with_backoff(Duration::from_millis(1))
    }

    async fn said(d: &Deezer, link: &str) -> String {
        d.fetch(link).await.unwrap_err().to_string()
    }

    #[test]
    fn reads_deezer_links_only() {
        let list = |k, id| Some(Target::List(k, id));
        for (link, want) in [
            ("https://www.deezer.com/playlist/2477790684", list(Kind::Playlist, 2477790684)),
            ("https://www.deezer.com/fr/playlist/2477790684?utm_source=deezer&utm_medium=web", list(Kind::Playlist, 2477790684)),
            ("https://deezer.com/en/album/1120288832", list(Kind::Album, 1120288832)),
            ("https://www.deezer.com/pt-br/album/1120288832/", list(Kind::Album, 1120288832)),
            ("  www.deezer.com/playlist/12  ", list(Kind::Playlist, 12)),
            ("https://www.deezer.com/fr/track/4344812982", Some(Target::Track)),
            ("https://link.deezer.com/s/32Xtqzp0nOOGSbVgBeVpe", Some(Target::Short("32Xtqzp0nOOGSbVgBeVpe".into()))),
        ] {
            assert_eq!(target(link), want, "{link}");
        }
        for bad in [
            "",
            "daft punk",
            "https://www.deezer.com/fr/artist/27",
            "https://www.deezer.com/playlist/abc",
            "https://evil.example/playlist/12",
            "https://deezer.com.evil.example/playlist/12",
            "https://evil.example/www.deezer.com/playlist/12",
            "https://www.deezer.com@evil.example/playlist/12",
            "https://www.deezer.com:8080/playlist/12",
            "https://api.deezer.com/playlist/12",
            "https://link.deezer.com/query/abc",
            "https://link.deezer.com/s/a/b",
            "https://www.deezer.com/playlist/12 and more",
            "ftp://www.deezer.com/playlist/12",
            "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
        ] {
            assert_eq!(target(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_deezer_host_picks_the_service_even_when_the_path_is_turned_down() {
        for yes in ["https://www.deezer.com/FR/playlist/12", "https://www.deezer.com/playlist/12abc", "WWW.DEEZER.COM/album/x", "https://link.deezer.com/s/a/b"] {
            assert!(is_deezer(yes), "{yes}");
        }
        for no in ["", "daft punk", "https://music.apple.com/us/playlist/x/pl.1", "https://deezer.com.evil.example/playlist/12", "https://www.deezer.com@evil.example/playlist/12", "https://api.deezer.com/playlist/12"] {
            assert!(!is_deezer(no), "{no}");
        }
    }

    #[tokio::test]
    async fn imports_a_playlist_from_recorded_answers() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/playlist/2477790684").with_body(PLAYLIST).create_async().await;
        s.mock("GET", "/playlist/2477790684/tracks").match_query(Matcher::UrlEncoded("index".into(), "0".into())).with_body(PLAYLIST_TRACKS).create_async().await;
        s.mock("GET", "/playlist/2477790684/tracks").match_query(Matcher::UrlEncoded("index".into(), "2".into())).with_body(r#"{"data":[],"total":153}"#).create_async().await;
        let list = client(&s).fetch("https://www.deezer.com/fr/playlist/2477790684").await.unwrap();
        assert_eq!((list.kind, list.name.as_str(), list.tracks.len(), list.total), ("playlist", "Soirée Hits 2026 : La Playlist Certifiée", 2, 153));
        let t = &list.tracks[0];
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.album.as_deref(), t.duration_ms, t.isrc.as_deref()), ("I Follow Rivers (The Magician Remix)", "Lykke Li", Some("I Follow Rivers (The Magician Remix)"), Some(279_000), Some("SEVUM1100103")));
        assert!(t.ids.is_empty() && t.art.as_deref().unwrap().starts_with("https://cdn-images.dzcdn.net/images/cover/"));
        assert_eq!(list.cover.as_deref(), Some("https://cdn-images.dzcdn.net/images/playlist/d1aed54c8a7f4228056e8367babe75cd/500x500-000000-80-0-0.jpg"));
    }

    #[tokio::test]
    async fn imports_an_album_with_its_own_name_and_cover() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/album/1120288832").with_body(ALBUM).create_async().await;
        s.mock("GET", "/album/1120288832/tracks").match_query(Matcher::UrlEncoded("index".into(), "0".into())).with_body(ALBUM_TRACKS).create_async().await;
        // 2 of 20 songs recorded; the next page is empty: the loop stops.
        s.mock("GET", "/album/1120288832/tracks").match_query(Matcher::UrlEncoded("index".into(), "2".into())).with_body(r#"{"data":[],"total":20}"#).create_async().await;
        let list = client(&s).fetch("https://www.deezer.com/album/1120288832").await.unwrap();
        assert_eq!((list.kind, list.name.as_str(), list.tracks.len(), list.total), ("album", "EXTASIAAAAA", 2, 20));
        let t = &list.tracks[1];
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.album.as_deref(), t.isrc.as_deref()), ("PANAFRI", "Ino Casablanca", Some("EXTASIAAAAA"), Some("FR9W12644384")));
        assert_eq!(t.art, list.cover);
    }

    #[tokio::test]
    async fn pages_through_a_long_playlist() {
        let mut s = Server::new_async().await;
        let songs = |from: usize, n: usize| (from..from + n).map(|i| json!({ "title": format!("Song {i}"), "duration": 200, "artist": { "name": "Artist" }, "isrc": format!("AA{i:010}") })).collect::<Vec<_>>();
        s.mock("GET", "/playlist/5").with_body(json!({ "title": "Long", "public": true, "nb_tracks": 250 }).to_string()).create_async().await;
        for (index, n) in [(0, 100), (100, 100), (200, 50)] {
            let next = (index < 200).then(|| format!("https://api.deezer.com/playlist/5/tracks?index={}", index + n));
            let body = json!({ "data": songs(index, n), "total": 250, "next": next });
            s.mock("GET", "/playlist/5/tracks").match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("index".into(), index.to_string()), Matcher::UrlEncoded("limit".into(), "100".into())])).with_body(body.to_string()).expect(1).create_async().await;
        }
        let list = client(&s).fetch("https://www.deezer.com/playlist/5").await.unwrap();
        assert_eq!((list.tracks.len(), list.total), (250, 250));
        assert_eq!((list.tracks[0].title.as_str(), list.tracks[249].title.as_str()), ("Song 0", "Song 249"));
    }

    #[tokio::test]
    async fn waits_and_tries_again_on_the_quota_error() {
        let mut s = Server::new_async().await;
        let calls = std::sync::Arc::new(AtomicUsize::new(0));
        let seen = calls.clone();
        // The first two calls hit the quota (HTTP 200 + error object), the third answers.
        s.mock("GET", "/playlist/5").with_body_from_request(move |_| if seen.fetch_add(1, Ordering::SeqCst) < 2 { QUOTA.into() } else { json!({ "title": "Quiet", "public": true, "nb_tracks": 0 }).to_string().into() }).create_async().await;
        s.mock("GET", "/playlist/5/tracks").match_query(Matcher::Any).with_body(r#"{"data":[],"total":0}"#).create_async().await;
        let list = client(&s).fetch("https://www.deezer.com/playlist/5").await.unwrap();
        assert_eq!((list.name.as_str(), calls.load(Ordering::SeqCst)), ("Quiet", 3));
    }

    #[tokio::test]
    async fn gives_up_on_a_quota_that_stays() {
        let mut s = Server::new_async().await;
        let m = s.mock("GET", "/playlist/5").with_body(QUOTA).expect(TRIES as usize).create_async().await;
        let e = client(&s).fetch("https://www.deezer.com/playlist/5").await.unwrap_err().to_string();
        assert_eq!(e, "Deezer is busy right now: try again in a minute");
        m.assert_async().await;
    }

    #[tokio::test]
    async fn says_why_a_list_cannot_be_read() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/playlist/1").with_body(NO_DATA).create_async().await;
        s.mock("GET", "/playlist/2").with_body(r#"{"error":{"type":"OAuthException","message":"An active access token must be used","code":200}}"#).create_async().await;
        s.mock("GET", "/playlist/3").with_body(r#"{"title":"Mine","public":false,"nb_tracks":4}"#).create_async().await;
        s.mock("GET", "/playlist/4").with_status(404).create_async().await;
        s.mock("GET", "/album/9").with_body(NO_DATA).create_async().await;
        s.mock("GET", "/playlist/6").with_body(r#"{"error":{"type":"ParameterException","message":"Wrong parameter","code":500}}"#).create_async().await;
        let d = client(&s);
        for n in 1..=4 {
            assert_eq!(said(&d, &format!("https://www.deezer.com/playlist/{n}")).await, "This playlist is private or doesn't exist", "{n}");
        }
        assert_eq!(said(&d, "https://www.deezer.com/album/9").await, "This album was removed, or isn't available in its store");
        assert_eq!(said(&d, "https://www.deezer.com/playlist/6").await, "Deezer refused: Wrong parameter");
        assert_eq!(said(&d, "https://www.deezer.com/track/4344812982").await, "That link is a single song: paste a playlist or album link");
        assert_eq!(said(&d, "https://www.deezer.com/artist/27").await, "Not a Deezer playlist or album link");
    }

    #[tokio::test]
    async fn follows_a_short_link_once_and_only_to_deezer() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/s/goodcode").with_status(302).with_header("location", "https://www.deezer.com/fr/playlist/5?utm_source=deezer").create_async().await;
        s.mock("GET", "/s/missing").with_status(302).with_header("location", "https://www.deezer.com/deezer-links-404").create_async().await;
        // Not Deezer, and not a redirect at all: neither is followed or taken.
        s.mock("GET", "/s/elsewhere").with_status(302).with_header("location", "https://evil.example/playlist/5").create_async().await;
        s.mock("GET", "/s/plain").with_status(200).with_body("<html></html>").create_async().await;
        let hop = s.mock("GET", "/playlist/5").with_body(r#"{"title":"Short","public":true,"nb_tracks":0}"#).create_async().await;
        s.mock("GET", "/playlist/5/tracks").match_query(Matcher::Any).with_body(r#"{"data":[],"total":0}"#).create_async().await;
        let d = client(&s);
        assert_eq!(d.fetch("https://link.deezer.com/s/goodcode").await.unwrap().name, "Short");
        hop.assert_async().await;
        for code in ["missing", "elsewhere", "plain"] {
            let e = said(&d, &format!("https://link.deezer.com/s/{code}")).await;
            assert_eq!(e, "This Deezer link doesn't lead to a playlist or an album", "{code}");
        }
    }
}
