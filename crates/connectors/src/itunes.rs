//! Apple Music catalog via the public iTunes Search API: no key, about 20 calls/min.

use anyhow::Result;
use music_core::model::{Source, Track};
use serde::Deserialize;
use std::collections::BTreeMap;
use url::Url;

pub const API: &str = "https://itunes.apple.com/search";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Hit {
    track_id: Option<u64>,
    track_name: Option<String>,
    artist_name: Option<String>,
    collection_name: Option<String>,
    track_time_millis: Option<u32>,
}

#[derive(Deserialize)]
struct Page {
    results: Vec<Hit>,
}

pub const LOOKUP: &str = "https://itunes.apple.com/lookup";

/// Official 30 s preview (AAC) + store page. Apple terms: previews promote the store, so page link shown next to them.
#[derive(Debug, PartialEq)]
pub struct Preview {
    pub audio: String,
    pub page: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LookupHit {
    preview_url: Option<String>,
    track_view_url: Option<String>,
}

/// Apple hosts only: preview bytes and page links come from Apple, never from arbitrary URLs.
pub fn apple_url(url: &str) -> bool {
    Url::parse(url).is_ok_and(|u| u.scheme() == "https" && u.host_str().is_some_and(|h| [".apple.com", ".mzstatic.com"].iter().any(|d| h.ends_with(d))))
}

pub async fn preview(api: &str, id: &str, country: &str) -> Result<Preview> {
    anyhow::ensure!(!id.is_empty() && id.len() <= 20 && id.bytes().all(|b| b.is_ascii_digit()), "Bad Apple Music id");
    let url = Url::parse_with_params(api, &[("id", id), ("country", country)])?;
    let page: serde_json::Value = reqwest::get(url).await?.error_for_status()?.json().await?;
    let hit: LookupHit = serde_json::from_value(page["results"][0].clone()).unwrap_or(LookupHit { preview_url: None, track_view_url: None });
    match (hit.preview_url, hit.track_view_url) {
        (Some(audio), Some(page)) if apple_url(&audio) && apple_url(&page) => Ok(Preview { audio, page }),
        _ => anyhow::bail!("No preview for this track in the {country} store"),
    }
}

/// Preview bytes, kept in memory only (never written to disk).
pub async fn preview_audio(p: &Preview) -> Result<Vec<u8>> {
    const MAX: usize = 8 << 20;
    anyhow::ensure!(apple_url(&p.audio), "Not an Apple preview URL");
    let bytes = reqwest::get(&p.audio).await?.error_for_status()?.bytes().await?;
    anyhow::ensure!(bytes.len() <= MAX, "Preview too large");
    Ok(bytes.to_vec())
}

/// Songs for `term` in store `country` (ISO 3166, e.g. "FR"). Id = iTunes track id.
pub async fn search(api: &str, term: &str, country: &str) -> Result<Vec<Track>> {
    let url = Url::parse_with_params(api, &[("term", term), ("entity", "song"), ("limit", "15"), ("country", country)])?;
    songs(url).await
}

async fn songs(url: Url) -> Result<Vec<Track>> {
    let page: Page = reqwest::get(url).await?.error_for_status()?.json().await?;
    Ok(page
        .results
        .into_iter()
        .filter_map(|h| {
            Some(Track {
                title: h.track_name?,
                artist: h.artist_name?,
                album: h.collection_name,
                duration_ms: h.track_time_millis,
                isrc: None,
                ids: BTreeMap::from([(Source::Apple, h.track_id?.to_string())]),
            })
        })
        .collect())
}

/// Songs by iTunes id, batched (lookup takes a comma list). Ids missing from the store are just absent.
pub async fn lookup(api: &str, ids: &[u64], country: &str) -> Result<Vec<Track>> {
    let mut out = Vec::new();
    for chunk in ids.chunks(150) {
        let list = chunk.iter().map(u64::to_string).collect::<Vec<_>>().join(",");
        out.extend(songs(Url::parse_with_params(api, &[("id", list.as_str()), ("country", country)])?).await?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};

    #[tokio::test]
    async fn maps_songs_and_skips_incomplete_hits() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/search")
            .match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("term".into(), "get lucky".into()), Matcher::UrlEncoded("country".into(), "FR".into())]))
            .with_body(r#"{"resultCount":2,"results":[{"trackId":617154366,"trackName":"Get Lucky","artistName":"Daft Punk","collectionName":"Random Access Memories","trackTimeMillis":369629},{"trackName":"No id"}]}"#)
            .create_async()
            .await;
        let found = search(&format!("{}/search", s.url()), "get lucky", "FR").await.unwrap();
        assert_eq!(found.len(), 1);
        let t = &found[0];
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.duration_ms), ("Get Lucky", "Daft Punk", Some(369_629)));
        assert_eq!(t.ids[&Source::Apple], "617154366");
    }

    #[tokio::test]
    async fn looks_up_ids_in_one_call() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/lookup")
            .match_query(Matcher::UrlEncoded("id".into(), "617154366,1".into()))
            .with_body(r#"{"results":[{"trackId":617154366,"trackName":"Get Lucky","artistName":"Daft Punk"}]}"#)
            .expect(1)
            .create_async()
            .await;
        let found = lookup(&format!("{}/lookup", s.url()), &[617_154_366, 1], "US").await.unwrap();
        assert_eq!(found.iter().map(|t| t.ids[&Source::Apple].as_str()).collect::<Vec<_>>(), ["617154366"]);
    }

    #[tokio::test]
    async fn preview_needs_apple_hosts() {
        let mut s = Server::new_async().await;
        let body = |audio: &str| format!(r#"{{"results":[{{"previewUrl":"{audio}","trackViewUrl":"https://music.apple.com/fr/album/x/1?i=617154366"}}]}}"#);
        s.mock("GET", "/lookup").match_query(Matcher::UrlEncoded("id".into(), "1".into())).with_body(body("https://audio-ssl.itunes.apple.com/a.m4a")).create_async().await;
        s.mock("GET", "/lookup").match_query(Matcher::UrlEncoded("id".into(), "2".into())).with_body(body("https://evil.example/a.m4a")).create_async().await;
        s.mock("GET", "/lookup").match_query(Matcher::UrlEncoded("id".into(), "3".into())).with_body(r#"{"results":[]}"#).create_async().await;
        let api = format!("{}/lookup", s.url());
        assert_eq!(preview(&api, "1", "FR").await.unwrap().audio, "https://audio-ssl.itunes.apple.com/a.m4a");
        assert!(preview(&api, "2", "FR").await.is_err());
        assert!(preview(&api, "3", "FR").await.is_err());
        assert!(preview(&api, "1&x=y", "FR").await.is_err());
        assert!(!apple_url("http://music.apple.com/x") && !apple_url("https://apple.com.evil.example/x"));
    }
}
