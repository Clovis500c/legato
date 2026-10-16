//! Keyless YouTube helpers: video links, oEmbed metadata, artist/title from video titles.
//! Account features (library, search, export) live in `ytmusic` (Google sign-in).

use anyhow::Result;
use music_core::model::{Source, Track};
use regex::Regex;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::LazyLock;
use url::Url;

static TOPIC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.+) - Topic$").unwrap());
static DASH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.+?)\s+[-–—]\s+(.+)$").unwrap());
static CHANNEL_NOISE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\s*VEVO$|\s*-?\s*Official$").unwrap());
static VIDEO_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:youtube\.com/(?:watch\?(?:[^#]*&)?v=|shorts/|embed/|live/)|youtu\.be/)([\w-]{11})").unwrap());

/// Guess (artist, title). "X - Topic" channel = clean metadata; else "Artist - Title"; else channel.
pub fn parse_video(title: &str, channel: &str) -> (String, String) {
    if let Some(c) = TOPIC.captures(channel) {
        return (c[1].to_string(), title.to_string());
    }
    if let Some(c) = DASH.captures(title) {
        return (c[1].to_string(), c[2].to_string());
    }
    (CHANNEL_NOISE.replace_all(channel, "").into_owned(), title.to_string())
}

/// Keyless video metadata endpoint.
pub const OEMBED: &str = "https://www.youtube.com/oembed";

/// Video id from a YouTube / YouTube Music / Shorts / youtu.be link.
pub fn video_id(link: &str) -> Option<String> {
    VIDEO_ID.captures(link).map(|c| c[1].to_string())
}

#[derive(Deserialize)]
struct OEmbed {
    title: String,
    author_name: String,
}

/// Track from a pasted link, no key or login (oEmbed). oEmbed has no duration.
pub async fn track_from_link(link: &str, oembed: &str) -> Result<Track> {
    let id = video_id(link).ok_or_else(|| anyhow::anyhow!("YouTube link not recognized"))?;
    let watch = format!("https://www.youtube.com/watch?v={id}");
    let url = Url::parse_with_params(oembed, &[("url", watch.as_str()), ("format", "json")])?;
    let o: OEmbed = reqwest::get(url).await?.error_for_status()?.json().await?;
    let (artist, title) = parse_video(&o.title, &o.author_name);
    Ok(Track { title, artist, ids: BTreeMap::from([(Source::Youtube, id)]), ..Default::default() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};

    #[test]
    fn parses_video_titles() {
        for (title, channel, artist, out) in [
            ("Get Lucky", "Daft Punk - Topic", "Daft Punk", "Get Lucky"),
            ("Daft Punk - Get Lucky (Official Audio) ft. Pharrell Williams", "DaftPunkVEVO", "Daft Punk", "Get Lucky (Official Audio) ft. Pharrell Williams"),
            ("Stromae – Alors on danse", "stromae", "Stromae", "Alors on danse"),
            ("Hello", "AdeleVEVO", "Adele", "Hello"),
            ("Bad Guy", "Billie Eilish Official", "Billie Eilish", "Bad Guy"),
        ] {
            assert_eq!(parse_video(title, channel), (artist.to_string(), out.to_string()), "{title}");
        }
    }

    #[test]
    fn finds_video_id_in_links() {
        for link in ["https://www.youtube.com/watch?v=jNQXAC9IVRw", "https://music.youtube.com/watch?list=RD&v=jNQXAC9IVRw&t=3", "https://youtu.be/jNQXAC9IVRw?si=x", "https://www.youtube.com/shorts/jNQXAC9IVRw", "https://www.youtube.com/embed/jNQXAC9IVRw"] {
            assert_eq!(video_id(link).as_deref(), Some("jNQXAC9IVRw"), "{link}");
        }
        assert_eq!(video_id("https://open.spotify.com/track/abc"), None);
    }

    #[tokio::test]
    async fn builds_track_from_link_via_oembed() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/oembed")
            .match_query(Matcher::UrlEncoded("url".into(), "https://www.youtube.com/watch?v=5NV6Rdv1a3I".into()))
            .with_body(r#"{"title":"Daft Punk - Get Lucky (Official Audio)","author_name":"DaftPunkVEVO"}"#)
            .create_async()
            .await;
        let t = track_from_link("https://youtu.be/5NV6Rdv1a3I", &format!("{}/oembed", s.url())).await.unwrap();
        assert_eq!((t.artist.as_str(), t.title.as_str(), t.ids[&Source::Youtube].as_str()), ("Daft Punk", "Get Lucky (Official Audio)", "5NV6Rdv1a3I"));
        assert!(track_from_link("https://example.com", &s.url()).await.is_err());
    }
}
