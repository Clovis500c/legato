//! Last.fm scrobbling (API 2.0, docs checked 2026-10-23): the user's own API key and shared secret (free,
//! non-commercial), web auth through a loopback callback, a session key that doesn't expire (kept in the keychain).
//! Calls are signed: md5 of the parameters sorted by name, name then value, then the secret (`format` left out).

use anyhow::{Context, Result, anyhow};
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::Duration;
use url::Url;

pub const API: &str = "https://ws.audioscrobbler.com/2.0/";
pub const AUTH: &str = "https://www.last.fm/api/auth/";
/// Last.fm takes at most this many scrobbles per call.
pub const BATCH: usize = 50;

/// One listen to send. `timestamp` = when it started (unix s, UTC).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scrobble {
    pub artist: String,
    pub track: String,
    pub album: Option<String>,
    pub duration_s: Option<u32>,
    pub timestamp: i64,
}

impl Scrobble {
    /// Last.fm's rule: longer than 30 s, heard for half of it or 4 minutes.
    pub fn counts(duration_ms: Option<u32>, listened_ms: u64) -> bool {
        match duration_ms {
            Some(d) => d > 30_000 && listened_ms >= (u64::from(d) / 2).min(240_000),
            None => listened_ms >= 240_000,
        }
    }
}

/// Signature of a call: every parameter but `format`, sorted by name (ASCII), name + value, then the secret.
pub fn sign(params: &BTreeMap<String, String>, secret: &str) -> String {
    let mut h = Md5::new();
    for (k, v) in params.iter().filter(|(k, _)| k.as_str() != "format") {
        h.update(k.as_bytes());
        h.update(v.as_bytes());
    }
    h.update(secret.as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Deserialize)]
struct Failure {
    error: u32,
    message: String,
}

/// Invalid session key (revoked on last.fm): sign in again.
pub const INVALID_SESSION: u32 = 9;

#[derive(Debug)]
pub struct LastFmError {
    pub code: u32,
    pub message: String,
}
impl std::fmt::Display for LastFmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Last.fm: {} ({})", self.message, self.code)
    }
}
impl std::error::Error for LastFmError {}

pub struct LastFm {
    api: String,
    auth: String,
    key: String,
    secret: String,
}

impl LastFm {
    pub fn new(key: &str, secret: &str) -> Self {
        Self::with_urls(API, AUTH, key, secret)
    }

    pub fn with_urls(api: &str, auth: &str, key: &str, secret: &str) -> Self {
        Self { api: api.into(), auth: auth.into(), key: key.trim().into(), secret: secret.trim().into() }
    }

    /// Trust boundary: Last.fm keys and secrets are 32 hex characters.
    pub fn valid_key(s: &str) -> bool {
        s.trim().len() == 32 && s.trim().bytes().all(|b| b.is_ascii_hexdigit())
    }

    async fn call(&self, method: &str, mut params: BTreeMap<String, String>) -> Result<serde_json::Value> {
        params.insert("method".into(), method.into());
        params.insert("api_key".into(), self.key.clone());
        let sig = sign(&params, &self.secret);
        params.insert("api_sig".into(), sig);
        params.insert("format".into(), "json".into());
        // Form body by hand (reqwest built without its form feature).
        let form = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(&params).finish();
        let res = crate::http()
            .post(&self.api)
            .header("content-type", "application/x-www-form-urlencoded; charset=utf-8")
            .body(form)
            .timeout(Duration::from_secs(15))
            .send()
            .await?;
        let body: serde_json::Value = res.json().await.context("Last.fm sent no JSON")?;
        if let Ok(f) = serde_json::from_value::<Failure>(body.clone()) {
            return Err(LastFmError { code: f.error, message: f.message }.into());
        }
        Ok(body)
    }

    /// Browser page where the user allows the app; Last.fm comes back to `callback` with `token`.
    pub fn auth_url(&self, callback: &str) -> Result<String> {
        Ok(Url::parse_with_params(&self.auth, &[("api_key", self.key.as_str()), ("cb", callback)])?.into())
    }

    /// Token from the callback → (session key, user name).
    pub async fn session(&self, token: &str) -> Result<(String, String)> {
        let body = self.call("auth.getSession", BTreeMap::from([("token".into(), token.into())])).await?;
        let s = &body["session"];
        let key = s["key"].as_str().ok_or_else(|| anyhow!("Last.fm sent no session"))?;
        Ok((key.into(), s["name"].as_str().unwrap_or_default().into()))
    }

    fn fields(s: &Scrobble, i: Option<usize>, out: &mut BTreeMap<String, String>) {
        let name = |k: &str| i.map_or_else(|| k.to_string(), |i| format!("{k}[{i}]"));
        out.insert(name("artist"), s.artist.clone());
        out.insert(name("track"), s.track.clone());
        if let Some(a) = s.album.as_ref().filter(|a| !a.is_empty()) {
            out.insert(name("album"), a.clone());
        }
        if let Some(d) = s.duration_s {
            out.insert(name("duration"), d.to_string());
        }
    }

    /// What plays now, on the profile (not a scrobble; failures aren't retried).
    pub async fn now_playing(&self, sk: &str, s: &Scrobble) -> Result<()> {
        let mut p = BTreeMap::from([("sk".to_string(), sk.to_string())]);
        Self::fields(s, None, &mut p);
        self.call("track.updateNowPlaying", p).await.map(|_| ())
    }

    /// Up to 50 listens in one call, oldest first.
    pub async fn scrobble(&self, sk: &str, batch: &[Scrobble]) -> Result<()> {
        anyhow::ensure!(!batch.is_empty() && batch.len() <= BATCH, "1 to {BATCH} scrobbles per call");
        let mut p = BTreeMap::from([("sk".to_string(), sk.to_string())]);
        for (i, s) in batch.iter().enumerate() {
            Self::fields(s, Some(i), &mut p);
            p.insert(format!("timestamp[{i}]"), s.timestamp.to_string());
        }
        self.call("track.scrobble", p).await.map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};

    const KEY: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn signs_like_the_docs() {
        // Docs example: md5("api_keyxxxxxxxxmethodauth.getSessiontokenxxxxxxxmysecret").
        let p = BTreeMap::from([("api_key".to_string(), "xxxxxxxx".to_string()), ("method".into(), "auth.getSession".into()), ("token".into(), "xxxxxxx".into()), ("format".into(), "json".into())]);
        let want: String = Md5::digest(b"api_keyxxxxxxxxmethodauth.getSessiontokenxxxxxxxmysecret").iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(sign(&p, "mysecret"), want);
        assert!(LastFm::valid_key(KEY) && !LastFm::valid_key("short") && !LastFm::valid_key(&"g".repeat(32)));
    }

    #[test]
    fn only_real_listens_count() {
        assert!(!Scrobble::counts(Some(25_000), 25_000));
        assert!(Scrobble::counts(Some(200_000), 100_000));
        assert!(!Scrobble::counts(Some(200_000), 99_000));
        assert!(Scrobble::counts(Some(900_000), 240_000));
        assert!(!Scrobble::counts(None, 100_000));
    }

    #[tokio::test]
    async fn session_scrobble_and_errors() {
        let mut s = Server::new_async().await;
        s.mock("POST", "/")
            .match_body(Matcher::AllOf(vec![Matcher::UrlEncoded("method".into(), "auth.getSession".into()), Matcher::UrlEncoded("token".into(), "tok".into()), Matcher::UrlEncoded("format".into(), "json".into())]))
            .with_body(r#"{"session":{"name":"clovis","key":"sk1","subscriber":0}}"#)
            .create_async()
            .await;
        s.mock("POST", "/")
            .match_body(Matcher::AllOf(vec![
                Matcher::UrlEncoded("method".into(), "track.scrobble".into()),
                Matcher::UrlEncoded("artist[0]".into(), "Kavinsky".into()),
                Matcher::UrlEncoded("timestamp[1]".into(), "1800000300".into()),
                Matcher::UrlEncoded("album[0]".into(), "OutRun".into()),
                Matcher::UrlEncoded("sk".into(), "sk1".into()),
            ]))
            .with_body(r#"{"scrobbles":{"@attr":{"accepted":2,"ignored":0}}}"#)
            .create_async()
            .await;
        s.mock("POST", "/").match_body(Matcher::UrlEncoded("method".into(), "track.updateNowPlaying".into())).with_body(r#"{"error":9,"message":"Invalid session key"}"#).create_async().await;
        let fm = LastFm::with_urls(&format!("{}/", s.url()), AUTH, KEY, "secret");
        assert_eq!(fm.session("tok").await.unwrap(), ("sk1".to_string(), "clovis".to_string()));
        let one = |t: &str, at: i64| Scrobble { artist: "Kavinsky".into(), track: t.into(), album: Some("OutRun".into()), duration_s: Some(258), timestamp: at };
        fm.scrobble("sk1", &[one("Nightcall", 1_800_000_000), one("Odd Look", 1_800_000_300)]).await.unwrap();
        let e = fm.now_playing("old", &one("Nightcall", 0)).await.unwrap_err();
        assert_eq!(e.downcast_ref::<LastFmError>().map(|e| e.code), Some(INVALID_SESSION));
        assert!(fm.scrobble("sk1", &[]).await.is_err());
        assert!(fm.auth_url("http://127.0.0.1:5000/callback?state=x").unwrap().starts_with("https://www.last.fm/api/auth/?api_key=0123"));
    }
}
