//! A picture or a Legato file dragged out of Discord. Discord gives a LINK to its CDN, not a file: the link is checked
//! here, the file fetched here (never by the page), its kind read from its own bytes, and only then handed on to the
//! readers a file dropped from disk goes through (they check size and format again). Nothing is decoded in this module.
//! Hosts: `cdn.discordapp.com`, `media.discordapp.net`, https only, the attachment paths, no redirect off them.
//! Since Dec 2023 these links expire (`ex`, `is`, `hm` in the query): a stale one answers 403 / 404, said once, never retried.

use anyhow::{bail, ensure, Context, Result};
use std::time::Duration;
use url::{Host, Url};

/// The only hosts a dropped link may name (exact, no subdomain, no wildcard).
pub const HOSTS: [&str; 2] = ["cdn.discordapp.com", "media.discordapp.net"];
/// A picture: a share card is a few hundred kB.
const MAX_IMAGE: usize = 5 << 20;
/// A remix file: twin of `music_dsp::lmix::MAX_BYTES` (its reader checks again).
const MAX_REMIX: usize = 64 << 10;
const TIMEOUT: Duration = Duration::from_secs(20);
const HOPS: usize = 3;

/// What a fetched file is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// PNG or JPEG: read for a share card's link, as a picture dropped from disk is.
    Image,
    /// A `.lmix` remix file.
    Remix,
}

impl Kind {
    /// The extension a file of this kind is kept under (the readers look at it).
    pub const fn ext(self, png: bool) -> &'static str {
        match self {
            Kind::Image if png => "png",
            Kind::Image => "jpg",
            Kind::Remix => "lmix",
        }
    }
}

/// The URL a drop or paste carries: its first line that is not a `#` comment (`text/uri-list`), whole, one token. Else None.
pub fn link_in(text: &str) -> Option<&str> {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with('#'))?;
    (!line.contains(char::is_whitespace) && line.len() <= 2048).then_some(line)
}

/// The link as a URL when it is a Discord attachment on the exact hosts, over https, with no user, password or port.
pub fn check(raw: &str) -> Result<Url> {
    let url = Url::parse(raw.trim()).context("That is not a link")?;
    ensure!(url.scheme() == "https", "Only https links from Discord are taken");
    ensure!(url.username().is_empty() && url.password().is_none() && url.port().is_none(), "That link is not a plain Discord link");
    ensure!(matches!(url.host(), Some(Host::Domain(d)) if HOSTS.contains(&d)), "Only links from Discord's own file servers are taken");
    ensure!(url.path().starts_with("/attachments/"), "Only a file posted in a Discord message is taken");
    Ok(url)
}

/// Bytes `kind_of` reads: a remix names its format within them. The stream waits for them (or the end) before judging.
const HEAD: usize = 160;

/// The kind of a file from its first bytes (None: not a kind we take, or too short to tell). The caller decodes nothing before this.
pub fn kind_of(head: &[u8]) -> Option<(Kind, bool)> {
    if head.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some((Kind::Image, true));
    }
    if head.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some((Kind::Image, false));
    }
    // A remix file is JSON text that names its format first (the reader checks the rest, strictly).
    let text = head.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(head);
    let start = text.iter().position(|b| !b.is_ascii_whitespace())?;
    (text[start] == b'{' && String::from_utf8_lossy(&text[..text.len().min(HEAD)]).contains("\"lmix\"")).then_some((Kind::Remix, false))
}

const fn cap(kind: Kind) -> usize {
    match kind {
        Kind::Image => MAX_IMAGE,
        Kind::Remix => MAX_REMIX,
    }
}

/// The file behind a dropped link: checked, fetched (one request, nothing sent but the request itself), cut at its kind's cap while it streams.
pub async fn fetch(raw: &str) -> Result<(Kind, bool, Vec<u8>)> {
    let url = check(raw)?;
    get(url, |u| check(u.as_str()).is_ok(), TIMEOUT).await
}

/// `fetch` after the link passed: `stays` decides which redirects are followed (the real one repeats `check`).
async fn get(url: Url, stays: fn(&Url) -> bool, timeout: Duration) -> Result<(Kind, bool, Vec<u8>)> {
    let policy = reqwest::redirect::Policy::custom(move |a| if a.previous().len() < HOPS && stays(a.url()) { a.follow() } else { a.stop() });
    // No cookies, no referer, no credentials: a plain GET under a generic name.
    let http = crate::builder().redirect(policy).timeout(timeout).user_agent("Legato").build().context("The network is not available")?;
    let mut res = http.get(url).send().await.context("Discord's file server could not be reached")?;
    let status = res.status();
    ensure!(!status.is_redirection(), "The link goes somewhere else: not taken");
    ensure!(status != 403 && status != 404 && status != 410, "This Discord link has expired: post or copy the file again");
    ensure!(status.is_success(), "Discord's file server answered {status}");
    ensure!(res.content_length().is_none_or(|n| n as usize <= MAX_IMAGE), "That file is too large");
    let mut body = Vec::new();
    let mut kind = None;
    while let Some(chunk) = res.chunk().await.context("The download was cut")? {
        body.extend_from_slice(&chunk);
        if kind.is_none() && body.len() >= HEAD {
            kind = Some(kind_of(&body).context("That is not a picture or a Legato file")?);
        }
        if let Some((k, _)) = kind {
            ensure!(body.len() <= cap(k), "That file is too large");
        } else {
            ensure!(body.len() <= MAX_IMAGE, "That file is too large");
        }
    }
    // Shorter than `HEAD`: judged on what came.
    let (k, png) = match kind {
        Some(k) => k,
        None => kind_of(&body).context("That is not a picture or a Legato file")?,
    };
    if body.is_empty() {
        bail!("That file is empty");
    }
    Ok((k, png, body))
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;

    #[test]
    fn only_the_two_hosts_over_plain_https_with_an_attachment_path() {
        for ok in ["https://cdn.discordapp.com/attachments/1/2/card.png?ex=1&is=2&hm=3", "https://media.discordapp.net/attachments/1/2/a.lmix", "https://CDN.DISCORDAPP.COM/attachments/1/2/a.png"] {
            assert!(check(ok).is_ok(), "{ok}");
        }
        for bad in [
            "http://cdn.discordapp.com/attachments/1/2/a.png",
            "https://cdn.discordapp.com.evil.test/attachments/1/2/a.png",
            "https://cdn.discordapp.com@evil.test/attachments/1/2/a.png",
            "https://evil.test@cdn.discordapp.com/attachments/1/2/a.png",
            "https://user:pw@cdn.discordapp.com/attachments/1/2/a.png",
            "https://cdn.discordapp.com:8443/attachments/1/2/a.png",
            "https://cdn.discordapp.com./attachments/1/2/a.png",
            "https://evilcdn.discordapp.com/attachments/1/2/a.png",
            "https://x.cdn.discordapp.com/attachments/1/2/a.png",
            "https://discordapp.com/attachments/1/2/a.png",
            "https://cdn.discordapp.com%2540evil.test/attachments/1/2/a.png",
            "https://cdn.discordapp.com%40evil.test/attachments/1/2/a.png",
            "https://cdn.discord\u{0430}pp.com/attachments/1/2/a.png",
            "https://xn--cdn-discordapp-xxx.com/attachments/1/2/a.png",
            "https://127.0.0.1/attachments/1/2/a.png",
            "https://[::1]/attachments/1/2/a.png",
            "https://cdn.discordapp.com/avatars/1/2.png",
            "https://cdn.discordapp.com/",
            "javascript:alert(1)",
            "file:///C:/Windows/win.ini",
            "data:image/png;base64,AAAA",
            "ftp://cdn.discordapp.com/attachments/1/2/a.png",
            "//cdn.discordapp.com/attachments/1/2/a.png",
            "",
            "not a link",
        ] {
            assert!(check(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_link_is_the_first_line_that_is_one_token() {
        assert_eq!(link_in("# a comment\r\nhttps://cdn.discordapp.com/attachments/1/2/a.png\r\n"), Some("https://cdn.discordapp.com/attachments/1/2/a.png"));
        assert_eq!(link_in("  https://x.test/a  "), Some("https://x.test/a"));
        assert_eq!(link_in("look at https://x.test/a"), None);
        assert_eq!(link_in("   \n"), None);
    }

    #[test]
    fn the_kind_comes_from_the_bytes_never_the_name() {
        assert_eq!(kind_of(b"\x89PNG\r\n\x1a\n rest"), Some((Kind::Image, true)));
        assert_eq!(kind_of(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0]), Some((Kind::Image, false)));
        assert_eq!(kind_of(b"{\n  \"format\": \"lmix\",\n  \"version\": 1}"), Some((Kind::Remix, false)));
        assert_eq!(kind_of(b"\xEF\xBB\xBF {\"format\":\"lmix\"}"), Some((Kind::Remix, false)));
        for no in [&b"MZ\x90\x00\x03\x00"[..], b"GIF89a....", b"PK\x03\x04....", b"{\"format\":\"other\"}", b"<html>", b"", b"{"] {
            assert_eq!(kind_of(no), None);
        }
    }

    fn here(u: &Url) -> bool {
        u.host_str() == Some("127.0.0.1")
    }
    fn png(n: usize) -> Vec<u8> {
        let mut v = b"\x89PNG\r\n\x1a\n".to_vec();
        v.resize(n, 7);
        v
    }
    async fn take(s: &Server, path: &str) -> Result<(Kind, bool, Vec<u8>)> {
        get(Url::parse(&format!("{}{path}", s.url())).unwrap(), here, Duration::from_secs(5)).await
    }

    #[tokio::test]
    async fn a_picture_and_a_remix_file_come_back_with_their_kind() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/a.png").with_body(png(300)).create_async().await;
        s.mock("GET", "/r").with_header("content-type", "application/octet-stream").with_body("{\"format\":\"lmix\",\"version\":1}").create_async().await;
        assert_eq!(take(&s, "/a.png").await.unwrap().0, Kind::Image);
        assert_eq!(take(&s, "/r").await.unwrap().0, Kind::Remix);
    }

    #[tokio::test]
    async fn a_remix_file_whose_first_piece_is_short_is_still_a_remix() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/slow.lmix").with_chunked_body(|w| {
            w.write_all(b"{\n    \"format\": ")?;
            w.flush()?;
            std::thread::sleep(Duration::from_millis(200));
            w.write_all(b"\"lmix\", \"version\": 1}")
        }).create_async().await;
        assert_eq!(take(&s, "/slow.lmix").await.unwrap().0, Kind::Remix);
    }

    #[tokio::test]
    async fn a_claimed_kind_does_not_count_only_the_content() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/fake.png").with_header("content-type", "image/png").with_body("MZ this is a program, not a picture").create_async().await;
        s.mock("GET", "/page").with_header("content-type", "image/png").with_body("<html>sign in</html> padding padding").create_async().await;
        assert!(take(&s, "/fake.png").await.unwrap_err().to_string().contains("not a picture"));
        assert!(take(&s, "/page").await.is_err());
    }

    #[tokio::test]
    async fn an_expired_link_is_said_once_and_other_errors_are_errors() {
        let mut s = Server::new_async().await;
        let gone = s.mock("GET", "/old").with_status(404).expect(1).create_async().await;
        s.mock("GET", "/no").with_status(403).create_async().await;
        s.mock("GET", "/boom").with_status(500).create_async().await;
        assert!(take(&s, "/old").await.unwrap_err().to_string().contains("expired"));
        assert!(take(&s, "/no").await.unwrap_err().to_string().contains("expired"));
        assert!(take(&s, "/boom").await.unwrap_err().to_string().contains("500"));
        gone.assert_async().await;
    }

    #[tokio::test]
    async fn a_redirect_off_the_hosts_is_not_followed() {
        let mut s = Server::new_async().await;
        let target = s.mock("GET", "/loot").with_body(png(100)).expect(0).create_async().await;
        // `stays` only lets 127.0.0.1 through: localhost is another name for the same server, so it is the off-host one.
        s.mock("GET", "/go").with_status(302).with_header("location", &format!("{}/loot", s.url().replace("127.0.0.1", "localhost"))).create_async().await;
        assert!(take(&s, "/go").await.unwrap_err().to_string().contains("somewhere else"));
        target.assert_async().await;
    }

    #[tokio::test]
    async fn an_oversize_body_is_stopped_while_it_streams() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/big.png").with_chunked_body(|w| {
            // Endless: only a reader that stops at the cap ever returns.
            w.write_all(b"\x89PNG\r\n\x1a\n")?;
            let piece = vec![0u8; 1 << 20];
            loop {
                w.write_all(&piece)?;
            }
        }).create_async().await;
        s.mock("GET", "/big.lmix").with_chunked_body(|w| {
            w.write_all(b"{\"format\":\"lmix\",")?;
            let piece = vec![b' '; 1 << 14];
            loop {
                w.write_all(&piece)?;
            }
        }).create_async().await;
        let got = tokio::time::timeout(Duration::from_secs(20), take(&s, "/big.png")).await.expect("stops at the cap");
        assert!(got.unwrap_err().to_string().contains("too large"));
        let got = tokio::time::timeout(Duration::from_secs(20), take(&s, "/big.lmix")).await.expect("stops at the cap");
        assert!(got.unwrap_err().to_string().contains("too large"));
    }

    #[tokio::test]
    async fn a_declared_length_over_the_cap_is_refused_before_the_body() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/huge.png").with_body(png(MAX_IMAGE + 10)).create_async().await;
        assert!(take(&s, "/huge.png").await.unwrap_err().to_string().contains("too large"));
    }

    #[tokio::test]
    async fn a_slow_server_times_out() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/slow").with_chunked_body(|w| {
            w.write_all(b"\x89PNG\r\n\x1a\n")?;
            std::thread::sleep(Duration::from_secs(3));
            w.write_all(b"late")
        }).create_async().await;
        let got = get(Url::parse(&format!("{}/slow", s.url())).unwrap(), here, Duration::from_millis(500)).await;
        assert!(got.is_err());
    }
}
