//! SponsorBlock's community segments (sponsor.ajay.app), category `music_offtopic` only: the parts of a music video that
//! are not the music (intro, skit, talking, outro). Checked 2026-10-31 (the wiki is behind a bot wall; answers recorded
//! by hand): `GET /api/skipSegments/{hash prefix}?categories=["music_offtopic"]&actionTypes=["skip"]` answers an
//! array of `{videoID, segments:[{category, actionType, segment:[start, end], UUID, videoDuration, locked, votes,
//! description}]}` for every video whose SHA-256 starts with the prefix (about a dozen at 4 characters; 404 when none);
//! no key, no User-Agent rule (we name the app anyway). Only the hash prefix leaves the PC, the video id never does:
//! the answer is filtered by the full id here. Community data: a wrong segment is possible, the app lets Undo.

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

pub const API: &str = "https://sponsor.ajay.app/api";
const AGENT: &str = concat!("Legato v", env!("CARGO_PKG_VERSION"), " (https://github.com/Clovis500c/legato)");
const CATEGORY: &str = "music_offtopic";
/// Hex characters of the hash sent.
const PREFIX: usize = 4;
/// It never holds a song back: a slow answer is no answer.
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(4);
/// Shorter than this is a glitch, not a part worth a jump.
const MIN_S: f64 = 1.0;

/// A part of a video to skip, in seconds of the video.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "SponsorSegment")]
pub struct Segment {
    pub start_s: f64,
    pub end_s: f64,
}

#[derive(Deserialize)]
struct Video {
    #[serde(rename = "videoID")]
    video_id: String,
    #[serde(default)]
    segments: Vec<Raw>,
}

#[derive(Deserialize)]
struct Raw {
    category: String,
    #[serde(rename = "actionType", default)]
    action_type: String,
    segment: [f64; 2],
}

/// First hex characters of the id's SHA-256: all that is sent.
pub fn prefix(video_id: &str) -> String {
    Sha256::digest(video_id.as_bytes()).iter().flat_map(|b| [b >> 4, b & 15]).take(PREFIX).map(|n| char::from_digit(n.into(), 16).unwrap()).collect()
}

fn valid_id(id: &str) -> bool {
    id.len() == 11 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The segments of `video_id` in an answer to its prefix: other videos dropped, glitches (under a second, not a
/// forward range) ignored, in order.
pub fn pick(body: &str, video_id: &str) -> Result<Vec<Segment>> {
    let mut out: Vec<Segment> = serde_json::from_str::<Vec<Video>>(body)?
        .into_iter()
        .filter(|v| v.video_id == video_id)
        .flat_map(|v| v.segments)
        .filter(|s| s.category == CATEGORY && (s.action_type.is_empty() || s.action_type == "skip"))
        .map(|s| Segment { start_s: s.segment[0], end_s: s.segment[1] })
        .filter(|s| s.start_s.is_finite() && s.end_s.is_finite() && s.start_s >= 0.0 && s.end_s - s.start_s >= MIN_S)
        .collect();
    out.sort_by(|a, b| a.start_s.total_cmp(&b.start_s));
    Ok(out)
}

pub struct SponsorBlock {
    api: String,
    http: reqwest::Client,
}

impl Default for SponsorBlock {
    fn default() -> Self {
        Self::with_urls(API)
    }
}

impl SponsorBlock {
    pub fn with_urls(api: &str) -> Self {
        Self { api: api.trim_end_matches('/').to_string(), http: crate::http() }
    }

    /// Non-music parts of a video. Empty = none known. Errors (timeout, busy, bad answer): the caller plays on.
    pub async fn segments(&self, video_id: &str) -> Result<Vec<Segment>> {
        if !valid_id(video_id) {
            bail!("not a video id");
        }
        let mut url = Url::parse(&format!("{}/skipSegments/{}", self.api, prefix(video_id)))?;
        url.query_pairs_mut().append_pair("categories", &format!("[\"{CATEGORY}\"]")).append_pair("actionTypes", "[\"skip\"]");
        let r = self.http.get(url).header(reqwest::header::USER_AGENT, AGENT).timeout(TIMEOUT).send().await?;
        match r.status().as_u16() {
            404 => Ok(Vec::new()),
            429 | 503 => bail!("SponsorBlock is busy"),
            _ => pick(&r.error_for_status()?.text().await?, video_id),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Matcher;

    /// Recorded 2026-10-31 for prefix 5f6b, three of the eight videos (trimmed to what we read).
    const RECORDED: &str = r#"[{"videoID":"V2GrvtpyM2s","segments":[{"category":"music_offtopic","actionType":"skip","segment":[0,12.439],"UUID":"08951e7c","videoDuration":129.59,"locked":0,"votes":0,"description":""}]},{"videoID":"THscJf7O7bY","segments":[{"category":"music_offtopic","actionType":"skip","segment":[0,38],"UUID":"2c2a8dae","videoDuration":234.921,"locked":0,"votes":0,"description":""},{"category":"music_offtopic","actionType":"skip","segment":[219.752,234.921],"UUID":"3aac1326","videoDuration":234.921,"locked":0,"votes":0,"description":""}]},{"videoID":"1yRWqE5jrkM","segments":[{"category":"music_offtopic","actionType":"skip","segment":[188.341,191.46083],"UUID":"852cd519","videoDuration":191.46083,"locked":0,"votes":0,"description":""}]}]"#;

    #[test]
    fn the_prefix_is_four_hex_characters_of_the_sha256() {
        assert_eq!(prefix("dQw4w9WgXcQ"), "5f6b");
        assert_eq!(prefix("THscJf7O7bY"), "5f6b");
    }

    #[test]
    fn only_the_asked_video_is_kept() {
        let s = pick(RECORDED, "THscJf7O7bY").unwrap();
        assert_eq!(s, [Segment { start_s: 0.0, end_s: 38.0 }, Segment { start_s: 219.752, end_s: 234.921 }]);
        assert!(pick(RECORDED, "dQw4w9WgXcQ").unwrap().is_empty());
    }

    #[test]
    fn glitches_and_other_kinds_are_ignored() {
        let body = r#"[{"videoID":"aaaaaaaaaaa","segments":[{"category":"music_offtopic","actionType":"skip","segment":[5,5.4]},{"category":"sponsor","actionType":"skip","segment":[1,20]},{"category":"music_offtopic","actionType":"mute","segment":[1,20]},{"category":"music_offtopic","actionType":"skip","segment":[30,10]},{"category":"music_offtopic","actionType":"skip","segment":[40,60]}]}]"#;
        assert_eq!(pick(body, "aaaaaaaaaaa").unwrap(), [Segment { start_s: 40.0, end_s: 60.0 }]);
    }

    #[tokio::test]
    async fn asks_by_hash_prefix_and_never_sends_the_id() {
        let mut s = mockito::Server::new_async().await;
        // Only the prefix path is mocked: a request carrying the id anywhere else would not match and fail.
        let m = s
            .mock("GET", "/api/skipSegments/5f6b")
            .match_header("user-agent", Matcher::Regex("^Legato v".into()))
            .match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("categories".into(), r#"["music_offtopic"]"#.into()), Matcher::UrlEncoded("actionTypes".into(), r#"["skip"]"#.into())]))
            .with_body(RECORDED)
            .expect(2)
            .create_async()
            .await;
        let sb = SponsorBlock::with_urls(&format!("{}/api", s.url()));
        assert_eq!(sb.segments("THscJf7O7bY").await.unwrap().len(), 2);
        // The same prefix, a video nobody marked.
        assert!(sb.segments("dQw4w9WgXcQ").await.unwrap().is_empty());
        m.assert_async().await;
    }

    #[tokio::test]
    async fn nothing_known_busy_and_bad_ids() {
        let mut s = mockito::Server::new_async().await;
        s.mock("GET", Matcher::Any).with_status(404).with_body("Not Found").create_async().await;
        let sb = SponsorBlock::with_urls(&format!("{}/api", s.url()));
        assert!(sb.segments("aaaaaaaaaaa").await.unwrap().is_empty());
        assert!(sb.segments("short").await.is_err());
        let mut busy = mockito::Server::new_async().await;
        busy.mock("GET", Matcher::Any).with_status(429).create_async().await;
        assert!(SponsorBlock::with_urls(&format!("{}/api", busy.url())).segments("aaaaaaaaaaa").await.unwrap_err().to_string().contains("busy"));
    }
}
