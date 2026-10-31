//! Public Spotify playlists and albums by link, no account and no keys: Spotify's official embed page
//! (open.spotify.com/embed/…) carries the list as JSON. Unofficial page data; the embed shows the first 100 tracks.
//! Single tracks too (`track`): Spotify's desktop app copies a list's songs as track links, any list, private ones too.

use anyhow::{Context, Result};
use music_core::model::{Source, Track};
use regex::Regex;
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::sync::LazyLock;

/// Tracks an embed page carries at most.
pub const EMBED_MAX: usize = 100;

pub const EMBED: &str = "https://open.spotify.com/embed";
pub(crate) const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

static LINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:open\.spotify\.com/(?:intl-[a-z-]+/)?(?:embed/)?|spotify:)(playlist|album)[/:]([A-Za-z0-9]{22})").unwrap());
static TRACK_LINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:open\.spotify\.com/(?:intl-[a-z-]+/)?(?:embed/)?track/|spotify:track:)([A-Za-z0-9]{22})").unwrap());
static NEXT_DATA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?s)<script id="__NEXT_DATA__" type="application/json">(.*?)</script>"#).unwrap());

#[derive(Debug, PartialEq)]
pub struct SpotifyList {
    /// "playlist" or "album".
    pub kind: String,
    pub id: String,
    pub name: String,
    pub tracks: Vec<Track>,
}

/// (kind, id) from an open.spotify.com link or a spotify: URI.
pub fn parse_link(link: &str) -> Option<(String, String)> {
    LINK.captures(link).map(|c| (c[1].to_string(), c[2].to_string()))
}

/// First object holding a track list, whatever the page layout.
fn entity(v: &Value) -> Option<&Value> {
    if v.get("trackList").is_some_and(Value::is_array) {
        return Some(v);
    }
    match v {
        Value::Object(m) => m.values().find_map(entity),
        Value::Array(a) => a.iter().find_map(entity),
        _ => None,
    }
}

fn parse_page(html: &str, kind: &str, id: &str) -> Result<SpotifyList> {
    let json = NEXT_DATA.captures(html).context("Spotify page without playlist data")?;
    let data: Value = serde_json::from_str(&json[1])?;
    let e = entity(&data).context("No tracks in this Spotify page")?;
    let name = e.get("name").and_then(Value::as_str).unwrap_or("Spotify playlist").to_string();
    // Album page: its cover is every track's cover. Playlist covers aren't.
    let album_art = (kind == "album").then(|| e.pointer("/coverArt/sources/0/url").and_then(Value::as_str).map(String::from)).flatten();
    let tracks = e["trackList"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|t| t.get("entityType").and_then(Value::as_str).is_none_or(|k| k == "track"))
        .filter_map(|t| {
            let id = t.get("uri")?.as_str()?.strip_prefix("spotify:track:")?.to_string();
            // Artists come as "A,\u{a0}B".
            let artist = t.get("subtitle")?.as_str()?.split(',').map(str::trim).filter(|a| !a.is_empty()).collect::<Vec<_>>().join(", ");
            Some(Track {
                title: t.get("title")?.as_str()?.to_string(),
                artist,
                album: (kind == "album").then(|| name.clone()),
                duration_ms: t.get("duration").and_then(Value::as_u64).map(|d| d as u32),
                isrc: None,
                ids: BTreeMap::from([(Source::Spotify, id)]),
                art: album_art.clone(),
                musicness: Some(music_core::musicness::Musicness::Music),
            })
        })
        .collect();
    Ok(SpotifyList { kind: kind.into(), id: id.into(), name, tracks })
}

/// The tracks named in pasted text, in order, each once, at most `max`.
pub fn track_ids(text: &str, max: usize) -> Vec<String> {
    let mut seen = HashSet::new();
    TRACK_LINK.captures_iter(text).map(|c| c[1].to_string()).filter(|id| seen.insert(id.clone())).take(max).collect()
}

/// One track's embed page: names, length, cover (no album or ISRC there). Its cover moved to i.scdn.co, same picture.
fn parse_track(html: &str, id: &str) -> Result<Track> {
    let json = NEXT_DATA.captures(html).context("Spotify page without track data")?;
    let data: Value = serde_json::from_str(&json[1])?;
    let e = data.pointer("/props/pageProps/state/data/entity").filter(|e| e["type"] == "track").context("Not a Spotify track")?;
    let title = e["name"].as_str().or_else(|| e["title"].as_str()).map(str::trim).filter(|t| !t.is_empty()).context("Spotify track without a title")?;
    let artists: Vec<&str> = e["artists"].as_array().into_iter().flatten().filter_map(|a| a["name"].as_str()).map(str::trim).filter(|a| !a.is_empty()).collect();
    anyhow::ensure!(!artists.is_empty(), "Spotify track without an artist");
    let biggest = e.pointer("/visualIdentity/image").and_then(Value::as_array).and_then(|images| images.iter().max_by_key(|i| i["maxWidth"].as_u64()));
    let picture = biggest.and_then(|i| i["url"].as_str()).and_then(|u| u.rsplit('/').next()).filter(|h| !h.is_empty() && h.bytes().all(|b| b.is_ascii_hexdigit()));
    Ok(Track {
        title: title.to_string(),
        artist: artists.join(", "),
        duration_ms: e["duration"].as_u64().and_then(|d| u32::try_from(d).ok()).filter(|d| *d > 0),
        ids: BTreeMap::from([(Source::Spotify, id.to_string())]),
        art: picture.map(|h| format!("https://i.scdn.co/image/{h}")),
        musicness: Some(music_core::musicness::Musicness::Music),
        ..Default::default()
    })
}

/// One track by id, read from its embed page.
pub async fn track(embed: &str, id: &str) -> Result<Track> {
    let res = crate::http().get(format!("{embed}/track/{id}")).header("user-agent", UA).send().await?;
    anyhow::ensure!(res.status() != reqwest::StatusCode::NOT_FOUND, "This Spotify track doesn't exist");
    parse_track(&res.error_for_status()?.text().await?, id)
}

/// Public playlist or album behind `link`, read from its embed page (`embed` = base URL, injectable for tests).
pub async fn fetch(embed: &str, link: &str) -> Result<SpotifyList> {
    let (kind, id) = parse_link(link).context("Not a Spotify playlist or album link")?;
    let res = crate::http().get(format!("{embed}/{kind}/{id}")).header("user-agent", UA).send().await?;
    anyhow::ensure!(res.status() != reqwest::StatusCode::NOT_FOUND, "This Spotify {kind} is private or doesn't exist");
    parse_page(&res.error_for_status()?.text().await?, &kind, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;
    use serde_json::json;

    const ID: &str = "37i9dQZF1DXcBWIGoYBM5M";

    fn page(entity: Value) -> String {
        let data = json!({ "props": { "pageProps": { "state": { "data": { "entity": entity } } } } });
        format!(r#"<html><script id="__NEXT_DATA__" type="application/json">{data}</script></html>"#)
    }

    #[test]
    fn finds_track_links_in_pasted_text() {
        let text = "https://open.spotify.com/track/0DiWol3AO6WpXZgp0goxAV?si=1\r\nhttps://open.spotify.com/intl-fr/track/3XmwAZpIMNpTJy8faw3ajD\nspotify:track:0DiWol3AO6WpXZgp0goxAV\nhttps://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc";
        assert_eq!(track_ids(text, 10), ["0DiWol3AO6WpXZgp0goxAV", "3XmwAZpIMNpTJy8faw3ajD"]);
        assert_eq!(track_ids(text, 1).len(), 1);
        assert!(track_ids("Daft Punk - One More Time", 10).is_empty());
    }

    #[tokio::test]
    async fn reads_a_track_from_its_embed_page() {
        let mut s = Server::new_async().await;
        // As Spotify's page gave it (2026-11-01), trimmed.
        let entity = json!({ "type": "track", "name": "One More Time", "uri": "spotify:track:0DiWol3AO6WpXZgp0goxAV", "id": "0DiWol3AO6WpXZgp0goxAV", "title": "One More Time",
            "artists": [{ "name": "Daft Punk", "uri": "spotify:artist:4tZwfgrHOc3mvqYlEYSvVi" }, { "name": "Romanthony", "uri": "spotify:artist:x" }], "duration": 320357,
            "visualIdentity": { "image": [{ "url": "https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e021e81bff9807a9e629fce5aa5", "maxHeight": 300, "maxWidth": 300 }, { "url": "https://image-cdn-ak.spotifycdn.com/image/ab67616d000048511e81bff9807a9e629fce5aa5", "maxHeight": 64, "maxWidth": 64 }] } });
        s.mock("GET", "/track/0DiWol3AO6WpXZgp0goxAV").with_body(page(entity)).create_async().await;
        s.mock("GET", "/track/3XmwAZpIMNpTJy8faw3ajD").with_status(404).create_async().await;
        let t = track(&s.url(), "0DiWol3AO6WpXZgp0goxAV").await.unwrap();
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.duration_ms), ("One More Time", "Daft Punk, Romanthony", Some(320_357)));
        assert_eq!(t.art.as_deref(), Some("https://i.scdn.co/image/ab67616d00001e021e81bff9807a9e629fce5aa5"));
        assert_eq!(t.ids[&Source::Spotify], "0DiWol3AO6WpXZgp0goxAV");
        assert!(track(&s.url(), "3XmwAZpIMNpTJy8faw3ajD").await.unwrap_err().to_string().contains("doesn't exist"));
        // Spotify's page for a missing one: no entity.
        assert!(parse_track(r#"<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"status":404}}}</script>"#, "x").is_err());
    }

    #[test]
    fn reads_links_and_uris() {
        for link in [format!("https://open.spotify.com/playlist/{ID}?si=abc"), format!("https://open.spotify.com/intl-fr/playlist/{ID}"), format!("spotify:playlist:{ID}"), format!("https://open.spotify.com/embed/playlist/{ID}")] {
            assert_eq!(parse_link(&link), Some(("playlist".into(), ID.into())), "{link}");
        }
        assert_eq!(parse_link("https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc").map(|l| l.0), Some("album".into()));
        assert_eq!(parse_link("https://open.spotify.com/track/2noRn2Aes5aoNVsU6iWThc"), None);
        assert_eq!(parse_link("https://evil.example/playlist/37i9dQZF1DXcBWIGoYBM5M"), None);
    }

    #[tokio::test]
    async fn imports_playlist_from_embed_page() {
        let mut s = Server::new_async().await;
        let entity = json!({ "name": "Today's Top Hits", "coverArt": { "sources": [{ "url": "https://i.scdn.co/image/pl" }] }, "trackList": [
            { "uri": "spotify:track:3XmwAZpIMNpTJy8faw3ajD", "title": "expectations", "subtitle": "Olivia Rodrigo,\u{a0}Chappell Roan", "duration": 223935, "entityType": "track" },
            { "uri": "spotify:episode:x", "title": "A podcast", "subtitle": "Show", "duration": 1000, "entityType": "episode" }
        ] });
        s.mock("GET", format!("/playlist/{ID}").as_str()).with_body(page(entity)).create_async().await;
        s.mock("GET", "/playlist/0000000000000000000000").with_status(404).create_async().await;
        let list = fetch(&s.url(), &format!("https://open.spotify.com/playlist/{ID}")).await.unwrap();
        assert_eq!((list.kind.as_str(), list.name.as_str(), list.tracks.len()), ("playlist", "Today's Top Hits", 1));
        let t = &list.tracks[0];
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.duration_ms, t.ids[&Source::Spotify].as_str(), t.art.as_deref()), ("expectations", "Olivia Rodrigo, Chappell Roan", Some(223_935), "3XmwAZpIMNpTJy8faw3ajD", None));
        assert!(fetch(&s.url(), "https://open.spotify.com/playlist/0000000000000000000000").await.unwrap_err().to_string().contains("private"));
    }

    #[test]
    fn albums_give_tracks_their_album_and_cover() {
        let entity = json!({ "name": "Discovery", "coverArt": { "sources": [{ "url": "https://i.scdn.co/image/disc" }] }, "trackList": [{ "uri": "spotify:track:0DiWol3AO6WpXZgp0goxAV", "title": "One More Time", "subtitle": "Daft Punk", "duration": 320357 }] });
        let list = parse_page(&page(entity), "album", "2noRn2Aes5aoNVsU6iWThc").unwrap();
        assert_eq!((list.tracks[0].album.as_deref(), list.tracks[0].art.as_deref()), (Some("Discovery"), Some("https://i.scdn.co/image/disc")));
        assert!(parse_page("<html>nothing</html>", "album", "x").is_err());
    }
}
