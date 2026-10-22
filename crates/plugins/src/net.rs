//! Network gateway for plugins: the app makes the request, never the plugin. HTTPS only, to a host the user approved,
//! redirects only within that host, public addresses only (no LAN, no localhost, even through DNS), no cookies, no
//! proxy, bounded size and time. The answer goes back as text.

use anyhow::{Result, anyhow, bail, ensure};
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

const MAX_BODY: usize = 2 << 20;
const MAX_SENT: usize = 1 << 20;
const TIMEOUT: Duration = Duration::from_secs(15);
/// Headers a plugin can't set (the app's own, or ones that would carry identity).
const FORBIDDEN: [&str; 7] = ["cookie", "host", "connection", "content-length", "transfer-encoding", "proxy-authorization", "origin"];

/// Host of an `https://` link, lowercase. None for anything else.
pub fn https_host(url: &str) -> Option<String> {
    let u = reqwest::Url::parse(url).ok()?;
    (u.scheme() == "https" && u.username().is_empty() && u.password().is_none()).then(|| u.host_str().map(str::to_lowercase)).flatten()
}

/// Public internet address (not this PC, the LAN, link-local, multicast, documentation ranges…).
pub fn public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => !(v.is_private() || v.is_loopback() || v.is_link_local() || v.is_broadcast() || v.is_documentation() || v.is_unspecified() || v.is_multicast() || v.octets()[0] == 100 && (v.octets()[1] & 0xC0) == 64 || v.octets()[0] == 0),
        IpAddr::V6(v) => {
            let s = v.segments();
            !(v.is_loopback() || v.is_unspecified() || v.is_multicast() || (s[0] & 0xFE00) == 0xFC00 || (s[0] & 0xFFC0) == 0xFE80 || v.to_ipv4_mapped().is_some_and(|m| !public(IpAddr::V4(m))))
        }
    }
}

/// DNS that only answers public addresses: an approved name can't be pointed at the LAN.
struct PublicOnly;

impl Resolve for PublicOnly {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let found: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0)).await?.filter(|a| public(a.ip())).collect();
            if found.is_empty() {
                return Err(format!("{host} has no public address").into());
            }
            Ok(Box::new(found.into_iter()) as Addrs)
        })
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: String,
}

pub struct Gateway {
    /// Tests only: plain http and loopback (mock servers).
    loose: bool,
}

impl Gateway {
    pub fn new() -> Self {
        Self { loose: false }
    }

    #[cfg(test)]
    fn loose() -> Self {
        Self { loose: true }
    }

    /// The request, if it stays within the rules. Permission (host approved) is checked before, in `perms::check`.
    pub async fn fetch(&self, req: &Request) -> Result<Response> {
        let url = reqwest::Url::parse(&req.url).map_err(|_| anyhow!("Bad link"))?;
        let host = url.host_str().map(str::to_lowercase).ok_or_else(|| anyhow!("Bad link"))?;
        if !self.loose {
            ensure!(https_host(&req.url).is_some(), "Only https:// links");
        }
        let method = reqwest::Method::from_bytes(req.method.as_deref().unwrap_or("GET").to_uppercase().as_bytes()).map_err(|_| anyhow!("Bad method"))?;
        ensure!(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].contains(&method.as_str()), "Bad method");
        ensure!(req.body.as_ref().is_none_or(|b| b.len() <= MAX_SENT), "Request body over 1 MB");
        ensure!(req.headers.len() <= 32, "Too many headers");
        let same_host = host.clone();
        let mut client = reqwest::Client::builder()
            .timeout(TIMEOUT)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::custom(move |a| {
                if a.previous().len() >= 5 || a.url().host_str().map(str::to_lowercase).as_deref() != Some(same_host.as_str()) {
                    a.stop()
                } else {
                    a.follow()
                }
            }))
            .user_agent("MusicApp-Plugin");
        if !self.loose {
            client = client.https_only(true).dns_resolver(Arc::new(PublicOnly));
        }
        let mut r = client.build()?.request(method, url);
        for (k, v) in &req.headers {
            if FORBIDDEN.contains(&k.to_lowercase().as_str()) || k.to_lowercase().starts_with("sec-") {
                bail!("Header not allowed: {k}");
            }
            r = r.header(k.as_str(), v.as_str());
        }
        if let Some(b) = &req.body {
            r = r.body(b.clone());
        }
        let mut resp = r.send().await?;
        let status = resp.status().as_u16();
        let content_type = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(String::from);
        let mut body = Vec::new();
        while let Some(chunk) = resp.chunk().await? {
            body.extend_from_slice(&chunk);
            ensure!(body.len() <= MAX_BODY, "Answer over 2 MB");
        }
        Ok(Response { status, content_type, body: String::from_utf8_lossy(&body).into_owned() })
    }
}

impl Default for Gateway {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_hosts_and_public_addresses() {
        assert_eq!(https_host("https://API.example.com/x?y=1").as_deref(), Some("api.example.com"));
        assert!(https_host("http://api.example.com/").is_none());
        assert!(https_host("https://user:pw@api.example.com/").is_none());
        assert!(https_host("file:///C:/x").is_none());
        for ip in ["127.0.0.1", "10.0.0.2", "192.168.1.10", "172.16.0.1", "169.254.1.1", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:192.168.0.1", "0.0.0.0"] {
            assert!(!public(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(public(ip.parse().unwrap()), "{ip}");
        }
    }

    #[tokio::test]
    async fn fetches_text_refuses_big_answers_and_bad_headers() {
        let mut server = mockito::Server::new_async().await;
        let ok = server.mock("GET", "/v1").with_header("content-type", "application/json").with_body("{\"a\":1}").create_async().await;
        let big = server.mock("GET", "/big").with_body(vec![b'x'; MAX_BODY + 10]).create_async().await;
        let g = Gateway::loose();
        let r = g.fetch(&Request { url: format!("{}/v1", server.url()), ..Request::default() }).await.unwrap();
        assert_eq!((r.status, r.body.as_str(), r.content_type.as_deref()), (200, "{\"a\":1}", Some("application/json")));
        assert!(g.fetch(&Request { url: format!("{}/big", server.url()), ..Request::default() }).await.is_err());
        let cookie = Request { url: format!("{}/v1", server.url()), headers: vec![("Cookie".into(), "x".into())], ..Request::default() };
        assert!(g.fetch(&cookie).await.is_err());
        ok.assert_async().await;
        big.assert_async().await;
        // The real gateway refuses plain http before any request.
        assert!(Gateway::new().fetch(&Request { url: format!("{}/v1", server.url()), ..Request::default() }).await.is_err());
    }
}
