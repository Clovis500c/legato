//! Lyrics from LRCLIB (lrclib.net): free, open, no key, time-synced LRC and plain text. Checked 2026-10-21: the client
//! must name itself in User-Agent; `/api/get` needs the duration within ±2 s (else 404); `/api/search` for the rest;
//! 429 carries Retry-After (one look per song here, cached by the caller: no retry loop).

use anyhow::{Result, bail};
use music_core::lyrics::Record;
use serde::Deserialize;
use url::Url;

pub const API: &str = "https://lrclib.net/api";
const AGENT: &str = concat!("Legato v", env!("CARGO_PKG_VERSION"), " (https://github.com/Clovis500c/legato)");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Found {
    track_name: Option<String>,
    artist_name: Option<String>,
    duration: Option<f32>,
    #[serde(default)]
    instrumental: bool,
    plain_lyrics: Option<String>,
    synced_lyrics: Option<String>,
}

impl From<Found> for Record {
    fn from(f: Found) -> Self {
        Record { title: f.track_name.unwrap_or_default(), artist: f.artist_name.unwrap_or_default(), duration_s: f.duration, instrumental: f.instrumental, plain: f.plain_lyrics, synced: f.synced_lyrics }
    }
}

pub struct Lrclib {
    api: String,
    http: reqwest::Client,
}

impl Default for Lrclib {
    fn default() -> Self {
        Self::with_urls(API)
    }
}

impl Lrclib {
    pub fn with_urls(api: &str) -> Self {
        Self { api: api.trim_end_matches('/').to_string(), http: crate::http() }
    }

    async fn ask(&self, url: Url) -> Result<Option<String>> {
        let r = self.http.get(url).header(reqwest::header::USER_AGENT, AGENT).timeout(std::time::Duration::from_secs(15)).send().await?;
        match r.status().as_u16() {
            404 => Ok(None),
            429 | 503 => bail!("LRCLIB is busy, try again in a moment"),
            _ => Ok(Some(r.error_for_status()?.text().await?)),
        }
    }

    /// Exact match: title, artist, album and duration (seconds) must fit.
    pub async fn get(&self, title: &str, artist: &str, album: Option<&str>, duration_s: Option<u32>) -> Result<Option<Record>> {
        let mut url = Url::parse(&format!("{}/get", self.api))?;
        url.query_pairs_mut().append_pair("track_name", title).append_pair("artist_name", artist);
        if let Some(a) = album.filter(|a| !a.is_empty()) {
            url.query_pairs_mut().append_pair("album_name", a);
        }
        if let Some(d) = duration_s.filter(|d| (1..=3600).contains(d)) {
            url.query_pairs_mut().append_pair("duration", &d.to_string());
        }
        Ok(match self.ask(url).await? {
            Some(body) => Some(serde_json::from_str::<Found>(&body)?.into()),
            None => None,
        })
    }

    /// Records for this title and artist, any duration.
    pub async fn search(&self, title: &str, artist: &str) -> Result<Vec<Record>> {
        let mut url = Url::parse(&format!("{}/search", self.api))?;
        url.query_pairs_mut().append_pair("track_name", title).append_pair("artist_name", artist);
        Ok(match self.ask(url).await? {
            Some(body) => serde_json::from_str::<Vec<Found>>(&body)?.into_iter().map(Record::from).collect(),
            None => Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Matcher;

    const ONE: &str = r#"{"id":1,"name":"I Want to Live","trackName":"I Want to Live","artistName":"Borislav Slavov","albumName":"BG3","duration":233,"instrumental":false,"hasWordSync":false,"plainLyrics":"a\nb","syncedLyrics":"[00:01.00]a\n[00:02.00]b","lyricsfile":"x"}"#;

    #[tokio::test]
    async fn get_names_the_app_and_reads_the_record() {
        let mut s = mockito::Server::new_async().await;
        let m = s
            .mock("GET", "/api/get")
            .match_header("user-agent", Matcher::Regex("^Legato v".into()))
            .match_query(Matcher::AllOf(vec![
                Matcher::UrlEncoded("track_name".into(), "I Want to Live".into()),
                Matcher::UrlEncoded("artist_name".into(), "Borislav Slavov".into()),
                Matcher::UrlEncoded("album_name".into(), "BG3".into()),
                Matcher::UrlEncoded("duration".into(), "233".into()),
            ]))
            .with_body(ONE)
            .create_async()
            .await;
        let r = Lrclib::with_urls(&format!("{}/api", s.url())).get("I Want to Live", "Borislav Slavov", Some("BG3"), Some(233)).await.unwrap().unwrap();
        m.assert_async().await;
        assert_eq!((r.title.as_str(), r.duration_s, r.synced.is_some()), ("I Want to Live", Some(233.0), true));
    }

    #[tokio::test]
    async fn misses_searches_and_busy() {
        let mut s = mockito::Server::new_async().await;
        s.mock("GET", "/api/get").match_query(Matcher::Any).with_status(404).with_body(r#"{"name":"TrackNotFound","statusCode":404}"#).create_async().await;
        s.mock("GET", "/api/search").match_query(Matcher::UrlEncoded("track_name".into(), "Song".into())).with_body(format!("[{ONE},{ONE}]")).create_async().await;
        s.mock("GET", "/api/search").match_query(Matcher::UrlEncoded("track_name".into(), "Busy".into())).with_status(429).with_header("retry-after", "3").create_async().await;
        let l = Lrclib::with_urls(&format!("{}/api", s.url()));
        assert!(l.get("X", "Y", None, None).await.unwrap().is_none());
        assert_eq!(l.search("Song", "A").await.unwrap().len(), 2);
        assert!(l.search("Busy", "A").await.unwrap_err().to_string().contains("busy"));
    }
}
