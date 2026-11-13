//! Free song recognition: a Chromaprint fingerprint made here from the clip already captured (`rusty-chromaprint`,
//! a pure Rust port, MIT; the sound itself never leaves the PC), looked up at AcoustID (api.acoustid.org), then
//! MusicBrainz adds the ISRC. Checked 2026-11-13 (acoustid.org/webservice): `POST /v2/lookup` with `client` (the
//! application key), `duration` (seconds), `fingerprint` (Chromaprint, base64 URL-safe without padding) and `meta`
//! answers `{"status":"ok","results":[{"id","score","recordings":[{"id","title","artists":[{"name","joinphrase"}],
//! "releasegroups":[{"id","title","type"}]}]}]}`, or `{"status":"error","error":{"code":4,"message":"invalid API key"}}`;
//! 3 requests a second at most. MusicBrainz: `GET /ws/2/recording/<id>?inc=isrcs&fmt=json`, one a second.
//!
//! Honest limits: AcoustID's database is made of whole studio tracks, fingerprinted from their start, and its lookup
//! expects the track's own fingerprint: a 10-second clip taken in the middle of a song, live, noisy or through a
//! microphone mostly finds nothing. It works best on a clip from the first minutes of a studio recording playing
//! cleanly (the PC's own sound). No service that is free matches what Shazam does.

use anyhow::{Result, bail};
use base64::Engine;
use music_core::model::Track;
use rusty_chromaprint::{Configuration, FingerprintCompressor, Fingerprinter};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::time::Duration;

pub const API: &str = "https://api.acoustid.org";
pub const MUSICBRAINZ: &str = crate::musicbrainz::API;
/// Legato's application key, registered by the owner at acoustid.org/new-application (a public identifier, not a
/// secret). Empty until then: the layer answers `Refused::NoKey` and the Detector says so.
pub const APPLICATION_KEY: &str = "";
/// Under this score AcoustID itself is not sure.
const MIN_SCORE: f64 = 0.6;
const TIMEOUT: Duration = Duration::from_secs(20);

/// Why the layer gave no song.
#[derive(Debug, PartialEq, Eq)]
pub enum Refused {
    /// No application key in this build.
    NoKey,
    /// AcoustID refused the key (code 4).
    BadKey,
}

impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::NoKey => "no AcoustID application key",
            Self::BadKey => "AcoustID refused the application key",
        })
    }
}

impl std::error::Error for Refused {}

/// The Chromaprint fingerprint of mono samples (-1..1) as AcoustID wants it, with the clip's length in seconds.
pub fn fingerprint(samples: &[f32], rate: u32) -> Result<(String, u32)> {
    if samples.is_empty() || rate == 0 {
        bail!("nothing to fingerprint");
    }
    let config = Configuration::preset_test2();
    let mut printer = Fingerprinter::new(&config);
    printer.start(rate, 1).map_err(|e| anyhow::anyhow!("fingerprint: {e:?}"))?;
    let pcm: Vec<i16> = samples.iter().map(|s| (s.clamp(-1.0, 1.0) * 32_767.0) as i16).collect();
    printer.consume(&pcm);
    printer.finish();
    let raw = FingerprintCompressor::from(&config).compress(printer.fingerprint());
    let secs = (samples.len() as u64 / u64::from(rate)).max(1) as u32;
    Ok((base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw), secs))
}

#[derive(Deserialize)]
struct Reply {
    status: String,
    #[serde(default)]
    results: Vec<Hit>,
    error: Option<Fault>,
}

#[derive(Deserialize)]
struct Fault {
    code: Option<i64>,
    message: Option<String>,
}

#[derive(Deserialize)]
struct Hit {
    #[serde(default)]
    score: f64,
    #[serde(default)]
    recordings: Vec<Recording>,
}

#[derive(Deserialize)]
struct Recording {
    id: String,
    title: Option<String>,
    duration: Option<f64>,
    #[serde(default)]
    artists: Vec<Artist>,
    #[serde(default)]
    releasegroups: Vec<Group>,
}

#[derive(Deserialize)]
struct Artist {
    name: String,
    joinphrase: Option<String>,
}

#[derive(Deserialize)]
struct Group {
    id: String,
    title: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
}

/// The best song of an answer: the most certain hit with a titled recording, its artists joined as credited.
fn best(reply: Reply) -> Result<Option<(Track, String)>> {
    if reply.status != "ok" {
        let f = reply.error.unwrap_or(Fault { code: None, message: None });
        if f.code == Some(4) {
            return Err(Refused::BadKey.into());
        }
        bail!("AcoustID: {}", f.message.unwrap_or_else(|| "unknown error".into()));
    }
    let mut hits = reply.results;
    hits.sort_by(|a, b| b.score.total_cmp(&a.score));
    for hit in hits.into_iter().filter(|h| h.score >= MIN_SCORE) {
        for r in hit.recordings {
            let Some(title) = r.title.filter(|t| !t.trim().is_empty()) else { continue };
            let artist: String = r.artists.iter().map(|a| format!("{}{}", a.name, a.joinphrase.as_deref().unwrap_or(""))).collect::<String>().trim().to_string();
            if artist.is_empty() {
                continue;
            }
            let group = r.releasegroups.iter().find(|g| g.kind.as_deref() == Some("Album") && g.title.is_some()).or_else(|| r.releasegroups.iter().find(|g| g.title.is_some()));
            let track = Track {
                title,
                artist,
                album: group.and_then(|g| g.title.clone()),
                duration_ms: r.duration.map(|d| (d * 1000.0) as u32),
                isrc: None,
                ids: BTreeMap::new(),
                // Cover Art Archive (art.rs lets this address through): the release group's front cover.
                art: group.map(|g| format!("https://coverartarchive.org/release-group/{}/front-250", g.id)),
                musicness: None,
                explicit: false,
            };
            return Ok(Some((track, r.id)));
        }
    }
    Ok(None)
}

#[derive(Deserialize)]
struct Isrcs {
    #[serde(default)]
    isrcs: Vec<String>,
}

pub struct AcoustId {
    api: String,
    musicbrainz: String,
    http: reqwest::Client,
}

impl Default for AcoustId {
    fn default() -> Self {
        Self::with_urls(API, MUSICBRAINZ)
    }
}

impl AcoustId {
    pub fn with_urls(api: &str, musicbrainz: &str) -> Self {
        Self { api: api.into(), musicbrainz: musicbrainz.into(), http: crate::http() }
    }

    /// The song `fingerprint` (from `fingerprint`) names, None when nothing is sure enough. The key is passed in
    /// (`APPLICATION_KEY` in the app) so tests need none.
    pub async fn lookup(&self, key: &str, fingerprint: &str, secs: u32) -> Result<Option<Track>> {
        if key.trim().is_empty() {
            return Err(Refused::NoKey.into());
        }
        let body = url::form_urlencoded::Serializer::new(String::new()).append_pair("client", key).append_pair("meta", "recordings releasegroups").append_pair("duration", &secs.to_string()).append_pair("fingerprint", fingerprint).finish();
        let sent = self.http.post(format!("{}/v2/lookup", self.api)).header("content-type", "application/x-www-form-urlencoded").body(body).timeout(TIMEOUT).send().await?;
        let reply: Reply = sent.error_for_status()?.json().await?;
        let Some((mut track, mbid)) = best(reply)? else { return Ok(None) };
        // The ISRC is a bonus: MusicBrainz being slow or down changes nothing else.
        let asked = self.http.get(format!("{}/recording/{mbid}?inc=isrcs&fmt=json", self.musicbrainz)).header(reqwest::header::USER_AGENT, crate::musicbrainz::AGENT).timeout(TIMEOUT).send().await;
        if let Ok(r) = asked.and_then(reqwest::Response::error_for_status)
            && let Ok(i) = r.json::<Isrcs>().await
        {
            track.isrc = i.isrcs.into_iter().next();
        }
        Ok(Some(track))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FOUND: &str = r#"{"status":"ok","results":[
      {"id":"low","score":0.3,"recordings":[{"id":"m0","title":"Other","artists":[{"name":"Nobody"}]}]},
      {"id":"hit","score":0.97,"recordings":[
        {"id":"m1","artists":[{"name":"No Title"}]},
        {"id":"m2","title":"Warriors","duration":170.5,"artists":[{"name":"Imagine Dragons","joinphrase":" feat. "},{"name":"Someone"}],
         "releasegroups":[{"id":"g1","title":"Warriors EP","type":"EP"},{"id":"g2","title":"Smoke + Mirrors","type":"Album"}]}]}]}"#;

    #[test]
    fn a_sine_makes_a_stable_fingerprint_of_its_length() {
        let tone: Vec<f32> = (0..44_100 * 8).map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / 44_100.0).sin() * 0.5).collect();
        let (a, secs) = fingerprint(&tone, 44_100).unwrap();
        assert_eq!(secs, 8);
        assert!(a.len() > 8 && a.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
        assert_eq!(a, fingerprint(&tone, 44_100).unwrap().0);
        assert!(fingerprint(&[], 44_100).is_err());
    }

    #[test]
    fn the_surest_titled_recording_is_the_song_and_a_weak_hit_is_none() {
        let (t, mbid) = best(serde_json::from_str(FOUND).unwrap()).unwrap().unwrap();
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.album.as_deref(), mbid.as_str()), ("Warriors", "Imagine Dragons feat. Someone", Some("Smoke + Mirrors"), "m2"));
        assert_eq!(t.art.as_deref(), Some("https://coverartarchive.org/release-group/g2/front-250"));
        assert_eq!(t.duration_ms, Some(170_500));
        assert!(best(serde_json::from_str(r#"{"status":"ok","results":[{"score":0.2,"recordings":[{"id":"x","title":"T","artists":[{"name":"A"}]}]}]}"#).unwrap()).unwrap().is_none());
        assert!(best(serde_json::from_str(r#"{"status":"ok","results":[]}"#).unwrap()).unwrap().is_none());
    }

    #[tokio::test]
    async fn looks_the_fingerprint_up_then_asks_musicbrainz_for_the_isrc() {
        let mut s = mockito::Server::new_async().await;
        let lookup = s
            .mock("POST", "/v2/lookup")
            .match_body(mockito::Matcher::AllOf(vec![
                mockito::Matcher::UrlEncoded("client".into(), "KEY".into()),
                mockito::Matcher::UrlEncoded("duration".into(), "10".into()),
                mockito::Matcher::UrlEncoded("fingerprint".into(), "FP".into()),
                mockito::Matcher::UrlEncoded("meta".into(), "recordings releasegroups".into()),
            ]))
            .with_body(FOUND)
            .create_async()
            .await;
        let mb = s.mock("GET", "/recording/m2").match_query(mockito::Matcher::Any).with_body(r#"{"isrcs":["USUM71414163"]}"#).create_async().await;
        let t = AcoustId::with_urls(&s.url(), &s.url()).lookup("KEY", "FP", 10).await.unwrap().unwrap();
        lookup.assert_async().await;
        mb.assert_async().await;
        assert_eq!(t.isrc.as_deref(), Some("USUM71414163"));
    }

    #[tokio::test]
    async fn musicbrainz_failing_keeps_the_song_and_a_bad_or_missing_key_is_said() {
        let mut s = mockito::Server::new_async().await;
        s.mock("POST", "/v2/lookup").with_body(FOUND).create_async().await;
        s.mock("GET", "/recording/m2").match_query(mockito::Matcher::Any).with_status(503).create_async().await;
        let t = AcoustId::with_urls(&s.url(), &s.url()).lookup("KEY", "FP", 10).await.unwrap().unwrap();
        assert_eq!((t.title.as_str(), t.isrc), ("Warriors", None));

        let mut bad = mockito::Server::new_async().await;
        bad.mock("POST", "/v2/lookup").with_body(r#"{"status":"error","error":{"code":4,"message":"invalid API key"}}"#).create_async().await;
        let e = AcoustId::with_urls(&bad.url(), &bad.url()).lookup("KEY", "FP", 10).await.unwrap_err();
        assert_eq!(e.downcast_ref::<Refused>(), Some(&Refused::BadKey));
        let e = AcoustId::with_urls(&bad.url(), &bad.url()).lookup("  ", "FP", 10).await.unwrap_err();
        assert_eq!(e.downcast_ref::<Refused>(), Some(&Refused::NoKey));
    }
}
