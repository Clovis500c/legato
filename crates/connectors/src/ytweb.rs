//! Normal YouTube search through YouTube's own web API ("InnerTube", client WEB: what www.youtube.com calls). No key,
//! no quota. Uses the Google session when there is one (the same cookies as YouTube Music), anonymous otherwise.
//! Finds what YouTube Music misses: songs never listed as music, covers, edits, uploads by small channels.
//! Unofficial: response shapes change, so parsing walks the JSON for `videoRenderer` whatever the layout.

use crate::youtube::parse_video;
use crate::ytmusic::{all, cookie_value, parse_duration, sapisid_hash_for, site_version, text};
use anyhow::{Context, Result, bail};
use music_core::model::{Source, Track};
use music_core::musicness::{Clues, Musicness, classify};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

pub const API: &str = "https://www.youtube.com/youtubei/v1";
const ORIGIN: &str = "https://www.youtube.com";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
/// Google's suggest service, what YouTube's search box asks as you type. Client "firefox" = plain JSON, no key.
pub const SUGGEST: &str = "https://suggestqueries.google.com/complete/search";
/// Search filter "Type: Video" (protobuf params the site sends): no channels, playlists or Shorts shelves.
const VIDEOS_ONLY: &str = "EgIQAQ==";

/// One search result: the track, plus what tells music from the rest.
#[derive(Debug, Clone, PartialEq)]
pub struct WebVideo {
    pub track: Track,
    /// Title as YouTube shows it ("Artist - Song (Official Video)"), before the artist is split off.
    pub raw_title: String,
    pub channel: String,
    /// Official artist channel badge.
    pub artist_badge: bool,
    pub live: bool,
}

impl WebVideo {
    pub fn musicness(&self) -> Musicness {
        classify(&Clues { title: &self.raw_title, channel: &self.channel, duration_ms: self.track.duration_ms, artist_badge: self.artist_badge, video_type: None, live: self.live })
    }
}

fn badge(v: &Value, style: &str) -> bool {
    all(v, "metadataBadgeRenderer").iter().any(|b| b.get("style").and_then(Value::as_str) == Some(style))
}

/// Every `videoRenderer` in a search answer → videos. Rows without an id or a title are skipped.
pub fn parse_search(v: &Value) -> Vec<WebVideo> {
    let mut out: Vec<WebVideo> = Vec::new();
    for r in all(v, "videoRenderer") {
        let Some(id) = r.get("videoId").and_then(Value::as_str).filter(|id| id.len() == 11) else { continue };
        if out.iter().any(|o| o.track.ids.get(&Source::Youtube).map(String::as_str) == Some(id)) {
            continue;
        }
        let Some(raw) = r.get("title").and_then(text).filter(|t| !t.trim().is_empty()) else { continue };
        let channel = ["ownerText", "longBylineText", "shortBylineText"].iter().find_map(|k| r.get(*k).and_then(text)).unwrap_or_default();
        let duration_ms = r.get("lengthText").and_then(text).as_deref().and_then(parse_duration);
        let (artist, title) = parse_video(raw.trim(), &channel);
        let owner = r.get("ownerBadges").cloned().unwrap_or(Value::Null);
        let badges = r.get("badges").cloned().unwrap_or(Value::Null);
        let mut video = WebVideo {
            track: Track {
                title,
                artist,
                album: None,
                duration_ms,
                isrc: None,
                ids: BTreeMap::from([(Source::Youtube, id.to_string())]),
                art: Some(format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg")),
                musicness: None,
            },
            raw_title: raw,
            artist_badge: badge(&owner, "BADGE_STYLE_TYPE_VERIFIED_ARTIST"),
            live: badge(&badges, "BADGE_STYLE_TYPE_LIVE_NOW"),
            channel,
        };
        video.track.musicness = Some(video.musicness());
        out.push(video);
    }
    out
}

pub struct YouTubeWeb {
    api: String,
    cookie: Option<String>,
    sapisid: Option<String>,
    http: reqwest::Client,
}

impl YouTubeWeb {
    /// `cookie` = the Google session (YouTube Music sign-in), if any.
    pub fn new(cookie: Option<&str>) -> Self {
        Self::with_api(API, cookie)
    }

    pub fn with_api(api: &str, cookie: Option<&str>) -> Self {
        let sapisid = cookie.and_then(|c| cookie_value(c, "SAPISID").or_else(|| cookie_value(c, "__Secure-3PAPISID"))).map(String::from);
        Self { api: api.into(), cookie: cookie.map(String::from), sapisid, http: reqwest::Client::new() }
    }

    async fn call(&self, endpoint: &str, mut body: Value) -> Result<Value> {
        let version = site_version(2);
        body["context"] = json!({ "client": { "clientName": "WEB", "clientVersion": version, "hl": "en" }, "user": {} });
        let mut req = self
            .http
            .post(format!("{}/{endpoint}?prettyPrint=false", self.api))
            .header("x-origin", ORIGIN)
            .header("origin", ORIGIN)
            .header("user-agent", UA)
            .header("x-youtube-client-name", "1")
            .header("x-youtube-client-version", &version)
            .json(&body);
        if let (Some(cookie), Some(sapisid)) = (&self.cookie, &self.sapisid) {
            let ts = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
            req = req.header("cookie", cookie).header("authorization", sapisid_hash_for(sapisid, ts, ORIGIN)).header("x-goog-authuser", "0");
        }
        let mut res = req.try_clone().context("request not retryable")?.send().await?;
        // Unofficial backend: brief 5xx blips happen. One retry.
        if res.status().is_server_error() {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            res = req.send().await?;
        }
        let status = res.status();
        if !status.is_success() {
            bail!("YouTube {endpoint} → {status} {}", res.text().await.unwrap_or_default().chars().take(300).collect::<String>());
        }
        Ok(res.json().await?)
    }

    /// Videos for a query, YouTube's own ranking.
    pub async fn search(&self, query: &str) -> Result<Vec<WebVideo>> {
        Ok(parse_search(&self.call("search", json!({ "query": query, "params": VIDEOS_ONLY })).await?))
    }
}

/// Searches YouTube would suggest for `query` (`hl` = interface language, `gl` = country), best first. Answer:
/// `["query", ["suggestion", …], …]`.
pub async fn suggestions(base: &str, query: &str, hl: &str, gl: &str) -> Result<Vec<String>> {
    let params = [("client", "firefox"), ("ds", "yt"), ("ie", "utf-8"), ("oe", "utf-8"), ("hl", hl), ("gl", gl), ("q", query)];
    let url = url::Url::parse_with_params(base, &params)?;
    let res = reqwest::Client::new().get(url).header("user-agent", UA).send().await?;
    let status = res.status();
    if !status.is_success() {
        bail!("YouTube suggestions → {status}");
    }
    Ok(parse_suggestions(&res.json().await?))
}

fn parse_suggestions(v: &Value) -> Vec<String> {
    v.get(1).and_then(Value::as_array).map(|list| list.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};

    fn video(id: &str, title: &str, channel: &str, length: &str, artist: bool) -> Value {
        let mut v = json!({ "videoRenderer": {
            "videoId": id,
            "title": { "runs": [{ "text": title }] },
            "ownerText": { "runs": [{ "text": channel }] },
            "lengthText": { "simpleText": length },
            "thumbnail": { "thumbnails": [{ "url": format!("https://i.ytimg.com/vi/{id}/hq720.jpg?sqp=x") }] }
        } });
        if artist {
            v["videoRenderer"]["ownerBadges"] = json!([{ "metadataBadgeRenderer": { "style": "BADGE_STYLE_TYPE_VERIFIED_ARTIST" } }]);
        }
        v
    }

    fn answer(items: Vec<Value>) -> Value {
        json!({ "contents": { "twoColumnSearchResultsRenderer": { "primaryContents": { "sectionListRenderer": { "contents": [{ "itemSectionRenderer": { "contents": items } }] } } } } })
    }

    #[test]
    fn parses_videos_and_tells_music_apart() {
        let v = answer(vec![
            video("aaaaaaaaaaa", "Daft Punk - Get Lucky (Official Audio)", "Daft Punk", "6:09", true),
            json!({ "channelRenderer": { "channelId": "UC1" } }),
            video("bbbbbbbbbbb", "FIRST TIME HEARING Daft Punk | REACTION", "Reactor", "24:10", false),
            video("aaaaaaaaaaa", "duplicate", "x", "1:00", false),
            video("ccccccccccc", "Get Lucky", "Daft Punk - Topic", "4:08", false),
        ]);
        let found = parse_search(&v);
        assert_eq!(found.len(), 3);
        let first = &found[0];
        assert_eq!((first.track.artist.as_str(), first.track.title.as_str()), ("Daft Punk", "Get Lucky (Official Audio)"));
        assert_eq!(first.track.duration_ms, Some(369_000));
        assert_eq!(first.track.art.as_deref(), Some("https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg"));
        assert!(first.artist_badge);
        assert_eq!(first.musicness(), Musicness::Music);
        assert_eq!(found[1].musicness(), Musicness::NotMusic);
        assert_eq!((found[2].track.artist.as_str(), found[2].musicness()), ("Daft Punk", Musicness::Music));
    }

    #[tokio::test]
    async fn searches_videos_only_signed_in_or_not() {
        let mut s = Server::new_async().await;
        let signed = s
            .mock("POST", "/search")
            .match_query(Matcher::Any)
            .match_header("authorization", Matcher::Regex("^SAPISIDHASH \\d+_[0-9a-f]{40}$".into()))
            .match_body(Matcher::PartialJson(json!({ "query": "get lucky", "params": VIDEOS_ONLY, "context": { "client": { "clientName": "WEB" } } })))
            .with_body(answer(vec![video("aaaaaaaaaaa", "Get Lucky", "Daft Punk - Topic", "4:08", false)]).to_string())
            .create_async()
            .await;
        let yt = YouTubeWeb::with_api(&s.url(), Some("YSC=x; SAPISID=abc/def"));
        assert_eq!(yt.search("get lucky").await.unwrap().len(), 1);
        signed.assert_async().await;

        let mut s = Server::new_async().await;
        let anon = s.mock("POST", "/search").match_query(Matcher::Any).match_header("authorization", Matcher::Missing).with_body(answer(vec![]).to_string()).create_async().await;
        assert!(YouTubeWeb::with_api(&s.url(), None).search("x").await.unwrap().is_empty());
        anon.assert_async().await;
    }

    #[tokio::test]
    async fn errors_carry_the_status() {
        let mut s = Server::new_async().await;
        s.mock("POST", "/search").match_query(Matcher::Any).with_status(429).with_body("slow down").expect(1).create_async().await;
        let e = YouTubeWeb::with_api(&s.url(), None).search("x").await.unwrap_err().to_string();
        assert!(e.contains("429") && e.contains("slow down"), "{e}");
    }

    #[tokio::test]
    async fn suggests_what_youtube_would() {
        let mut s = Server::new_async().await;
        let m = s
            .mock("GET", "/")
            .match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("q".into(), "télé".into()), Matcher::UrlEncoded("ds".into(), "yt".into()), Matcher::UrlEncoded("hl".into(), "fr".into()), Matcher::UrlEncoded("gl".into(), "FR".into())]))
            .with_body(json!(["télé", ["télépopmusik", "télépopmusik breathe"], [], { "google:suggestsubtypes": [] }]).to_string())
            .create_async()
            .await;
        assert_eq!(suggestions(&s.url(), "télé", "fr", "FR").await.unwrap(), ["télépopmusik", "télépopmusik breathe"]);
        m.assert_async().await;
        for v in [json!(null), json!(["x"]), json!(["x", "y"]), json!(["x", [1, "ok"]])] {
            assert!(parse_suggestions(&v).len() <= 1, "{v}");
        }
    }

    /// Unofficial API: a reshuffled answer gives nothing, never a panic.
    #[test]
    fn parser_survives_unknown_shapes() {
        for v in [json!(null), json!([]), json!({ "videoRenderer": 3 }), json!({ "videoRenderer": { "videoId": 5, "title": "x" } }), json!({ "videoRenderer": { "videoId": "short", "title": { "simpleText": "t" } } })] {
            assert!(parse_search(&v).is_empty(), "{v}");
        }
    }
}
