//! Where the network calls of search, lyrics, SponsorBlock, the Apple lookups and pasted Deezer / Apple links go. A normal build: the real hosts, fixed when it is
//! compiled; no variable, setting or file changes them. The smoke test's build (cargo feature `e2e`, `pnpm e2e`) sends
//! those calls to one loopback server the test starts, named by `LEGATO_E2E_MOCK` (`http://127.0.0.1:<port>`, nothing
//! else is taken). Without it they go to a dead port: that build never reaches the real hosts.

/// One base URL per service.
pub struct Hosts {
    /// Normal YouTube (InnerTube).
    pub youtube: &'static str,
    /// YouTube Music's public catalog (InnerTube), signed out.
    pub ytmusic: &'static str,
    pub suggest: &'static str,
    pub itunes: &'static str,
    pub itunes_lookup: &'static str,
    pub lrclib: &'static str,
    /// SponsorBlock's segments (hash prefix of a video id, Settings › Playback › Skip non-music parts).
    pub sponsorblock: &'static str,
    /// Deezer's public API, and its short links (link.deezer.com): pasted playlist / album links.
    pub deezer: &'static str,
    pub deezer_link: &'static str,
    /// Apple Music's public pages (a pasted playlist link).
    pub apple_page: &'static str,
}

#[cfg(not(feature = "e2e"))]
pub fn get() -> &'static Hosts {
    use music_connectors::{deezer, itunes, lrclib, sponsorblock, ytmusic, ytweb};
    static REAL: Hosts = Hosts { youtube: ytweb::API, ytmusic: ytmusic::API, suggest: ytweb::SUGGEST, itunes: itunes::API, itunes_lookup: itunes::LOOKUP, lrclib: lrclib::API, sponsorblock: sponsorblock::API, deezer: deezer::API, deezer_link: deezer::LINK, apple_page: itunes::PAGE };
    &REAL
}

/// The mock server, one path per service (e2e/mock.mjs answers them).
#[cfg(feature = "e2e")]
pub fn get() -> &'static Hosts {
    static MOCK: std::sync::OnceLock<Hosts> = std::sync::OnceLock::new();
    MOCK.get_or_init(|| {
        let base = mock_base(std::env::var("LEGATO_E2E_MOCK").ok().as_deref());
        let url = |path: &str| -> &'static str { Box::leak(format!("{base}/{path}").into_boxed_str()) };
        Hosts { youtube: url("youtube"), ytmusic: url("ytmusic"), suggest: url("suggest"), itunes: url("itunes/search"), itunes_lookup: url("itunes/lookup"), lrclib: url("lrclib"), sponsorblock: url("sponsorblock"), deezer: url("deezer"), deezer_link: url("deezer-link"), apple_page: url("applepage") }
    })
}

/// The dead port: nothing listens (discard), a call to it fails at once.
const DEAD: &str = "http://127.0.0.1:9";

/// The mock server's address when `raw` is a loopback origin (`http://127.0.0.1:<port>`), else the dead port.
#[cfg_attr(not(feature = "e2e"), allow(dead_code))]
fn mock_base(raw: Option<&str>) -> String {
    let Some(raw) = raw else { return DEAD.into() };
    match raw.strip_prefix("http://127.0.0.1:") {
        Some(port) if (1..=5).contains(&port.len()) && port.bytes().all(|b| b.is_ascii_digit()) => raw.into(),
        _ => DEAD.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use music_connectors::{deezer, itunes, lrclib, sponsorblock, ytmusic, ytweb};

    #[test]
    fn a_normal_build_talks_to_the_real_hosts() {
        // `cargo test` never turns `e2e` on: this is the build everyone gets.
        if cfg!(feature = "e2e") {
            return;
        }
        let h = get();
        assert_eq!((h.youtube, h.ytmusic), (ytweb::API, ytmusic::API));
        assert_eq!((h.suggest, h.itunes, h.itunes_lookup, h.lrclib), (ytweb::SUGGEST, itunes::API, itunes::LOOKUP, lrclib::API));
        assert_eq!((h.deezer, h.deezer_link, h.apple_page, h.sponsorblock), (deezer::API, deezer::LINK, itunes::PAGE, sponsorblock::API));
        for url in [h.youtube, h.ytmusic, h.suggest, h.itunes, h.itunes_lookup, h.lrclib, h.sponsorblock, h.deezer, h.deezer_link, h.apple_page] {
            assert!(url.starts_with("https://"), "{url}");
        }
    }

    #[test]
    fn only_a_loopback_origin_is_taken_as_the_mock() {
        assert_eq!(mock_base(Some("http://127.0.0.1:41234")), "http://127.0.0.1:41234");
        for refused in [None, Some(""), Some("http://127.0.0.1"), Some("http://127.0.0.1:"), Some("http://127.0.0.1:123456"), Some("http://127.0.0.1:80/x"), Some("http://127.0.0.1:80@evil.test"), Some("http://127.0.0.1.evil.test:80"), Some("https://127.0.0.1:80"), Some("http://localhost:80"), Some("http://192.168.1.2:80"), Some("https://www.youtube.com")] {
            assert_eq!(mock_base(refused), DEAD, "{refused:?}");
        }
    }
}
