//! ListenBrainz scrobbling (MetaBrainz's open listen history, API docs checked 2026-11-01): the user's own token from
//! listenbrainz.org › Settings, kept in the keychain; no key of ours. Sends what plays now and each finished listen
//! (title, artist, album, length, ISRC, the YouTube video or Spotify track it played from); reads back only the token's
//! user name. About one call a second (X-RateLimit-* headers), 429 beyond: a refused listen waits for the next one.

use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

pub const API: &str = "https://api.listenbrainz.org";
/// Listens per call. The docs allow 1000 (10 kB each); ours are a few after a long offline stretch.
pub const BATCH: usize = 50;
/// What listens say played and sent them.
const PLAYER: &str = "Legato";

/// One listen. `listened_at` = when it started (unix s, UTC).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Listen {
    pub artist: String,
    pub track: String,
    pub album: Option<String>,
    pub duration_ms: Option<u32>,
    pub listened_at: i64,
    pub isrc: Option<String>,
    /// The YouTube video or Spotify track it played from (neither: a file of yours).
    pub youtube_id: Option<String>,
    pub spotify_id: Option<String>,
}

/// What ListenBrainz said no to.
#[derive(Debug, PartialEq)]
pub enum Refused {
    /// Token reset or wrong (401): paste it again.
    Token,
    /// Over the rate limit (429): the next listen tries again.
    TooFast,
    /// This listen can't go as it is (400): never retried.
    Listen(String),
}

impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Token => write!(f, "ListenBrainz refused the token"),
            Self::TooFast => write!(f, "ListenBrainz: 429 Too Many Requests"),
            Self::Listen(why) => write!(f, "ListenBrainz refused the listen: {why}"),
        }
    }
}
impl std::error::Error for Refused {}

// Trust boundary: ids go into links, so only their own characters pass.
fn video_id(id: &str) -> bool {
    id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn spotify_id(id: &str) -> bool {
    id.len() == 22 && id.bytes().all(|b| b.is_ascii_alphanumeric())
}
fn isrc(code: &str) -> bool {
    code.len() == 12 && code.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// One listen as ListenBrainz takes it. `now` = playing now: no time.
pub fn payload(l: &Listen, version: &str, now: bool) -> Value {
    let mut info = Map::new();
    for key in ["media_player", "submission_client"] {
        info.insert(key.into(), PLAYER.into());
    }
    for key in ["media_player_version", "submission_client_version"] {
        info.insert(key.into(), version.into());
    }
    if let Some(d) = l.duration_ms.filter(|d| *d > 0) {
        info.insert("duration_ms".into(), d.into());
    }
    if let Some(code) = l.isrc.as_deref().filter(|c| isrc(c)) {
        info.insert("isrc".into(), code.to_uppercase().into());
    }
    if let Some(id) = l.youtube_id.as_deref().filter(|id| video_id(id)) {
        info.insert("music_service".into(), "youtube.com".into());
        info.insert("origin_url".into(), format!("https://www.youtube.com/watch?v={id}").into());
    } else if let Some(id) = l.spotify_id.as_deref().filter(|id| spotify_id(id)) {
        let url = format!("https://open.spotify.com/track/{id}");
        info.insert("music_service".into(), "spotify.com".into());
        info.insert("origin_url".into(), url.clone().into());
        info.insert("spotify_id".into(), url.into());
    }
    let mut meta = json!({ "artist_name": l.artist, "track_name": l.track });
    if let Some(album) = l.album.as_deref().filter(|a| !a.trim().is_empty()) {
        meta["release_name"] = album.into();
    }
    meta["additional_info"] = info.into();
    let mut item = json!({ "track_metadata": meta });
    if !now {
        item["listened_at"] = l.listened_at.into();
    }
    item
}

pub struct ListenBrainz {
    api: String,
    token: String,
    version: String,
}

impl ListenBrainz {
    /// `version`: the app's, sent with each listen.
    pub fn new(token: &str, version: &str) -> Self {
        Self::with_url(API, token, version)
    }

    pub fn with_url(api: &str, token: &str, version: &str) -> Self {
        Self { api: api.trim_end_matches('/').into(), token: token.trim().into(), version: version.into() }
    }

    /// Trust boundary: tokens are UUIDs; 16 to 128 letters, digits, dashes or underscores pass.
    pub fn valid_token(s: &str) -> bool {
        let s = s.trim();
        (16..=128).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    }

    async fn send(&self, req: reqwest::RequestBuilder) -> Result<Value> {
        let res = req.header("authorization", format!("Token {}", self.token)).timeout(crate::linklist::REQUEST_TIMEOUT).send().await?;
        match res.status().as_u16() {
            200 => res.json().await.context("ListenBrainz sent no JSON"),
            401 => Err(Refused::Token.into()),
            429 => Err(Refused::TooFast.into()),
            400 => {
                let body: Value = res.json().await.unwrap_or_default();
                Err(Refused::Listen(body["error"].as_str().unwrap_or("bad request").chars().take(200).collect()).into())
            }
            code => bail!("ListenBrainz answered {code}"),
        }
    }

    /// The token's user name; None = ListenBrainz doesn't know the token.
    pub async fn user(&self) -> Result<Option<String>> {
        let body = match self.send(crate::http().get(format!("{}/1/validate-token", self.api))).await {
            Err(e) if e.downcast_ref::<Refused>() == Some(&Refused::Token) => return Ok(None),
            other => other?,
        };
        Ok(body["valid"].as_bool().unwrap_or(false).then(|| body["user_name"].as_str().unwrap_or_default().to_string()))
    }

    async fn submit_as(&self, kind: &str, listens: &[Listen]) -> Result<()> {
        let now = kind == "playing_now";
        let body = json!({ "listen_type": kind, "payload": listens.iter().map(|l| payload(l, &self.version, now)).collect::<Vec<_>>() });
        self.send(crate::http().post(format!("{}/1/submit-listens", self.api)).json(&body)).await.map(|_| ())
    }

    /// What plays now, on the profile for a while (failures aren't retried).
    pub async fn playing_now(&self, l: &Listen) -> Result<()> {
        self.submit_as("playing_now", std::slice::from_ref(l)).await
    }

    /// Up to 50 listens, oldest first: one goes as "single", more as "import".
    pub async fn submit(&self, listens: &[Listen]) -> Result<()> {
        ensure!(!listens.is_empty() && listens.len() <= BATCH, "1 to {BATCH} listens per call");
        self.submit_as(if listens.len() == 1 { "single" } else { "import" }, listens).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};

    const TOKEN: &str = "8b8f8c8f-1d2e-4f5a-9b6c-7d8e9f0a1b2c";

    fn nightcall(at: i64) -> Listen {
        Listen { artist: "Kavinsky".into(), track: "Nightcall".into(), album: Some("OutRun".into()), duration_ms: Some(258_000), listened_at: at, isrc: Some("fr6v81200001".into()), youtube_id: Some("MV_3Dpw-BRY".into()), spotify_id: None }
    }

    #[test]
    fn listens_carry_where_they_played_from() {
        let item = payload(&nightcall(1_800_000_000), "1.4.0", false);
        assert_eq!(item["listened_at"], 1_800_000_000);
        assert_eq!(item["track_metadata"]["release_name"], "OutRun");
        let info = &item["track_metadata"]["additional_info"];
        assert_eq!((info["media_player"].as_str(), info["submission_client_version"].as_str()), (Some("Legato"), Some("1.4.0")));
        assert_eq!((info["duration_ms"].as_u64(), info["isrc"].as_str()), (Some(258_000), Some("FR6V81200001")));
        assert_eq!(info["origin_url"], "https://www.youtube.com/watch?v=MV_3Dpw-BRY");
        // Playing now: no time. Spotify: its track page twice. A file: no link, a broken id neither.
        let spotify = Listen { youtube_id: None, spotify_id: Some("0U0ldCRmgCqhVvD6ksG63j".into()), album: None, ..nightcall(1) };
        let now = payload(&spotify, "1.4.0", true);
        assert!(now.get("listened_at").is_none() && now["track_metadata"].get("release_name").is_none());
        assert_eq!(now["track_metadata"]["additional_info"]["spotify_id"], "https://open.spotify.com/track/0U0ldCRmgCqhVvD6ksG63j");
        let file = payload(&Listen { youtube_id: Some("../../evil?x=1".into()), isrc: Some("nope".into()), duration_ms: None, ..nightcall(1) }, "1.4.0", false);
        let info = &file["track_metadata"]["additional_info"];
        assert!(info.get("origin_url").is_none() && info.get("music_service").is_none() && info.get("isrc").is_none() && info.get("duration_ms").is_none());
        assert!(ListenBrainz::valid_token(TOKEN) && !ListenBrainz::valid_token("short") && !ListenBrainz::valid_token(&format!("{TOKEN} x")));
    }

    #[tokio::test]
    async fn checks_the_token_and_sends_listens() {
        let mut s = Server::new_async().await;
        let auth = format!("Token {TOKEN}");
        s.mock("GET", "/1/validate-token").match_header("authorization", auth.as_str()).with_body(r#"{"code":200,"message":"Token valid.","valid":true,"user_name":"clovis"}"#).create_async().await;
        s.mock("GET", "/1/validate-token").match_header("authorization", "Token stale-token-0000000000").with_body(r#"{"code":200,"message":"Token invalid.","valid":false}"#).create_async().await;
        let single = s
            .mock("POST", "/1/submit-listens")
            .match_header("authorization", auth.as_str())
            .match_body(Matcher::PartialJson(json!({ "listen_type": "single", "payload": [{ "listened_at": 1_800_000_000, "track_metadata": { "track_name": "Nightcall" } }] })))
            .with_body(r#"{"status":"ok"}"#)
            .create_async()
            .await;
        let import = s.mock("POST", "/1/submit-listens").match_body(Matcher::PartialJson(json!({ "listen_type": "import" }))).with_body(r#"{"status":"ok"}"#).create_async().await;
        let lb = ListenBrainz::with_url(&format!("{}/", s.url()), TOKEN, "1.4.0");
        assert_eq!(lb.user().await.unwrap(), Some("clovis".to_string()));
        assert_eq!(ListenBrainz::with_url(&s.url(), "stale-token-0000000000", "1.4.0").user().await.unwrap(), None);
        lb.submit(&[nightcall(1_800_000_000)]).await.unwrap();
        lb.submit(&[nightcall(1_800_000_000), nightcall(1_800_000_300)]).await.unwrap();
        single.assert_async().await;
        import.assert_async().await;
        assert!(lb.submit(&[]).await.is_err());
    }

    #[tokio::test]
    async fn says_what_was_refused() {
        let mut s = Server::new_async().await;
        s.mock("POST", "/1/submit-listens").match_body(Matcher::PartialJson(json!({ "listen_type": "playing_now" }))).with_status(429).with_header("X-RateLimit-Reset-In", "8").with_body("{}").create_async().await;
        s.mock("POST", "/1/submit-listens").match_body(Matcher::PartialJson(json!({ "listen_type": "single" }))).with_status(400).with_body(r#"{"code":400,"error":"Value for key listened_at is too low."}"#).create_async().await;
        s.mock("POST", "/1/submit-listens").match_body(Matcher::PartialJson(json!({ "listen_type": "import" }))).with_status(401).with_body(r#"{"code":401,"error":"Invalid authorization token."}"#).create_async().await;
        s.mock("GET", "/1/validate-token").with_status(401).with_body("{}").create_async().await;
        let lb = ListenBrainz::with_url(&s.url(), TOKEN, "1.4.0");
        let refused = |e: anyhow::Error| e.downcast::<Refused>().ok();
        assert_eq!(refused(lb.playing_now(&nightcall(0)).await.unwrap_err()), Some(Refused::TooFast));
        assert_eq!(refused(lb.submit(&[nightcall(1)]).await.unwrap_err()), Some(Refused::Listen("Value for key listened_at is too low.".into())));
        assert_eq!(refused(lb.submit(&[nightcall(1), nightcall(2)]).await.unwrap_err()), Some(Refused::Token));
        assert_eq!(lb.user().await.unwrap(), None);
    }
}
