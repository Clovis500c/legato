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
pub mod youtube;
pub mod ytmusic;
pub mod ytweb;

/// One HTTP client for every service: connections and TLS sessions are kept and reused. A client per call (or per
/// command: the YouTube Music handle is made for each one) opened a new TCP + TLS connection for every request.
pub(crate) fn http() -> reqwest::Client {
    static HTTP: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(reqwest::Client::new);
    HTTP.clone()
}
