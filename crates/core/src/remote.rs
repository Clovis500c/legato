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
    /// The streaming overlay's page (OBS's Browser Source on this PC).
    Overlay,
    /// The overlay's visualizer: its bars' levels as a stream of server-sent events.
    Frames,
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
        ("GET", "/overlay") => Route::Overlay,
        ("GET", "/frames") => Route::Frames,
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

/// Who may ask what: the phone remote's routes while it's on; the overlay's (its page, what plays, the cover) from this PC
/// while the overlay is on. The server runs for either; on this PC only (127.0.0.1) for the overlay alone.
pub fn allowed(route: &Route, phone: bool, overlay: bool, this_pc: bool) -> bool {
    match route {
        Route::No(_) => true,
        Route::Overlay | Route::Frames => overlay && this_pc,
        Route::State | Route::Cover => phone || (overlay && this_pc),
        Route::Page | Route::Key(_) | Route::Seek(_) => phone,
    }
}

/// Bars a frame of the overlay's visualizer carries at most.
pub const MAX_BARS: usize = 64;

/// One frame of the overlay's visualizer as a server-sent event: its bars' levels (0 to 255) in hex, two digits each.
pub fn frame_event(levels: &[u8]) -> String {
    let mut out = String::with_capacity(8 + 2 * levels.len().min(MAX_BARS));
    out.push_str("data: ");
    for b in levels.iter().take(MAX_BARS) {
        out.push_str(&format!("{b:02x}"));
    }
    out.push_str("\n\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_overlay_answers_this_pc_only() {
        assert_eq!(route(&format!("GET /overlay?t={T} HTTP/1.1"), T), Route::Overlay);
        assert!(allowed(&Route::Overlay, false, true, true));
        assert!(!allowed(&Route::Overlay, true, true, false));
        assert!(!allowed(&Route::Overlay, true, false, true));
        assert!(allowed(&Route::State, false, true, true));
        assert!(!allowed(&Route::State, false, true, false));
        // The overlay alone never drives playback.
        assert!(!allowed(&Route::Key("next"), false, true, true));
        assert!(!allowed(&Route::Page, false, true, true));
        assert!(allowed(&Route::Seek(1), true, false, false));
    }

    #[test]
    fn the_overlay_visualizer_streams_to_this_pc_only() {
        assert_eq!(route(&format!("GET /frames?t={T} HTTP/1.1"), T), Route::Frames);
        assert_eq!(route("GET /frames?t=nope HTTP/1.1", T), Route::No(403));
        assert!(allowed(&Route::Frames, false, true, true));
        assert!(!allowed(&Route::Frames, true, true, false));
        assert!(!allowed(&Route::Frames, true, false, true));
        assert_eq!(frame_event(&[0, 15, 255]), "data: 000fff\n\n");
        assert_eq!(frame_event(&[1; 80]).len(), 8 + 2 * MAX_BARS);
    }

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
