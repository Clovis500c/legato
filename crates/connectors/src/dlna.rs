//! DLNA / UPnP speakers and TVs on the local network (MediaRenderers): found by SSDP (a multicast M-SEARCH, answers read
//! for their `LOCATION`), described by their device XML (name, the AVTransport control URL), and driven by SOAP calls
//! (`SetAVTransportURI`, `Play`, `Pause`, `Stop`, `Seek`). Local network only: a description or control URL that is not
//! a private address is never fetched, whatever an answer claims. Nothing here serves a file: the renderer is handed the
//! address of this PC's own file server (the caller's, private address only) and pulls the song from it.

use anyhow::{Result, bail};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;
use tokio::net::UdpSocket;
use url::Url;

/// SSDP's multicast group and port.
pub const SSDP: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(239, 255, 255, 250)), 1900);
const RENDERER: &str = "urn:schemas-upnp-org:device:MediaRenderer:1";
const AV: &str = "urn:schemas-upnp-org:service:AVTransport:1";
const TIMEOUT: Duration = Duration::from_secs(5);

/// The search every renderer answers (MX 2: they spread their answers over two seconds).
pub fn m_search() -> String {
    format!("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: {RENDERER}\r\n\r\n")
}

/// A renderer's answer to the search: where its description is.
#[derive(Debug, Clone, PartialEq)]
pub struct Found {
    pub location: Url,
    pub usn: String,
}

/// A host on this network (private, link-local or loopback address, never a name or a public address).
pub fn local(u: &Url) -> bool {
    u.scheme() == "http"
        && u.host_str().and_then(|h| h.parse::<IpAddr>().ok()).is_some_and(|ip| match ip {
            IpAddr::V4(v) => v.is_private() || v.is_link_local() || v.is_loopback(),
            IpAddr::V6(v) => v.is_loopback(),
        })
}

/// An SSDP answer (HTTP-shaped text) → the renderer it announces; None for anything else or an address off this network.
pub fn parse_found(reply: &str) -> Option<Found> {
    let header = |name: &str| reply.lines().find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case(name)).map(|(_, v)| v.trim().to_string()));
    if !header("st").is_some_and(|st| st.contains("MediaRenderer")) {
        return None;
    }
    // Loopback is this PC: never what a device on the network announces.
    let location = Url::parse(&header("location")?).ok().filter(|u| local(u) && !u.host_str().is_some_and(|h| h.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())))?;
    Some(Found { location, usn: header("usn").unwrap_or_default() })
}

/// Sends the search to `group` and collects the answers for `wait` (duplicates by description address dropped).
pub async fn discover(group: SocketAddr, wait: Duration) -> Result<Vec<Found>> {
    let sock = UdpSocket::bind(("0.0.0.0", 0)).await?;
    sock.send_to(m_search().as_bytes(), group).await?;
    let mut out: Vec<Found> = Vec::new();
    let mut buf = [0u8; 2048];
    let end = tokio::time::Instant::now() + wait;
    while let Ok(Ok((n, _))) = tokio::time::timeout_at(end, sock.recv_from(&mut buf)).await {
        if let Some(f) = parse_found(&String::from_utf8_lossy(&buf[..n]))
            && !out.iter().any(|o| o.location == f.location)
        {
            out.push(f);
        }
        if out.len() >= 32 {
            break;
        }
    }
    Ok(out)
}

/// The text between `<name>` and `</name>` (first one, XML-unescaped); tags with a namespace prefix are not handled.
fn inner(xml: &str, name: &str) -> Option<String> {
    let open = format!("<{name}>");
    let start = xml.find(&open)? + open.len();
    let end = start + xml[start..].find(&format!("</{name}>"))?;
    Some(unescape(xml[start..end].trim()))
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

/// What is known of a renderer once its description is read.
#[derive(Debug, Clone, PartialEq)]
pub struct Renderer {
    pub name: String,
    pub control: Url,
}

/// A device description → its name and AVTransport control URL (resolved against `base`, and it must stay on this
/// network). None when it has no AVTransport service.
pub fn parse_description(base: &Url, xml: &str) -> Option<Renderer> {
    let name = inner(xml, "friendlyName").filter(|n| !n.is_empty())?;
    let mut rest = xml;
    while let Some(i) = rest.find("<service>") {
        let block = &rest[i..];
        let end = block.find("</service>")?;
        let service = &block[..end];
        if inner(service, "serviceType").is_some_and(|t| t.contains("AVTransport")) {
            // A renderer is driven on itself: a control URL on another host is refused.
            let control = base.join(&inner(service, "controlURL")?).ok().filter(|c| local(c) && c.host() == base.host())?;
            return Some(Renderer { name: name.chars().take(80).collect(), control });
        }
        rest = &block[end..];
    }
    None
}

/// A SOAP envelope for an AVTransport action with its arguments in order (InstanceID is always 0).
fn envelope(action: &str, args: &[(&str, &str)]) -> String {
    let body: String = args.iter().map(|(k, v)| format!("<{k}>{}</{k}>", escape(v))).collect();
    format!("<?xml version=\"1.0\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:{action} xmlns:u=\"{AV}\"><InstanceID>0</InstanceID>{body}</u:{action}></s:Body></s:Envelope>")
}

/// The minimal DIDL-Lite a renderer wants beside a song's address.
pub fn didl(title: &str, uri: &str, mime: &str) -> String {
    format!(
        "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\"><item id=\"0\" parentID=\"0\" restricted=\"1\"><dc:title>{}</dc:title><upnp:class>object.item.audioItem.musicTrack</upnp:class><res protocolInfo=\"http-get:*:{}:*\">{}</res></item></DIDL-Lite>",
        escape(title),
        escape(mime),
        escape(uri)
    )
}

/// `ms` as the renderer's relative time, H:MM:SS.
pub fn clock(ms: u64) -> String {
    let s = ms / 1000;
    format!("{}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60)
}

/// No redirect is followed: one could lead off this network.
fn client() -> reqwest::Client {
    static C: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| crate::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap_or_default());
    C.clone()
}

impl Renderer {
    /// Reads a description from `location` (a private address only) → the renderer.
    pub async fn open(location: &Url) -> Result<Self> {
        if !local(location) {
            bail!("Not an address on this network");
        }
        let res = client().get(location.clone()).timeout(TIMEOUT).send().await?.error_for_status()?;
        let xml = crate::linklist::capped_text(res).await?;
        parse_description(location, &xml).ok_or_else(|| anyhow::anyhow!("This device cannot play from the network"))
    }

    async fn call(&self, action: &str, args: &[(&str, &str)]) -> Result<()> {
        let r = client()
            .post(self.control.clone())
            .header("content-type", "text/xml; charset=\"utf-8\"")
            .header("soapaction", format!("\"{AV}#{action}\""))
            .body(envelope(action, args))
            .timeout(TIMEOUT)
            .send()
            .await?;
        if !r.status().is_success() {
            bail!("{} refused {action} ({})", self.name, r.status());
        }
        Ok(())
    }

    /// Hands it a song's address (this PC's own file server) and starts it.
    pub async fn play_uri(&self, uri: &str, title: &str, mime: &str) -> Result<()> {
        if !local(&Url::parse(uri)?) {
            bail!("A song is only handed out from an address on this network");
        }
        self.call("SetAVTransportURI", &[("CurrentURI", uri), ("CurrentURIMetaData", &didl(title, uri, mime))]).await?;
        self.call("Play", &[("Speed", "1")]).await
    }

    pub async fn play(&self) -> Result<()> {
        self.call("Play", &[("Speed", "1")]).await
    }

    pub async fn pause(&self) -> Result<()> {
        self.call("Pause", &[]).await
    }

    pub async fn stop(&self) -> Result<()> {
        self.call("Stop", &[]).await
    }

    pub async fn seek(&self, ms: u64) -> Result<()> {
        self.call("Seek", &[("Unit", "REL_TIME"), ("Target", &clock(ms))]).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};

    const REPLY: &str = "HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nLOCATION: http://192.168.1.20:49152/desc.xml\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\nUSN: uuid:abc::urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n";

    const DESC: &str = r#"<?xml version="1.0"?><root><device><friendlyName>Living room &amp; kitchen</friendlyName><serviceList><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/rc/ctl</controlURL></service><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/av/ctl</controlURL></service></serviceList></device></root>"#;

    #[test]
    fn an_answer_is_read_and_only_this_network_counts() {
        let f = parse_found(REPLY).unwrap();
        assert_eq!(f.location.as_str(), "http://192.168.1.20:49152/desc.xml");
        assert!(f.usn.starts_with("uuid:abc"));
        assert!(parse_found(&REPLY.replace("192.168.1.20", "8.8.8.8")).is_none(), "a public address is never fetched");
        assert!(parse_found(&REPLY.replace("192.168.1.20", "router.example")).is_none(), "nor a name");
        assert!(parse_found(&REPLY.replace("MediaRenderer", "MediaServer")).is_none());
        assert!(parse_found(&REPLY.replace("http://", "https://")).is_none());
        assert!(parse_found(&REPLY.replace("192.168.1.20", "127.0.0.1")).is_none(), "nor this PC");
        assert!(parse_found("garbage").is_none());
        assert!(m_search().contains("ssdp:discover") && m_search().ends_with("\r\n\r\n"));
    }

    #[test]
    fn a_description_gives_a_name_and_the_av_transport_control_url() {
        let base = Url::parse("http://192.168.1.20:49152/desc.xml").unwrap();
        let r = parse_description(&base, DESC).unwrap();
        assert_eq!(r.name, "Living room & kitchen");
        assert_eq!(r.control.as_str(), "http://192.168.1.20:49152/av/ctl");
        assert!(parse_description(&base, &DESC.replace("AVTransport", "Other")).is_none());
        // A control URL pointing off this network is refused.
        assert!(parse_description(&base, &DESC.replace("/av/ctl", "http://203.0.113.5/ctl")).is_none());
        // Nor one on another device of this network.
        assert!(parse_description(&base, &DESC.replace("/av/ctl", "http://192.168.1.99/ctl")).is_none());
        assert_eq!(clock(3_725_000), "1:02:05");
        assert!(didl("A & B", "http://192.168.1.2/a.mp3", "audio/mpeg").contains("A &amp; B"));
    }

    #[tokio::test]
    async fn a_song_is_handed_over_and_started_then_sought() {
        let mut s = Server::new_async().await;
        let desc = s.mock("GET", "/desc.xml").with_body(DESC).create_async().await;
        let act = |name: &str| format!("\"urn:schemas-upnp-org:service:AVTransport:1#{name}\"");
        let set = s.mock("POST", "/av/ctl").match_header("soapaction", act("SetAVTransportURI").as_str()).match_body(Matcher::Regex("<CurrentURI>http://192.168.1.2/a.mp3</CurrentURI>".into())).with_body("<ok/>").expect(1).create_async().await;
        let play = s.mock("POST", "/av/ctl").match_header("soapaction", act("Play").as_str()).with_body("<ok/>").expect(2).create_async().await;
        let seek = s.mock("POST", "/av/ctl").match_header("soapaction", act("Seek").as_str()).match_body(Matcher::Regex("<Target>0:01:05</Target>".into())).with_body("<ok/>").expect(1).create_async().await;
        let stop = s.mock("POST", "/av/ctl").match_header("soapaction", act("Stop").as_str()).with_status(500).expect(1).create_async().await;
        let r = Renderer::open(&Url::parse(&format!("{}/desc.xml", s.url())).unwrap()).await.unwrap();
        assert_eq!(r.control.path(), "/av/ctl");
        r.play_uri("http://192.168.1.2/a.mp3", "Song", "audio/mpeg").await.unwrap();
        r.seek(65_000).await.unwrap();
        r.play().await.unwrap();
        assert!(r.stop().await.unwrap_err().to_string().contains("refused Stop"));
        assert!(r.play_uri("http://example.com/a.mp3", "x", "audio/mpeg").await.is_err(), "no public address is handed out");
        for m in [desc, set, play, seek, stop] {
            m.assert_async().await;
        }
    }

    #[tokio::test]
    async fn a_description_that_redirects_is_not_followed() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/desc.xml").with_status(302).with_header("location", "/moved.xml").create_async().await;
        let moved = s.mock("GET", "/moved.xml").with_body(DESC).expect(0).create_async().await;
        assert!(Renderer::open(&Url::parse(&format!("{}/desc.xml", s.url())).unwrap()).await.is_err());
        moved.assert_async().await;
    }

    #[tokio::test]
    async fn the_search_collects_answers_from_a_group_once_each() {
        let responder = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let addr = responder.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let mut buf = [0u8; 512];
            let (n, from) = responder.recv_from(&mut buf).await.unwrap();
            assert!(String::from_utf8_lossy(&buf[..n]).starts_with("M-SEARCH"));
            for reply in [REPLY, REPLY, "NOTIFY junk"] {
                responder.send_to(reply.as_bytes(), from).await.unwrap();
            }
        });
        let found = discover(addr, Duration::from_millis(400)).await.unwrap();
        task.await.unwrap();
        assert_eq!(found.len(), 1);
    }
}
