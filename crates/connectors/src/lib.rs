pub mod apk;
pub mod apple_page;
pub mod art;
pub mod audd;
pub mod deezer;
pub mod devices;
pub mod discord;
pub mod itunes;
pub mod lastfm;
pub mod linklist;
pub mod listenbrainz;
pub mod lrclib;
pub mod nearby;
pub mod oauth;
pub mod rooms;
pub mod soundcloud;
pub mod spotify;
pub mod spotify_embed;
pub mod spotify_page;
pub mod sponsorblock;
pub mod youtube;
pub mod ytmusic;
pub mod ytweb;

pub use music_core::searchpace::refused;

/// One HTTP client for every service: connections and TLS sessions are kept and reused. A client per call (or per
/// command: the YouTube Music handle is made for each one) opened a new TCP + TLS connection for every request.
pub(crate) fn http() -> reqwest::Client {
    static HTTP: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| builder().build().unwrap_or_default());
    HTTP.clone()
}

/// A client builder with what every client gets: `Noted`, and Android's TLS.
pub(crate) fn builder() -> reqwest::ClientBuilder {
    tls(reqwest::Client::builder().dns_resolver(Noted))
}

/// Android has no OpenSSL to link: rustls with ring and Mozilla's roots (webpki-roots); elsewhere the system's TLS.
/// Twins in `music-plugins` (net.rs) and `music-shield`.
#[cfg(target_os = "android")]
pub(crate) fn tls(b: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .expect("ring: TLS 1.2 and 1.3")
        .with_root_certificates(roots)
        .with_no_client_auth();
    b.use_preconfigured_tls(config)
}

#[cfg(not(target_os = "android"))]
pub(crate) fn tls(b: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    b
}

/// The system's resolver, like reqwest's own, noting each host it's asked for (Settings › Privacy, `music_core::netlog`):
/// every client the app builds gets it. Once per connection: a kept one carries many requests.
pub struct Noted;

impl reqwest::dns::Resolve for Noted {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_owned();
        music_core::netlog::note(&host, music_core::netlog::Via::App, false);
        Box::pin(async move {
            let addrs: Vec<std::net::SocketAddr> = tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
            Ok(Box::new(addrs.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

#[cfg(test)]
mod tests {
    use reqwest::dns::Resolve;

    #[tokio::test]
    async fn noted_resolves_like_the_system() {
        let addrs: Vec<_> = super::Noted.resolve("localhost".parse().unwrap()).await.unwrap().collect();
        assert!(addrs.iter().any(|a| a.ip().is_loopback()));
        // Through a client: the port is the URL's, not the resolver's 0.
        let mut s = mockito::Server::new_async().await;
        s.mock("GET", "/").with_body("hi").create_async().await;
        let url = format!("http://localhost:{}/", s.socket_address().port());
        assert_eq!(super::http().get(url).send().await.unwrap().text().await.unwrap(), "hi");
    }
}
