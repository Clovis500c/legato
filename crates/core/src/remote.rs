//! Phone remote (Settings › Playback, off by default): a page this PC serves on its local network, opened on a phone
//! from a QR code, to play, pause, skip, seek and see what plays. Pure part: the request read, the token and the
//! address checked, the route picked. The socket and the answers are `src-tauri/src/remote.rs`.

use std::collections::HashMap;
use std::net::IpAddr;

/// Longest request head read (request line + headers).
pub const MAX_HEAD: usize = 8 * 1024;

/// A new secret for the link: 128 random bits, hex.
pub fn new_token() -> String {
    (0..16).map(|_| format!("{:02x}", rand::random::<u8>())).collect()
}

/// Only this network's devices: private, link-local and loopback addresses.
pub fn private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_link_local() || v4.is_loopback(),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => private(IpAddr::V4(v4)),
            None => v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00 || (v6.segments()[0] & 0xffc0) == 0xfe80,
        },
    }
}

/// What the phone asked.
#[derive(Debug, PartialEq)]
pub enum Route {
    /// The remote's page.
    Page,
    /// What plays now (JSON).
    State,
    /// The song's cover.
    Cover,
    /// A media key: `toggle`, `next` or `previous` (the media keys' own names).
    Key(&'static str),
    /// Seek to this many ms.
    Seek(u64),
    /// Refused, with its HTTP status.
    No(u16),
}

/// The request line's method, path and query ("GET /state?t=…").
fn request_line(head: &str) -> Option<(&str, &str, HashMap<String, String>)> {
    let line = head.lines().next()?;
    let mut parts = line.split(' ');
    let (method, target) = (parts.next()?, parts.next()?);
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let query = query
        .split('&')
        .map(|kv| {
            // Values are hex, names and digits: nothing to decode.
            let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
            (k.to_string(), v.to_string())
        })
        .collect();
    Some((method, path, query))
}

/// Same length, every byte compared: no timing to guess the token from.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The route for a request head, `token` = the link's secret (never empty: a server runs with one).
pub fn route(head: &str, token: &str) -> Route {
    let Some((method, path, query)) = request_line(head) else { return Route::No(400) };
    if token.is_empty() || !query.get("t").is_some_and(|t| same(t, token)) {
        return Route::No(403);
    }
    match (method, path) {
        ("GET", "/") => Route::Page,
        ("GET", "/state") => Route::State,
        ("GET", "/cover") => Route::Cover,
        ("POST", "/key") => match query.get("k").map(String::as_str) {
            Some("toggle") => Route::Key("toggle"),
            Some("next") => Route::Key("next"),
            Some("previous") => Route::Key("previous"),
            _ => Route::No(400),
        },
        ("POST", "/seek") => query.get("ms").and_then(|ms| ms.parse().ok()).map_or(Route::No(400), Route::Seek),
        ("GET" | "POST", _) => Route::No(404),
        _ => Route::No(405),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn routes_only_with_the_token() {
        assert_eq!(route(&format!("GET /?t={T} HTTP/1.1\r\nHost: x\r\n\r\n"), T), Route::Page);
        assert_eq!(route(&format!("GET /state?t={T} HTTP/1.1"), T), Route::State);
        assert_eq!(route(&format!("GET /cover?x=1&t={T} HTTP/1.1"), T), Route::Cover);
        assert_eq!(route(&format!("POST /key?t={T}&k=next HTTP/1.1"), T), Route::Key("next"));
        assert_eq!(route(&format!("POST /key?t={T}&k=stop HTTP/1.1"), T), Route::No(400));
        assert_eq!(route(&format!("POST /seek?t={T}&ms=61000 HTTP/1.1"), T), Route::Seek(61000));
        assert_eq!(route(&format!("POST /seek?t={T}&ms=-1 HTTP/1.1"), T), Route::No(400));
        assert_eq!(route(&format!("GET /etc/passwd?t={T} HTTP/1.1"), T), Route::No(404));
        assert_eq!(route(&format!("DELETE /?t={T} HTTP/1.1"), T), Route::No(405));
        // No token, a wrong one, one of another length, a server without one.
        assert_eq!(route("GET / HTTP/1.1", T), Route::No(403));
        assert_eq!(route(&format!("GET /?t={} HTTP/1.1", T.replace('0', "1")), T), Route::No(403));
        assert_eq!(route("GET /?t=0123 HTTP/1.1", T), Route::No(403));
        assert_eq!(route("GET /?t= HTTP/1.1", ""), Route::No(403));
        assert_eq!(route("", T), Route::No(400));
    }

    #[test]
    fn answers_this_network_only() {
        for ip in ["192.168.1.20", "10.0.0.5", "172.20.1.1", "169.254.3.4", "127.0.0.1", "::1", "fe80::1", "fd12::3", "::ffff:192.168.1.2"] {
            assert!(private(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "172.32.0.1", "2001:db8::1", "::ffff:8.8.8.8"] {
            assert!(!private(ip.parse().unwrap()), "{ip}");
        }
        let t = new_token();
        assert_eq!(t.len(), 32);
        assert_ne!(t, new_token());
    }
}
