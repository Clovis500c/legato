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
    numeric(&raw.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'")).replace("&amp;", "&").trim().to_string()
}

/// `&#8217;`, `&#x27;` → the character (feeds write titles so). Anything else stays as written.
fn numeric(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find("&#") {
        out.push_str(&rest[..i]);
        let after = &rest[i + 2..];
        let end = after.find(';').filter(|&e| e <= 8);
        let c = end.and_then(|e| {
            let n = &after[..e];
            let code = match n.strip_prefix(['x', 'X']) {
                Some(h) => u32::from_str_radix(h, 16).ok(),
                None => n.parse().ok(),
            };
            code.and_then(char::from_u32)
        });
        match (c, end) {
            (Some(c), Some(e)) => {
                out.push(c);
                rest = &after[e + 1..];
            }
            _ => {
                out.push_str("&#");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// A host on this network (a private, loopback or `.local` address: `music_core::server::private_host`).
fn on_this_network(address: &str) -> bool {
    url::Url::parse(address).ok().and_then(|u| u.host_str().map(|h| music_core::server::private_host(h.trim_matches(['[', ']'])))).unwrap_or(false)
}

/// The client for `url`: a public address is never redirected onto this network (a feed from the web can't make the app
/// ask the router or this PC). A feed on this network (the user's own server) goes where it says.
fn client_for(url: &str) -> reqwest::Client {
    static PUBLIC: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
        crate::builder()
            .redirect(reqwest::redirect::Policy::custom(|a| {
                if a.previous().len() >= 10 {
                    a.error("too many redirects")
                } else if on_this_network(a.url().as_str()) {
                    a.error("a public address sent us onto this network")
                } else {
                    a.follow()
                }
            }))
            .build()
            .unwrap_or_default()
    });
    if on_this_network(url) { crate::http() } else { PUBLIC.clone() }
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
    (n <= 3 && secs > 0).then(|| secs.checked_mul(1000)).flatten()
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
    // shortcut: a public name that resolves to a private address isn't caught (DNS rebinding), only addresses written out.
    let lan_feed = on_this_network(url);
    let mut episodes = Vec::new();
    for item in xml[first..].split("<item").skip(1) {
        let item = item.split("</item>").next().unwrap_or(item);
        let Some(audio) = attr(item, "enclosure", "url").and_then(|u| http_url(&u)).filter(|a| lan_feed || !on_this_network(a)) else { continue };
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

/// The shows of an OPML file (what podcast apps export): every `<outline>` with an `xmlUrl`, as feeds with no episodes.
pub fn opml(xml: &str) -> Vec<Feed> {
    let mut out: Vec<Feed> = Vec::new();
    for o in xml.split("<outline").skip(1) {
        let o = format!("<outline{}>", o.split('>').next().unwrap_or_default());
        let Some(url) = attr(&o, "outline", "xmlUrl").and_then(|u| http_url(&u)) else { continue };
        let title = attr(&o, "outline", "title").or_else(|| attr(&o, "outline", "text")).filter(|t| !t.is_empty()).unwrap_or_else(|| url.clone());
        if !out.iter().any(|f| f.url == url) {
            out.push(Feed { url, title: title.chars().take(300).collect(), author: String::new(), image: String::new(), episodes: Vec::new() });
        }
    }
    out
}

/// Reads the feed at `address` (http or https, 8 MB at most).
pub async fn fetch(address: &str) -> Result<Feed> {
    let url = http_url(address).ok_or_else(|| anyhow!("Type a podcast feed's address (http or https)"))?;
    let mut res = client_for(&url).get(&url).header(reqwest::header::USER_AGENT, AGENT).timeout(TIMEOUT).send().await.map_err(|_| anyhow!("That podcast feed doesn't answer"))?;
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
    let res = client_for(&url).get(url).header(reqwest::header::USER_AGENT, AGENT).header(reqwest::header::RANGE, format!("bytes={from}-")).send().await.map_err(|_| anyhow!("This episode's server doesn't answer"))?;
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
    fn a_public_feed_never_points_the_app_onto_this_network() {
        let lan = r#"<rss><channel><title>S</title>
          <item><title>a</title><enclosure url="http://192.168.1.1/admin"/></item>
          <item><title>b</title><enclosure url="http://127.0.0.1:8080/x.mp3"/></item>
          <item><title>c</title><enclosure url="http://nas.local/x.mp3"/></item>
          <item><title>d</title><enclosure url="http://[::1]/x.mp3"/></item>
          <item><title>e</title><enclosure url="http://2130706433/x.mp3"/></item>
          <item><title>ok</title><enclosure url="https://cdn.example/x.mp3"/></item></channel></rss>"#;
        assert_eq!(parse(lan, "https://feed.example/rss").unwrap().episodes.iter().map(|e| e.title.as_str()).collect::<Vec<_>>(), ["ok"]);
        // The user's own server: its episodes stay.
        assert_eq!(parse(lan, "http://192.168.1.5/rss").unwrap().episodes.len(), 6);
    }

    #[tokio::test]
    async fn a_public_address_redirected_onto_this_network_is_refused() {
        // The mock is on 127.0.0.1: asked through the public client, a redirect to it is refused.
        let mut s = mockito::Server::new_async().await;
        let _x = s.mock("GET", "/x").with_status(200).create_async().await;
        assert!(on_this_network(&s.url()));
        let hop = s.mock("GET", "/hop").with_status(302).with_header("location", &format!("{}/x", s.url())).create_async().await;
        let err = client_for("https://feed.example/rss").get(format!("{}/hop", s.url())).send().await.unwrap_err();
        assert!(err.is_redirect(), "{err}");
        hop.assert_async().await;
        // The user's own server follows its redirects.
        assert_eq!(client_for(&s.url()).get(format!("{}/hop", s.url())).send().await.unwrap().status(), 200);
    }

    #[test]
    fn numeric_entities_and_huge_durations() {
        assert_eq!(text("Don&#8217;t &#x27;stop&#39; &amp;#38; &#bad; &#"), "Don’t 'stop' &#38; &#bad; &#");
        assert_eq!(duration("18446744073709552"), None);
    }

    #[test]
    fn an_opml_file_gives_its_feeds_once_each() {
        let x = r#"<opml><body><outline text="Shows"><outline type="rss" text="A &amp; B" xmlUrl="https://a.example/rss"/>
          <outline text="C" title="Cee" xmlUrl="http://c.example/feed"/><outline text="dup" xmlUrl="https://a.example/rss"/>
          <outline text="bad" xmlUrl="ftp://x/y"/></outline></body></opml>"#;
        let f = opml(x);
        assert_eq!(f.iter().map(|f| (f.title.as_str(), f.url.as_str())).collect::<Vec<_>>(), [("A & B", "https://a.example/rss"), ("Cee", "http://c.example/feed")]);
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
