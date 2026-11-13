//! Podcasts from open RSS feeds: the feed the user typed, read for its episodes; an episode's audio is the file the feed
//! points at (an `<enclosure>`), played through the engine's ranged HTTP reader like a server song. No directory, no
//! account, nothing but the address the user gave. No XML crate: a feed is read tag by tag (shortcut: no namespaces beyond
//! `itunes:` names, no nested-item feeds; fine for RSS 2.0, the only format podcasts use).

use anyhow::{Result, anyhow, bail};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const AGENT: &str = concat!("Legato v", env!("CARGO_PKG_VERSION"), " (https://github.com/Clovis500c/legato)");
const TIMEOUT: Duration = Duration::from_secs(20);
/// A feed bigger than this is refused (big shows have a few thousand episodes: about 3 MB).
const MAX_BYTES: usize = 8 << 20;
/// Newest episodes kept.
pub const MAX_EPISODES: usize = 300;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "PodcastEpisode")]
pub struct Episode {
    /// The feed's `<guid>`, else the audio address.
    pub id: String,
    pub title: String,
    /// The audio file (http or https).
    pub url: String,
    pub duration_ms: Option<u64>,
    /// As the feed writes it (RFC 822); shown, never parsed.
    pub published: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "PodcastFeed")]
pub struct Feed {
    /// The address the feed was read from (after the user's typing, trimmed).
    pub url: String,
    pub title: String,
    pub author: String,
    /// The show's artwork (https), else empty.
    pub image: String,
    /// Empty in the list of kept shows (the episodes are read again when a show is opened).
    #[serde(default)]
    pub episodes: Vec<Episode>,
}

/// The text between `<tag…>` and `</tag>` (first one), CDATA and the five entities resolved, trimmed.
fn tag(xml: &str, name: &str) -> Option<String> {
    let open = format!("<{name}");
    let mut from = 0;
    while let Some(i) = xml[from..].find(&open) {
        let start = from + i + open.len();
        // `<title` must not be `<titleX`.
        if !matches!(xml[start..].chars().next(), Some('>' | ' ' | '/' | '\n' | '\t' | '\r')) {
            from = start;
            continue;
        }
        let gt = start + xml[start..].find('>')?;
        if xml[..gt].ends_with('/') {
            return Some(String::new());
        }
        let close = format!("</{name}>");
        let end = gt + 1 + xml[gt + 1..].find(&close)?;
        return Some(text(&xml[gt + 1..end]));
    }
    None
}

/// The value of `attr` on the first `<tag …>`.
fn attr(xml: &str, name: &str, attr: &str) -> Option<String> {
    let open = format!("<{name}");
    let mut from = 0;
    while let Some(i) = xml[from..].find(&open) {
        let start = from + i + open.len();
        if !matches!(xml[start..].chars().next(), Some(' ' | '\n' | '\t' | '\r')) {
            from = start;
            continue;
        }
        let end = start + xml[start..].find('>')?;
        let head = &xml[start..end];
        let key = format!("{attr}=");
        let mut at = 0;
        while let Some(k) = head[at..].find(&key) {
            let k = at + k;
            let before_ok = head[..k].chars().next_back().is_none_or(char::is_whitespace);
            let rest = &head[k + key.len()..];
            if before_ok && let Some(q) = rest.chars().next().filter(|c| matches!(c, '"' | '\'')) {
                let v = &rest[1..];
                return v.find(q).map(|e| text(&v[..e]));
            }
            at = k + key.len();
        }
        return None;
    }
    None
}

fn text(raw: &str) -> String {
    let raw = raw.trim();
    let raw = raw.strip_prefix("<![CDATA[").and_then(|r| r.strip_suffix("]]>")).unwrap_or(raw);
    raw.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&").trim().to_string()
}

fn http_url(s: &str) -> Option<String> {
    let u = url::Url::parse(s.trim()).ok()?;
    matches!(u.scheme(), "http" | "https").then(|| u.to_string())
}

/// `1:02:03`, `45:10`, `3600` (seconds).
fn duration(s: &str) -> Option<u64> {
    let mut secs = 0u64;
    let mut n = 0;
    for part in s.trim().split(':') {
        secs = secs.checked_mul(60)?.checked_add(part.trim().parse::<u64>().ok()?)?;
        n += 1;
    }
    (n <= 3 && secs > 0).then_some(secs * 1000)
}

/// A feed's text as a show with its episodes (newest first, as feeds list them), those without audio dropped.
pub fn parse(xml: &str, url: &str) -> Result<Feed> {
    let first = xml.find("<item").unwrap_or(xml.len());
    let head = &xml[..first];
    if !xml.contains("<rss") && !xml.contains("<channel") {
        bail!("That address isn't a podcast feed");
    }
    let title = tag(head, "title").filter(|t| !t.is_empty()).ok_or_else(|| anyhow!("That address isn't a podcast feed"))?;
    let author = tag(head, "itunes:author").or_else(|| tag(head, "managingEditor")).unwrap_or_default();
    let image = attr(head, "itunes:image", "href").and_then(|i| http_url(&i)).filter(|i| i.starts_with("https://")).unwrap_or_default();
    let mut episodes = Vec::new();
    for item in xml[first..].split("<item").skip(1) {
        let item = item.split("</item>").next().unwrap_or(item);
        let Some(audio) = attr(item, "enclosure", "url").and_then(|u| http_url(&u)) else { continue };
        let name = tag(item, "title").filter(|t| !t.is_empty()).unwrap_or_else(|| audio.clone());
        let id = tag(item, "guid").filter(|g| !g.is_empty() && g.len() <= 500).unwrap_or_else(|| audio.clone());
        let length = tag(item, "itunes:duration").and_then(|d| duration(&d));
        episodes.push(Episode { id, title: name.chars().take(300).collect(), url: audio, duration_ms: length, published: tag(item, "pubDate").unwrap_or_default().chars().take(40).collect() });
        if episodes.len() >= MAX_EPISODES {
            break;
        }
    }
    Ok(Feed { url: url.to_string(), title: title.chars().take(300).collect(), author: author.chars().take(200).collect(), image, episodes })
}

/// Reads the feed at `address` (http or https, 8 MB at most).
pub async fn fetch(address: &str) -> Result<Feed> {
    let url = http_url(address).ok_or_else(|| anyhow!("Type a podcast feed's address (http or https)"))?;
    let mut res = crate::http().get(&url).header(reqwest::header::USER_AGENT, AGENT).timeout(TIMEOUT).send().await.map_err(|_| anyhow!("That podcast feed doesn't answer"))?;
    if !res.status().is_success() {
        bail!("That podcast feed refused the request (HTTP {})", res.status().as_u16());
    }
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|_| anyhow!("That podcast feed stopped answering"))? {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_BYTES {
            bail!("That podcast feed is too big");
        }
    }
    parse(&String::from_utf8_lossy(&body), &url)
}

/// An episode's audio from byte `from` on, for the engine (a plain ranged GET; a server ignoring ranges answers 200 and
/// the engine skips ahead). The caller bounds the wait for the answer.
pub async fn open(address: &str, from: u64) -> Result<crate::servers::Streamed> {
    let url = http_url(address).ok_or_else(|| anyhow!("This episode's address isn't right"))?;
    let res = crate::http().get(url).header(reqwest::header::USER_AGENT, AGENT).header(reqwest::header::RANGE, format!("bytes={from}-")).send().await.map_err(|_| anyhow!("This episode's server doesn't answer"))?;
    Ok(crate::servers::Streamed::of(res))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = r#"<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
      <title>Night &amp; Day</title><itunes:author>The Hosts</itunes:author>
      <itunes:image href="https://cdn.example/show.jpg"/>
      <item><title><![CDATA[Ep 2: <b>Two</b>]]></title><guid isPermaLink="false">g2</guid><pubDate>Mon, 02 Nov 2026 06:00:00 GMT</pubDate>
        <enclosure url="https://cdn.example/2.mp3" length="1" type="audio/mpeg"/><itunes:duration>1:02:03</itunes:duration></item>
      <item><title>Ep 1</title><enclosure url="http://cdn.example/1.mp3" type="audio/mpeg"/><itunes:duration>45:10</itunes:duration></item>
      <item><title>No audio</title></item>
      <item><title>Odd</title><enclosure url="ftp://cdn.example/3.mp3"/></item>
    </channel></rss>"#;

    #[test]
    fn reads_the_show_and_its_episodes_with_audio() {
        let f = parse(FEED, "https://feed.example/rss").unwrap();
        assert_eq!((f.title.as_str(), f.author.as_str(), f.image.as_str()), ("Night & Day", "The Hosts", "https://cdn.example/show.jpg"));
        assert_eq!(f.episodes.len(), 2);
        assert_eq!((f.episodes[0].id.as_str(), f.episodes[0].title.as_str(), f.episodes[0].duration_ms), ("g2", "Ep 2: <b>Two</b>", Some(3_723_000)));
        assert_eq!(f.episodes[1].id, "http://cdn.example/1.mp3");
        assert_eq!(f.episodes[1].duration_ms, Some(2_710_000));
    }

    #[test]
    fn refuses_what_is_not_a_feed() {
        assert!(parse("<html><title>x</title></html>", "https://x").is_err());
        assert!(parse("<rss><channel></channel></rss>", "https://x").is_err());
    }

    #[test]
    fn durations_in_the_three_forms() {
        assert_eq!((duration("90"), duration("1:30"), duration("1:00:00"), duration("0")), (Some(90_000), Some(90_000), Some(3_600_000), None));
        assert_eq!(duration("1:2:3:4"), None);
        assert_eq!(duration("abc"), None);
    }

    #[tokio::test]
    async fn fetch_reads_a_feed_and_refuses_errors_and_other_schemes() {
        let mut s = mockito::Server::new_async().await;
        let ok = s.mock("GET", "/rss").match_header("user-agent", mockito::Matcher::Regex("^Legato v".into())).with_body(FEED).create_async().await;
        let gone = s.mock("GET", "/gone").with_status(404).create_async().await;
        assert_eq!(fetch(&format!("{}/rss", s.url())).await.unwrap().episodes.len(), 2);
        assert!(fetch(&format!("{}/gone", s.url())).await.unwrap_err().to_string().contains("HTTP 404"));
        assert!(fetch("ftp://x/rss").await.is_err());
        ok.assert_async().await;
        gone.assert_async().await;
    }

    #[tokio::test]
    async fn open_asks_for_a_range() {
        let mut s = mockito::Server::new_async().await;
        let m = s.mock("GET", "/a.mp3").match_header("range", "bytes=100-").with_status(206).with_header("content-range", "bytes 100-199/200").with_body(vec![0u8; 100]).create_async().await;
        let r = open(&format!("{}/a.mp3", s.url()), 100).await.unwrap();
        assert_eq!((r.status, r.content_range.as_deref()), (206, Some("bytes 100-199/200")));
        m.assert_async().await;
    }
}
