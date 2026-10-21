//! Public Spotify playlists and albums by link, no account and no keys: Spotify's official embed page
//! (open.spotify.com/embed/…) carries the list as JSON. Unofficial page data; the embed shows the first 100 tracks.

use anyhow::{Context, Result};
use music_core::model::{Source, Track};
use regex::Regex;
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::LazyLock;

pub const EMBED: &str = "https://open.spotify.com/embed";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

static LINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:open\.spotify\.com/(?:intl-[a-z-]+/)?(?:embed/)?|spotify:)(playlist|album)[/:]([A-Za-z0-9]{22})").unwrap());
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

/// Public playlist or album behind `link`, read from its embed page (`embed` = base URL, injectable for tests).
pub async fn fetch(embed: &str, link: &str) -> Result<SpotifyList> {
    let (kind, id) = parse_link(link).context("Not a Spotify playlist or album link")?;
    let res = reqwest::Client::new().get(format!("{embed}/{kind}/{id}")).header("user-agent", UA).send().await?;
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
