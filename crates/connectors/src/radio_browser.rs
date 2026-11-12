//! Internet radio stations from Radio Browser (radio-browser.info): a free, open directory, no key. `all.api.…` is its
//! round-robin name for the mirrors; a client must name itself in User-Agent. Reads station names and stream addresses
//! only (no audio goes through here). Checked 2026-11-11 from its API docs: `/json/stations/search`, `hidebroken`.

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub const API: &str = "https://all.api.radio-browser.info/json";
const AGENT: &str = concat!("Legato v", env!("CARGO_PKG_VERSION"), " (https://github.com/Clovis500c/legato)");
const TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "RadioStation")]
pub struct Station {
    pub id: String,
    pub name: String,
    /// The stream itself (`url_resolved`: playlists and redirects already followed by the directory).
    pub url: String,
    /// Upper case, as the directory writes it: MP3, AAC, OGG...
    pub codec: String,
    pub bitrate: u32,
    pub country: String,
    pub tags: Vec<String>,
}

#[derive(Deserialize)]
struct Found {
    stationuuid: String,
    name: String,
    url_resolved: String,
    #[serde(default)]
    codec: String,
    #[serde(default)]
    bitrate: u32,
    #[serde(default)]
    country: String,
    #[serde(default)]
    tags: String,
    #[serde(default)]
    hls: u8,
    #[serde(default = "yes")]
    lastcheckok: u8,
}

fn yes() -> u8 {
    1
}

/// The engine reads MP3 and OGG; AAC is a later step, so those stations come after.
fn rank(s: &Station) -> u8 {
    u8::from(!matches!(s.codec.as_str(), "MP3" | "OGG"))
}

/// Stations worth showing: a stream address on http(s), not HLS (a playlist of segments, not one stream), last checked
/// alive. MP3 / OGG first, the directory's order (most voted) kept inside each group.
fn parse(body: &str) -> Result<Vec<Station>> {
    let mut v: Vec<Station> = serde_json::from_str::<Vec<Found>>(body)?
        .into_iter()
        .filter(|f| f.hls == 0 && f.lastcheckok == 1 && (f.url_resolved.starts_with("https://") || f.url_resolved.starts_with("http://")) && !f.name.trim().is_empty())
        .map(|f| Station {
            id: f.stationuuid,
            name: f.name.trim().to_string(),
            url: f.url_resolved,
            codec: f.codec.to_uppercase(),
            bitrate: f.bitrate,
            country: f.country,
            tags: f.tags.split(',').map(str::trim).filter(|t| !t.is_empty()).map(String::from).collect(),
        })
        .collect();
    v.sort_by_key(rank);
    Ok(v)
}

pub struct RadioBrowser {
    api: String,
    http: reqwest::Client,
}

impl Default for RadioBrowser {
    fn default() -> Self {
        Self::with_urls(API)
    }
}

impl RadioBrowser {
    pub fn with_urls(api: &str) -> Self {
        Self { api: api.trim_end_matches('/').to_string(), http: crate::http() }
    }

    /// Stations whose name contains `name`, most voted first, `count` at most (1 to 100).
    pub async fn search(&self, name: &str, count: usize) -> Result<Vec<Station>> {
        let n = count.clamp(1, 100).to_string();
        let mut url = url::Url::parse(&format!("{}/stations/search", self.api))?;
        url.query_pairs_mut().extend_pairs([("name", name), ("hidebroken", "true"), ("order", "votes"), ("reverse", "true"), ("limit", &n)]);
        let r = self.http.get(url).header(reqwest::header::USER_AGENT, AGENT).timeout(TIMEOUT).send().await.map_err(|_| anyhow::anyhow!("The radio directory doesn't answer"))?;
        match r.status().as_u16() {
            429 | 503 => bail!("The radio directory is busy, try again in a moment"),
            s if s >= 400 => bail!("The radio directory refused the request"),
            _ => parse(&r.text().await?),
        }
    }
}

/// A station's stream, opened for the engine: a plain GET (no Range, and no `Icy-MetaData`, so no metadata is mixed
/// into the audio), http or https only. The caller bounds the wait for the answer; the body then runs on, endless.
pub async fn open(stream: &str) -> Result<crate::servers::Streamed> {
    let url = url::Url::parse(stream).ok().filter(|u| matches!(u.scheme(), "http" | "https")).ok_or_else(|| anyhow::anyhow!("This radio station's address isn't right"))?;
    let res = crate::http().get(url).header(reqwest::header::USER_AGENT, AGENT).send().await.map_err(|_| anyhow::anyhow!("This radio station doesn't answer"))?;
    Ok(crate::servers::Streamed::of(res))
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Matcher;

    const BODY: &str = r#"[
      {"stationuuid":"a1","name":"Chill AAC","url_resolved":"https://aac.example/stream","codec":"AAC","bitrate":64,"country":"France","tags":"chill, lounge,","hls":0,"lastcheckok":1},
      {"stationuuid":"b2","name":" Jazz FM ","url_resolved":"http://jazz.example:8000/live","codec":"mp3","bitrate":128,"country":"UK","tags":"jazz","hls":0,"lastcheckok":1},
      {"stationuuid":"c3","name":"Segments","url_resolved":"https://hls.example/a.m3u8","codec":"AAC","bitrate":96,"hls":1,"lastcheckok":1},
      {"stationuuid":"d4","name":"Dead","url_resolved":"https://dead.example/s","codec":"MP3","lastcheckok":0},
      {"stationuuid":"e5","name":"Odd","url_resolved":"ftp://x/y","codec":"MP3","lastcheckok":1},
      {"stationuuid":"f6","name":"Ogg One","url_resolved":"https://ogg.example/s","codec":"OGG","lastcheckok":1}
    ]"#;

    #[test]
    fn keeps_live_streams_and_puts_mp3_and_ogg_first() {
        let v = parse(BODY).unwrap();
        assert_eq!(v.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["b2", "f6", "a1"]);
        assert_eq!((v[0].name.as_str(), v[0].codec.as_str(), v[0].tags.as_slice()), ("Jazz FM", "MP3", ["jazz".to_string()].as_slice()));
        assert_eq!(v[2].tags, ["chill", "lounge"]);
        assert!(parse("not json").is_err());
    }

    #[tokio::test]
    async fn search_names_the_app_and_asks_for_working_stations() {
        let mut s = mockito::Server::new_async().await;
        let m = s
            .mock("GET", "/json/stations/search")
            .match_header("user-agent", Matcher::Regex("^Legato v".into()))
            .match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("name".into(), "jazz".into()), Matcher::UrlEncoded("hidebroken".into(), "true".into()), Matcher::UrlEncoded("limit".into(), "100".into())]))
            .with_body(BODY)
            .create_async()
            .await;
        let r = RadioBrowser::with_urls(&format!("{}/json/", s.url()));
        assert_eq!(r.search("jazz", 500).await.unwrap().len(), 3);
        m.assert_async().await;
    }

    #[tokio::test]
    async fn busy_refused_and_unreachable_have_words() {
        let mut s = mockito::Server::new_async().await;
        s.mock("GET", "/json/stations/search").match_query(Matcher::UrlEncoded("name".into(), "busy".into())).with_status(429).create_async().await;
        s.mock("GET", "/json/stations/search").match_query(Matcher::UrlEncoded("name".into(), "bad".into())).with_status(500).create_async().await;
        let r = RadioBrowser::with_urls(&format!("{}/json", s.url()));
        assert!(r.search("busy", 5).await.unwrap_err().to_string().contains("busy"));
        assert!(r.search("bad", 5).await.unwrap_err().to_string().contains("refused"));
        assert!(RadioBrowser::with_urls("http://127.0.0.1:9").search("x", 5).await.unwrap_err().to_string().contains("doesn't answer"));
    }

    #[tokio::test]
    async fn a_station_is_opened_with_a_plain_get() {
        let mut s = mockito::Server::new_async().await;
        let m = s.mock("GET", "/live").match_header("range", Matcher::Missing).match_header("icy-metadata", Matcher::Missing).match_header("user-agent", Matcher::Regex("^Legato v".into())).with_header("content-type", "audio/mpeg").with_body(vec![7u8; 30]).create_async().await;
        let mut r = open(&format!("{}/live", s.url())).await.unwrap();
        assert_eq!((r.status, r.content_type.as_deref()), (200, Some("audio/mpeg")));
        assert_eq!(r.body.chunk().await.unwrap().map(|b| b.len()), Some(30));
        m.assert_async().await;
        assert!(open("file:///etc/passwd").await.is_err() && open("nonsense").await.is_err());
        assert!(open("http://127.0.0.1:9/x").await.err().unwrap().to_string().contains("doesn't answer"));
    }
}
