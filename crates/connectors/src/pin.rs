//! A personal server's own certificate (self-signed), trusted once the user checks its SHA-256 fingerprint at sign-in.
//! Pinned: that exact certificate for that host, still checked by rustls's own verifier (its dates, the handshake's
//! signature); only its name and its CA flag are not asked of it (the pin names the server; openssl's self-signed
//! certificates say CA:TRUE). Hosts without a pin never reach this client: the system's TLS checks them as before.

use rustls::client::WebPkiServerVerifier;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{CryptoProvider, verify_tls12_signature, verify_tls13_signature};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{CertificateError, DigitallySignedStruct, Error, RootCertStore, SignatureScheme};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex, RwLock};
use std::time::Duration;
use url::{Host, Url};

/// Host (as rustls names it: a lowercase name or an IP) → the certificate's SHA-256.
static PINS: LazyLock<RwLock<HashMap<String, [u8; 32]>>> = LazyLock::new(Default::default);

fn provider() -> Arc<CryptoProvider> {
    static P: LazyLock<Arc<CryptoProvider>> = LazyLock::new(|| Arc::new(rustls::crypto::ring::default_provider()));
    P.clone()
}

/// "AB:CD:…", as browsers and servers show it.
pub fn fingerprint(der: &[u8]) -> String {
    Sha256::digest(der).iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":")
}

fn parse(fingerprint: &str) -> Option<[u8; 32]> {
    let hex: String = fingerprint.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex.len() != 64 || fingerprint.chars().any(|c| !c.is_ascii_hexdigit() && c != ':' && c != ' ') {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

fn host_of(url: &str) -> Option<String> {
    Some(match Url::parse(url).ok()?.host()? {
        Host::Domain(d) => d.to_ascii_lowercase(),
        Host::Ipv4(ip) => ip.to_string(),
        Host::Ipv6(ip) => ip.to_string(),
    })
}

/// Pins the certificate of `address`'s host (None, or a fingerprint that isn't one: unpinned).
pub fn set(address: &str, fingerprint: Option<&str>) {
    let Some(host) = host_of(address) else { return };
    let mut pins = PINS.write().unwrap_or_else(|e| e.into_inner());
    match fingerprint.and_then(parse) {
        Some(pin) => pins.insert(host, pin),
        None => pins.remove(&host),
    };
}

/// `url`'s host has a pinned certificate (its requests go through `client()`).
pub fn pinned(url: &str) -> bool {
    host_of(url).is_some_and(|h| PINS.read().unwrap_or_else(|e| e.into_inner()).contains_key(&h))
}

fn host_name(name: &ServerName<'_>) -> Option<String> {
    match name {
        ServerName::DnsName(d) => Some(d.as_ref().to_ascii_lowercase()),
        ServerName::IpAddress(ip) => Some(std::net::IpAddr::from(*ip).to_string()),
        _ => None,
    }
}

/// The pinned certificate, through rustls's verifier with itself as the only root.
fn check(pin: Option<[u8; 32]>, cert: &CertificateDer<'_>, name: &ServerName<'_>, now: UnixTime) -> Result<ServerCertVerified, Error> {
    if pin.is_none_or(|p| p != <[u8; 32]>::from(Sha256::digest(cert))) {
        return Err(Error::InvalidCertificate(CertificateError::ApplicationVerificationFailure));
    }
    let mut roots = RootCertStore::empty();
    roots.add(cert.clone().into_owned())?;
    let verifier = WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider()).build().map_err(|e| Error::General(e.to_string()))?;
    match verifier.verify_server_cert(cert, &[], name, &[], now) {
        Ok(v) => Ok(v),
        // Checked after its dates and its chain: the pin names the server.
        Err(Error::InvalidCertificate(CertificateError::NotValidForName | CertificateError::NotValidForNameContext { .. })) => Ok(ServerCertVerified::assertion()),
        // Checked after its dates (webpki: validity, then basic constraints): a self-signed one is its own CA.
        Err(Error::InvalidCertificate(CertificateError::Other(e))) if matches!(e.0.downcast_ref::<webpki::Error>(), Some(webpki::Error::CaUsedAsEndEntity)) => Ok(ServerCertVerified::assertion()),
        Err(e) => Err(e),
    }
}

#[derive(Debug)]
struct Pinned;

impl ServerCertVerifier for Pinned {
    fn verify_server_cert(&self, cert: &CertificateDer<'_>, _: &[CertificateDer<'_>], name: &ServerName<'_>, _: &[u8], now: UnixTime) -> Result<ServerCertVerified, Error> {
        let pin = host_name(name).and_then(|h| PINS.read().unwrap_or_else(|e| e.into_inner()).get(&h).copied());
        check(pin, cert, name, now)
    }
    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, Error> {
        verify_tls12_signature(message, cert, dss, &provider().signature_verification_algorithms)
    }
    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, Error> {
        verify_tls13_signature(message, cert, dss, &provider().signature_verification_algorithms)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        provider().signature_verification_algorithms.supported_schemes()
    }
}

/// Takes the server's certificate, then ends the handshake: nothing is sent to a server not trusted yet.
#[derive(Debug)]
struct Seen(Arc<Mutex<Option<String>>>);

impl ServerCertVerifier for Seen {
    fn verify_server_cert(&self, cert: &CertificateDer<'_>, _: &[CertificateDer<'_>], _: &ServerName<'_>, _: &[u8], _: UnixTime) -> Result<ServerCertVerified, Error> {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(fingerprint(cert));
        Err(Error::InvalidCertificate(CertificateError::ApplicationVerificationFailure))
    }
    fn verify_tls12_signature(&self, _: &[u8], _: &CertificateDer<'_>, _: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, Error> {
        Err(Error::General("never reached".into()))
    }
    fn verify_tls13_signature(&self, _: &[u8], _: &CertificateDer<'_>, _: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, Error> {
        Err(Error::General("never reached".into()))
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        provider().signature_verification_algorithms.supported_schemes()
    }
}

fn config(verifier: Arc<dyn ServerCertVerifier>) -> Option<rustls::ClientConfig> {
    let config = rustls::ClientConfig::builder_with_provider(provider()).with_safe_default_protocol_versions().ok()?;
    Some(config.dangerous().with_custom_certificate_verifier(verifier).with_no_client_auth())
}

/// The fingerprint of the certificate `address` shows (sign-in, after the system refused it). None: no answer.
pub async fn probe(address: &str) -> Option<String> {
    let seen = Arc::new(Mutex::new(None));
    let client = crate::builder().use_preconfigured_tls(config(Arc::new(Seen(seen.clone())))?).connect_timeout(Duration::from_secs(10)).build().ok()?;
    let _ = client.get(address).timeout(Duration::from_secs(15)).send().await;
    seen.lock().unwrap_or_else(|e| e.into_inner()).take()
}

/// The client for pinned servers, from `servers::http`'s builder (made once there).
pub(crate) fn client(builder: reqwest::ClientBuilder) -> reqwest::Client {
    config(Arc::new(Pinned)).and_then(|c| builder.use_preconfigured_tls(c).build().ok()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rcgen::{BasicConstraints, CertificateParams, IsCa, KeyPair, date_time_ymd};

    fn cert(name: &str, ca: bool, from: i32, to: i32) -> (CertificateDer<'static>, KeyPair) {
        let key = KeyPair::generate().unwrap();
        let mut p = CertificateParams::new(vec![name.to_string()]).unwrap();
        p.not_before = date_time_ymd(from, 1, 1);
        p.not_after = date_time_ymd(to, 1, 1);
        if ca {
            p.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        }
        (p.self_signed(&key).unwrap().der().clone(), key)
    }

    fn now() -> UnixTime {
        UnixTime::now()
    }

    fn pin_of(c: &CertificateDer<'_>) -> Option<[u8; 32]> {
        parse(&fingerprint(c))
    }

    #[test]
    fn the_pinned_certificate_is_accepted() {
        let name = ServerName::try_from("nas.lan").unwrap();
        let (leaf, _) = cert("nas.lan", false, 2020, 2099);
        assert!(check(pin_of(&leaf), &leaf, &name, now()).is_ok());
        // openssl's self-signed (CA:TRUE), and one for another name (an IP typed instead): the pin names the server.
        let (ca, _) = cert("nas.lan", true, 2020, 2099);
        assert!(check(pin_of(&ca), &ca, &name, now()).is_ok());
        let (other, _) = cert("old-name.lan", false, 2020, 2099);
        assert!(check(pin_of(&other), &other, &name, now()).is_ok());
    }

    #[test]
    fn a_wrong_fingerprint_is_refused() {
        let name = ServerName::try_from("nas.lan").unwrap();
        let (leaf, _) = cert("nas.lan", false, 2020, 2099);
        let (another, _) = cert("nas.lan", false, 2020, 2099);
        assert!(check(pin_of(&another), &leaf, &name, now()).is_err());
    }

    #[test]
    fn an_expired_certificate_is_refused_even_pinned() {
        let name = ServerName::try_from("nas.lan").unwrap();
        for ca in [false, true] {
            let (old, _) = cert("nas.lan", ca, 2019, 2021);
            assert!(matches!(check(pin_of(&old), &old, &name, now()), Err(Error::InvalidCertificate(CertificateError::ExpiredContext { .. }))), "ca {ca}");
            let (early, _) = cert("nas.lan", ca, 2098, 2099);
            assert!(check(pin_of(&early), &early, &name, now()).is_err(), "ca {ca}");
        }
    }

    #[test]
    fn an_unpinned_self_signed_certificate_is_refused() {
        let (leaf, _) = cert("lonely.lan", false, 2020, 2099);
        assert!(check(None, &leaf, &ServerName::try_from("lonely.lan").unwrap(), now()).is_err());
        // Pinned for another host: not for this one.
        set("https://other.lan:4533", Some(&fingerprint(&leaf)));
        assert!(Pinned.verify_server_cert(&leaf, &[], &ServerName::try_from("lonely.lan").unwrap(), &[], now()).is_err());
        assert!(Pinned.verify_server_cert(&leaf, &[], &ServerName::try_from("other.lan").unwrap(), &[], now()).is_ok());
        set("https://other.lan:4533", None);
        assert!(!pinned("https://other.lan/rest/ping.view"));
    }

    /// A TLS server on this PC answering "ok" to every request, with `cert`.
    async fn serve(cert: CertificateDer<'static>, key: KeyPair) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let key = rustls::pki_types::PrivateKeyDer::Pkcs8(key.serialize_der().into());
        let config = rustls::ServerConfig::builder_with_provider(provider()).with_safe_default_protocol_versions().unwrap().with_no_client_auth().with_single_cert(vec![cert], key).unwrap();
        let tls = tokio_rustls::TlsAcceptor::from(Arc::new(config));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((tcp, _)) = listener.accept().await {
                let tls = tls.clone();
                tokio::spawn(async move {
                    let Ok(mut s) = tls.accept(tcp).await else { return };
                    let mut buf = [0u8; 4096];
                    let _ = s.read(&mut buf).await;
                    let _ = s.write_all(b"HTTP/1.1 200 OK
content-length: 2
connection: close

ok").await;
                    let _ = s.shutdown().await;
                });
            }
        });
        format!("https://127.0.0.1:{port}/")
    }

    #[tokio::test]
    async fn a_real_handshake_with_the_pinned_certificate_only() {
        let (cert, key) = cert("127.0.0.1", true, 2020, 2099);
        let fp = fingerprint(&cert);
        let url = serve(cert, key).await;
        let get = || async { crate::servers::http(&url).get(&url).send().await.ok().map(|r| r.status().as_u16()) };
        // The system's TLS (unpinned) refuses it; the probe reads its fingerprint.
        assert_eq!(get().await, None);
        assert_eq!(probe(&url).await.as_deref(), Some(fp.as_str()));
        set(&url, Some(&fingerprint(b"another certificate")));
        assert_eq!(get().await, None);
        set(&url, Some(&fp));
        assert_eq!(get().await, Some(200));
        set(&url, None);
    }

    #[test]
    fn fingerprints_read_as_servers_show_them() {
        let fp = fingerprint(b"x");
        assert_eq!(fp.len(), 95);
        assert_eq!(parse(&fp), parse(&fp.replace(':', "").to_lowercase()));
        assert!(parse("AB:CD").is_none() && parse(&format!("{fp}Z")).is_none());
        // A host of its own: the pins are one table for every test running at once (the handshake tests use ::1).
        set("https://fingerprint-test.lan:8096", Some(&fp));
        assert!(pinned("https://fingerprint-test.lan:8096/System/Info/Public") && !pinned("https://unpinned-host.lan:8096/"));
        set("https://fingerprint-test.lan:8096", None);
    }
}
