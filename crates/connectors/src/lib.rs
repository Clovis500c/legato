pub mod art;
pub mod audd;
pub mod deezer;
pub mod discord;
pub mod itunes;
pub mod lastfm;
pub mod linklist;
pub mod lrclib;
pub mod nearby;
pub mod oauth;
pub mod spotify;
pub mod spotify_embed;
pub mod spotify_page;
pub mod sponsorblock;
pub mod youtube;
pub mod ytmusic;
pub mod ytweb;

/// Google's answer to too many searches from one address (its "Sorry…" page, or a 429): says nothing about the song.
pub fn refused(error: &str) -> bool {
    error.contains("429 Too Many Requests") || (error.contains("403 Forbidden") && error.contains("Sorry"))
}

/// One HTTP client for every service: connections and TLS sessions are kept and reused. A client per call (or per
/// command: the YouTube Music handle is made for each one) opened a new TCP + TLS connection for every request.
pub(crate) fn http() -> reqwest::Client {
    static HTTP: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(reqwest::Client::new);
    HTTP.clone()
}

#[cfg(test)]
mod tests {
    use super::refused;

    #[test]
    fn knows_too_many_searches_from_other_failures() {
        assert!(refused("YouTube Music search → 403 Forbidden <html><head><title>Sorry...</title>"));
        assert!(refused("YouTube search → 429 Too Many Requests "));
        assert!(!refused("YouTube Music search → 403 Forbidden {\"error\":{\"message\":\"expired\"}}"));
        assert!(!refused("YouTube Music search → 500 Internal Server Error"));
        assert!(!refused("error sending request"));
    }
}
