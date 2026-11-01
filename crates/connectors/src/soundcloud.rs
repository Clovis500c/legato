//! Pasted SoundCloud song links, metadata only: SoundCloud's public oEmbed (no key, no account) names the song, then
//! the shell finds it on YouTube. Nothing plays from SoundCloud. A set's songs need its API, which wants a registered
//! app and bars scraping (plan-v2 › Platforms, its terms): said plainly instead.

use crate::linklist::REQUEST_TIMEOUT;
use anyhow::{Result, bail, ensure};
use music_core::model::Track;
use music_core::musicness::Musicness;
use regex::Regex;
use reqwest::StatusCode;
use serde::Deserialize;
use std::sync::LazyLock;
use url::Url;

/// Keyless song metadata endpoint.
pub const OEMBED: &str = "https://soundcloud.com/oembed";
/// The mobile app's share links.
pub const SHORT: &str = "https://on.soundcloud.com";

/// `soundcloud.com/<user>/<song>`, a private song's `/s-<token>` after; www. and m. too; the query left out.
static LINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^\s*(?:https?://)?(?:(?:www|m)\.)?soundcloud\.com/([\w-]+)(?:/([\w-]+))?(?:/([\w-]+))?/?(?:[?#]\S*)?\s*$").unwrap());
static SHORT_LINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^\s*(?:https?://)?on\.soundcloud\.com/([A-Za-z0-9]+)/?(?:[?#]\S*)?\s*$").unwrap());
static ANY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^\s*(?:https?://)?(?:(?:www|m|on)\.)?soundcloud\.com/\S+\s*$").unwrap());

/// Parts of a user's page, not songs.
const NOT_SONGS: [&str; 11] = ["sets", "likes", "tracks", "albums", "reposts", "popular-tracks", "followers", "following", "comments", "spotlight", "playlists"];

const SET: &str = "SoundCloud shares a playlist's songs only with registered apps: paste one song's link at a time";
const NOT_A_SONG: &str = "This SoundCloud link doesn't lead to a song";

#[derive(Debug, PartialEq)]
enum Target {
    /// The song's own link.
    Song(String),
    Set,
    Short(String),
}

fn target(text: &str) -> Option<Target> {
    if let Some(c) = SHORT_LINK.captures(text) {
        return Some(Target::Short(c[1].to_string()));
    }
    let c = LINK.captures(text)?;
    let (user, song) = (&c[1], c.get(2)?.as_str());
    match (song.to_lowercase().as_str(), c.get(3).map(|m| m.as_str())) {
        ("sets", Some(_)) => Some(Target::Set),
        (s, _) if NOT_SONGS.contains(&s) => None,
        (_, None) => Some(Target::Song(format!("https://soundcloud.com/{user}/{song}"))),
        (_, Some(token)) if token.starts_with("s-") => Some(Target::Song(format!("https://soundcloud.com/{user}/{song}/{token}"))),
        _ => None,
    }
}

/// Any SoundCloud link, the link alone: the paste picks the service by it, `song` says plainly what isn't a song.
pub fn is_soundcloud(text: &str) -> bool {
    ANY.is_match(text)
}

#[derive(Deserialize)]
struct OEmbed {
    title: String,
    author_name: String,
    thumbnail_url: Option<String>,
    html: Option<String>,
}

/// The song behind a pasted link: its title and uploader, its artwork. oEmbed has no length.
pub async fn song(oembed: &str, short: &str, text: &str) -> Result<Track> {
    let link = match target(text) {
        Some(Target::Song(link)) => link,
        Some(Target::Short(code)) => resolve(short, &code).await?,
        Some(Target::Set) => bail!(SET),
        None => bail!(NOT_A_SONG),
    };
    let url = Url::parse_with_params(oembed, &[("format", "json"), ("url", link.as_str())])?;
    let res = crate::http().get(url).timeout(REQUEST_TIMEOUT).send().await?;
    ensure!(![StatusCode::NOT_FOUND, StatusCode::FORBIDDEN, StatusCode::UNAUTHORIZED].contains(&res.status()), "This SoundCloud song is private or doesn't exist");
    parse(res.error_for_status()?.json().await?)
}

fn parse(o: OEmbed) -> Result<Track> {
    // A set behind a short link: its player names a playlist.
    ensure!(!o.html.unwrap_or_default().contains("%2Fplaylists%2F"), SET);
    // "Flickermood by Forss": the song's title, then its uploader.
    let name = o.title.strip_suffix(&format!(" by {}", o.author_name)).unwrap_or(&o.title).trim();
    ensure!(!name.is_empty(), "SoundCloud sent no title for this song");
    // A label's upload says "Artist - Title", like a YouTube video.
    let (artist, title) = crate::youtube::parse_video(name, &o.author_name);
    Ok(Track { title, artist, art: o.thumbnail_url.filter(|u| crate::art::allowed(u)), musicness: Some(Musicness::Music), ..Default::default() })
}

/// Short link → the song's own. One redirect, read here, kept only when it leads to a song on SoundCloud.
async fn resolve(short: &str, code: &str) -> Result<String> {
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(REQUEST_TIMEOUT).build()?;
    let res = client.get(format!("{short}/{code}")).send().await?;
    ensure!(res.status() != StatusCode::NOT_FOUND, "This SoundCloud link doesn't exist");
    let to = res.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()).filter(|_| res.status().is_redirection());
    match to.and_then(target) {
        Some(Target::Song(link)) => Ok(link),
        Some(Target::Set) => bail!(SET),
        _ => bail!(NOT_A_SONG),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};

    /// SoundCloud's answer for its own documented example (2026-11-01).
    const FLICKERMOOD: &str = r#"{"version":1.0,"type":"rich","provider_name":"SoundCloud","provider_url":"https://soundcloud.com","height":400,"width":"100%","title":"Flickermood by Forss","description":"From the Soulhack album","thumbnail_url":"https://i1.sndcdn.com/artworks-000067273316-smsiqx-t500x500.jpg","html":"<iframe width=\"100%\" height=\"400\" scrolling=\"no\" frameborder=\"no\" allow=\"autoplay; encrypted-media\" src=\"https://w.soundcloud.com/player/?visual=true&url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F293&show_artwork=true\"></iframe>","author_name":"Forss","author_url":"https://soundcloud.com/forss"}"#;
    const SOULHACK: &str = r#"{"title":"Soulhack by Forss","author_name":"Forss","thumbnail_url":"https://i1.sndcdn.com/artworks-000067273270-uinyvw-t500x500.jpg","html":"<iframe src=\"https://w.soundcloud.com/player/?visual=true&url=https%3A%2F%2Fapi.soundcloud.com%2Fplaylists%2F18&show_artwork=true\"></iframe>"}"#;

    #[test]
    fn reads_soundcloud_links() {
        let song = |l: &str| Some(Target::Song(l.into()));
        for (link, want) in [
            ("https://soundcloud.com/forss/flickermood", song("https://soundcloud.com/forss/flickermood")),
            ("  soundcloud.com/forss/flickermood?si=abc&utm_source=clipboard  ", song("https://soundcloud.com/forss/flickermood")),
            ("https://m.soundcloud.com/forss/flickermood", song("https://soundcloud.com/forss/flickermood")),
            ("https://www.soundcloud.com/forss/flickermood/", song("https://soundcloud.com/forss/flickermood")),
            ("https://soundcloud.com/forss/flickermood?in=forss/sets/soulhack", song("https://soundcloud.com/forss/flickermood")),
            ("https://soundcloud.com/forss/flickermood/s-AbCdE12", song("https://soundcloud.com/forss/flickermood/s-AbCdE12")),
            ("https://soundcloud.com/forss/sets/soulhack", Some(Target::Set)),
            ("https://on.soundcloud.com/7uSHpQx2", Some(Target::Short("7uSHpQx2".into()))),
        ] {
            assert_eq!(target(link), want, "{link}");
            assert!(is_soundcloud(link), "{link}");
        }
        for bad in ["https://soundcloud.com/forss", "https://soundcloud.com/forss/sets", "https://soundcloud.com/forss/likes", "https://soundcloud.com/forss/Tracks", "https://soundcloud.com/forss/flickermood/comments", "https://evil.example/soundcloud.com/a/b", "https://soundcloud.com.evil.example/a/b", "daft punk"] {
            assert_eq!(target(bad), None, "{bad}");
        }
        for other in ["https://evil.example/soundcloud.com/a/b", "https://soundcloud.com.evil.example/a/b", "listen https://soundcloud.com/forss/flickermood", "daft punk"] {
            assert!(!is_soundcloud(other), "{other}");
        }
    }

    #[test]
    fn names_the_song_from_its_title() {
        let o = |title: &str, author: &str| OEmbed { title: title.into(), author_name: author.into(), thumbnail_url: Some("https://evil.example/x.jpg".into()), html: None };
        let t = parse(o("Flickermood by Forss", "Forss")).unwrap();
        assert_eq!((t.artist.as_str(), t.title.as_str(), t.art), ("Forss", "Flickermood", None));
        let t = parse(o("Pegboard Nerds - Hero (feat. Elizaveta) by Monstercat", "Monstercat")).unwrap();
        assert_eq!((t.artist.as_str(), t.title.as_str()), ("Pegboard Nerds", "Hero (feat. Elizaveta)"));
        assert!(parse(o(" by Forss", "Forss")).is_err());
    }

    #[tokio::test]
    async fn reads_a_song_and_says_what_it_cant() {
        let mut s = Server::new_async().await;
        let oembed = format!("{}/oembed", s.url());
        let asked = |link: &str| Matcher::AllOf(vec![Matcher::UrlEncoded("url".into(), link.into()), Matcher::UrlEncoded("format".into(), "json".into())]);
        s.mock("GET", "/oembed").match_query(asked("https://soundcloud.com/forss/flickermood")).with_body(FLICKERMOOD).create_async().await;
        s.mock("GET", "/oembed").match_query(asked("https://soundcloud.com/forss/gone")).with_status(404).create_async().await;
        s.mock("GET", "/oembed").match_query(asked("https://soundcloud.com/forss/soulhack-set")).with_body(SOULHACK).create_async().await;
        s.mock("GET", "/7uSHpQx2").with_status(302).with_header("location", "https://soundcloud.com/forss/flickermood?utm_source=clipboard&utm_medium=text").create_async().await;
        s.mock("GET", "/elsewhere").with_status(302).with_header("location", "https://evil.example/forss/flickermood").create_async().await;
        s.mock("GET", "/settled").with_status(302).with_header("location", "https://soundcloud.com/forss/soulhack-set").create_async().await;
        s.mock("GET", "/missing").with_status(404).create_async().await;
        let short = s.url();
        let read = |link: &'static str| song(&oembed, &short, link);
        for link in ["https://soundcloud.com/forss/flickermood?si=x", "https://on.soundcloud.com/7uSHpQx2"] {
            let t = read(link).await.unwrap();
            assert_eq!((t.artist.as_str(), t.title.as_str()), ("Forss", "Flickermood"), "{link}");
            assert_eq!(t.art.as_deref(), Some("https://i1.sndcdn.com/artworks-000067273316-smsiqx-t500x500.jpg"));
            assert!(t.ids.is_empty());
        }
        let said = |link: &'static str| async move { read(link).await.unwrap_err().to_string() };
        assert_eq!(said("https://soundcloud.com/forss/gone").await, "This SoundCloud song is private or doesn't exist");
        for set in ["https://soundcloud.com/forss/sets/soulhack", "https://soundcloud.com/forss/soulhack-set", "https://on.soundcloud.com/settled"] {
            assert!(said(set).await.starts_with("SoundCloud shares a playlist's songs only with registered apps"), "{set}");
        }
        for not_song in ["https://soundcloud.com/forss", "https://on.soundcloud.com/elsewhere"] {
            assert_eq!(said(not_song).await, NOT_A_SONG, "{not_song}");
        }
        assert_eq!(said("https://on.soundcloud.com/missing").await, "This SoundCloud link doesn't exist");
    }
}
