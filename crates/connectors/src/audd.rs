//! Music Detector: AudD (audd.io) recognizes a song from a short recording, with the user's own API token. Checked
//! 2026-10-21: POST multipart to https://api.audd.io/ (`api_token`, `file`, `return`), 10 MB max; errors #900 (bad
//! token) and #901 (no token / limit reached). Shazam has no public API; ACRCloud needs signed requests and 3 secrets.

use anyhow::Result;
use music_core::model::{Source, Track};
use reqwest::multipart::{Form, Part};
use serde::Deserialize;
use std::collections::BTreeMap;

pub const API: &str = "https://api.audd.io/";
/// Where users get a token.
pub const DASHBOARD: &str = "https://dashboard.audd.io/";

/// What AudD refused, worded by the UI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refused {
    BadToken,
    /// No requests left on the token's plan.
    Limit,
    Other(String),
}

impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadToken => f.write_str("AudD refused the token"),
            Self::Limit => f.write_str("no AudD requests left on this token"),
            Self::Other(m) => write!(f, "AudD: {m}"),
        }
    }
}

impl std::error::Error for Refused {}

/// AudD couldn't be reached (no internet, timeout).
#[derive(Debug)]
pub struct Offline;

impl std::fmt::Display for Offline {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AudD can't be reached")
    }
}

impl std::error::Error for Offline {}

#[derive(Deserialize)]
struct Reply {
    status: String,
    result: Option<Song>,
    error: Option<Fault>,
}

#[derive(Deserialize)]
struct Fault {
    error_code: Option<i64>,
    error_message: Option<String>,
}

#[derive(Deserialize)]
struct Song {
    artist: String,
    title: String,
    album: Option<String>,
    apple_music: Option<Apple>,
    spotify: Option<Spotify>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Apple {
    isrc: Option<String>,
    duration_in_millis: Option<u32>,
    album_name: Option<String>,
    artwork: Option<Artwork>,
    play_params: Option<PlayParams>,
}

#[derive(Deserialize)]
struct Artwork {
    url: String,
}

#[derive(Deserialize)]
struct PlayParams {
    id: String,
}

#[derive(Deserialize)]
struct Spotify {
    id: Option<String>,
    duration_ms: Option<u32>,
    external_ids: Option<ExternalIds>,
}

#[derive(Deserialize)]
struct ExternalIds {
    isrc: Option<String>,
}

pub struct AudD {
    api: String,
    http: reqwest::Client,
}

impl Default for AudD {
    fn default() -> Self {
        Self::with_urls(API)
    }
}

impl AudD {
    pub fn with_urls(api: &str) -> Self {
        Self { api: api.to_string(), http: reqwest::Client::new() }
    }

    /// The song in `wav`, None if AudD knows it not. `market`: storefront for the Apple Music / Spotify ids.
    pub async fn recognize(&self, token: &str, wav: Vec<u8>, market: &str) -> Result<Option<Track>> {
        let form = Form::new()
            .text("api_token", token.to_string())
            .text("return", "apple_music,spotify")
            .text("market", market.to_lowercase())
            .part("file", Part::bytes(wav).file_name("clip.wav").mime_str("audio/wav")?);
        let sent = self.http.post(&self.api).multipart(form).timeout(std::time::Duration::from_secs(30)).send().await;
        let sent = sent.map_err(|e| if e.is_connect() || e.is_timeout() { anyhow::Error::new(Offline) } else { e.into() })?;
        let reply: Reply = sent.error_for_status()?.json().await?;
        parse(reply)
    }
}

fn parse(reply: Reply) -> Result<Option<Track>> {
    if reply.status != "success" {
        let f = reply.error.unwrap_or(Fault { error_code: None, error_message: None });
        return Err(match f.error_code {
            Some(900) => Refused::BadToken,
            Some(901) => Refused::Limit,
            _ => Refused::Other(f.error_message.unwrap_or_else(|| "unknown error".into())),
        }
        .into());
    }
    let Some(s) = reply.result else { return Ok(None) };
    let mut ids = BTreeMap::new();
    if let Some(id) = s.apple_music.as_ref().and_then(|a| a.play_params.as_ref()).map(|p| p.id.clone()) {
        ids.insert(Source::Apple, id);
    }
    if let Some(id) = s.spotify.as_ref().and_then(|x| x.id.clone()) {
        ids.insert(Source::Spotify, id);
    }
    let apple = s.apple_music.as_ref();
    Ok(Some(Track {
        title: s.title,
        artist: s.artist,
        album: apple.and_then(|a| a.album_name.clone()).or(s.album).filter(|a| !a.is_empty()),
        duration_ms: apple.and_then(|a| a.duration_in_millis).or(s.spotify.as_ref().and_then(|x| x.duration_ms)),
        isrc: apple.and_then(|a| a.isrc.clone()).or(s.spotify.as_ref().and_then(|x| x.external_ids.as_ref()?.isrc.clone())),
        ids,
        // Apple's artwork template: {w}x{h} filled in.
        art: apple.and_then(|a| a.artwork.as_ref()).map(|w| w.url.replace("{w}", "600").replace("{h}", "600")),
        musicness: None,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FOUND: &str = r#"{"status":"success","result":{"artist":"Imagine Dragons","title":"Warriors","album":"Warriors","release_date":"2014-09-18","label":"Universal Music","timecode":"02:32","song_link":"https://lis.tn/Warriors",
      "apple_music":{"artwork":{"width":1500,"height":1500,"url":"https://is2-ssl.mzstatic.com/image/thumb/Music128/x/{w}x{h}bb.jpeg"},"artistName":"Imagine Dragons","durationInMillis":170799,"name":"Warriors","isrc":"USUM71414163","albumName":"Smoke + Mirrors (Deluxe)","playParams":{"id":"1440831624","kind":"song"}},
      "spotify":{"id":"1lgN0A2Vki2FTON5PYq42m","duration_ms":170066,"external_ids":{"isrc":"USUM71414163"}}}}"#;

    #[tokio::test]
    async fn sends_the_clip_and_reads_the_song() {
        let mut s = mockito::Server::new_async().await;
        let m = s
            .mock("POST", "/")
            .match_header("content-type", mockito::Matcher::Regex("multipart/form-data".into()))
            .match_body(mockito::Matcher::AllOf(vec![
                mockito::Matcher::Regex("name=\"api_token\"\r\n\r\nTOKEN".into()),
                mockito::Matcher::Regex("name=\"return\"\r\n\r\napple_music,spotify".into()),
                mockito::Matcher::Regex("name=\"market\"\r\n\r\nfr".into()),
                mockito::Matcher::Regex("filename=\"clip.wav\"".into()),
            ]))
            .with_body(FOUND)
            .create_async()
            .await;
        let t = AudD::with_urls(&format!("{}/", s.url())).recognize("TOKEN", b"RIFF....".to_vec(), "FR").await.unwrap().unwrap();
        m.assert_async().await;
        assert_eq!((t.title.as_str(), t.artist.as_str()), ("Warriors", "Imagine Dragons"));
        assert_eq!(t.album.as_deref(), Some("Smoke + Mirrors (Deluxe)"));
        assert_eq!(t.isrc.as_deref(), Some("USUM71414163"));
        assert_eq!(t.duration_ms, Some(170_799));
        assert_eq!(t.ids.get(&Source::Apple).map(String::as_str), Some("1440831624"));
        assert_eq!(t.ids.get(&Source::Spotify).map(String::as_str), Some("1lgN0A2Vki2FTON5PYq42m"));
        assert_eq!(t.art.as_deref(), Some("https://is2-ssl.mzstatic.com/image/thumb/Music128/x/600x600bb.jpeg"));
    }

    #[test]
    fn unknown_songs_and_refusals() {
        let r = |j: &str| parse(serde_json::from_str(j).unwrap());
        assert!(r(r#"{"status":"success","result":null}"#).unwrap().is_none());
        let refused = |j: &str| r(j).unwrap_err().downcast::<Refused>().unwrap();
        assert_eq!(refused(r#"{"status":"error","error":{"error_code":900,"error_message":"Wrong API token"}}"#), Refused::BadToken);
        assert_eq!(refused(r#"{"status":"error","error":{"error_code":901,"error_message":"limit"}}"#), Refused::Limit);
        assert_eq!(refused(r#"{"status":"error","error":{"error_code":300,"error_message":"Fingerprinting error"}}"#), Refused::Other("Fingerprinting error".into()));
        // Bare result: no store ids, still a song.
        let t = r(r#"{"status":"success","result":{"artist":"A","title":"B","album":""}}"#).unwrap().unwrap();
        assert_eq!((t.album, t.ids.len(), t.art), (None, 0, None));
    }
}
