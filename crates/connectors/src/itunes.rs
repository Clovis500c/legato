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

/// Songs for `term` in store `country` (ISO 3166, e.g. "FR"). Id = iTunes track id.
pub async fn search(api: &str, term: &str, country: &str) -> Result<Vec<Track>> {
    let url = Url::parse_with_params(api, &[("term", term), ("entity", "song"), ("limit", "15"), ("country", country)])?;
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
}
