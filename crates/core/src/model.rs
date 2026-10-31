use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Source {
    Spotify,
    Youtube,
    Local,
    /// Apple Music catalog (iTunes id). Metadata only for now.
    Apple,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Source::Spotify => "spotify",
            Source::Youtube => "youtube",
            Source::Local => "local",
            Source::Apple => "apple",
        }
    }
}

/// Common track model. `ids` = same track id per source.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Track {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: Option<u32>,
    pub isrc: Option<String>,
    pub ids: BTreeMap<Source, String>,
    /// Cover art URL (https, served to the UI through the app's image cache).
    #[serde(default)]
    #[ts(optional = nullable)]
    pub art: Option<String>,
    /// Music or not (YouTube videos: talks, reactions, games come along with songs). None = not looked at.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub musicness: Option<crate::musicness::Musicness>,
}

/// YouTube video frame: last resort art, any real cover wins over it.
pub fn video_frame(url: &str) -> bool {
    url.starts_with("https://i.ytimg.com/")
}

/// Keep `a` unless it's missing, or a video frame while `b` is a real cover.
pub fn pick_art(a: Option<String>, b: Option<String>) -> Option<String> {
    match (&a, &b) {
        (None, _) => b,
        (Some(x), Some(y)) if video_frame(x) && !video_frame(y) => b,
        _ => a,
    }
}

/// Art for a bare YouTube video (no network).
pub fn youtube_art(video_id: &str) -> String {
    format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlaylistRef {
    pub id: String,
    pub name: String,
}

/// Music service. Each user connects own account.
#[async_trait]
pub trait Connector: Send + Sync {
    fn source(&self) -> Source;
    fn is_connected(&self) -> bool;
    async fn connect(&self) -> Result<()>;
    fn disconnect(&self) -> Result<()>;
    async fn list_playlists(&self) -> Result<Vec<PlaylistRef>>;
    async fn playlist_tracks(&self, playlist_id: &str) -> Result<Vec<Track>>;
    async fn search(&self, query: &str) -> Result<Vec<Track>>;
    /// Find `track` on this service, or None.
    async fn resolve(&self, track: &Track) -> Result<Option<Track>>;
    /// Create playlist, return id. Tracks without id here skipped.
    async fn write_playlist(&self, name: &str, tracks: &[Track]) -> Result<String>;
}

/// Secret JSON store. OS keychain in app, memory in tests.
pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Option<serde_json::Value>;
    fn set(&self, key: &str, value: Option<serde_json::Value>) -> Result<()>;
}

impl dyn SecretStore {
    pub fn load<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        self.get(key).and_then(|v| serde_json::from_value(v).ok())
    }

    pub fn save<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        self.set(key, Some(serde_json::to_value(value)?))
    }
}

#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, serde_json::Value>>);

impl MemoryStore {
    pub fn with(key: &str, value: serde_json::Value) -> Self {
        Self(Mutex::new(HashMap::from([(key.to_string(), value)])))
    }
}

impl SecretStore for MemoryStore {
    fn get(&self, key: &str) -> Option<serde_json::Value> {
        self.0.lock().unwrap().get(key).cloned()
    }

    fn set(&self, key: &str, value: Option<serde_json::Value>) -> Result<()> {
        let mut map = self.0.lock().unwrap();
        match value {
            Some(v) => map.insert(key.to_string(), v),
            None => map.remove(key),
        };
        Ok(())
    }
}
