use crate::oauth::{OAuthClient, OAuthConfig, Opener};
use anyhow::{Context, Result, anyhow, ensure};
use async_trait::async_trait;
use music_core::matching::{best_match, normalize, primary_artist};
use music_core::model::{Connector, PlaylistRef, SecretStore, Source, Track};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use serde_json::json;
use std::collections::BTreeMap;
use std::sync::Arc;
use url::Url;

// Playback scopes: Spotify Connect. Accounts connected before need a reconnect (player_error says so).
const SCOPES: &str = "playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-read-playback-state user-modify-playback-state";

#[derive(Deserialize)]
struct Named {
    name: String,
}

#[derive(Deserialize)]
struct Image {
    url: String,
}

#[derive(Deserialize)]
struct Album {
    name: String,
    #[serde(default)]
    images: Vec<Image>,
}

#[derive(Deserialize)]
struct SpotifyTrack {
    id: Option<String>,
    #[serde(rename = "type", default)]
    kind: String,
    name: String,
    // Episodes lack these. Default so whole page still parses.
    #[serde(default)]
    artists: Vec<Named>,
    album: Option<Album>,
    #[serde(default)]
    duration_ms: u32,
    external_ids: Option<BTreeMap<String, String>>,
    #[serde(default)]
    is_local: bool,
}

impl SpotifyTrack {
    fn into_track(self) -> Option<Track> {
        let id = self.id.filter(|_| self.kind != "episode" && !self.is_local)?;
        // Largest image first.
        let art = self.album.as_ref().and_then(|a| a.images.first()).map(|i| i.url.clone());
        Some(Track {
            title: self.name,
            artist: self.artists.into_iter().map(|a| a.name).collect::<Vec<_>>().join(", "),
            album: self.album.map(|a| a.name),
            art,
            duration_ms: Some(self.duration_ms),
            isrc: self.external_ids.and_then(|mut e| e.remove("isrc")).map(|s| s.to_uppercase()),
            ids: BTreeMap::from([(Source::Spotify, id)]),
            musicness: Some(music_core::musicness::Musicness::Music),
        })
    }
}

#[derive(Deserialize)]
struct Paging<T> {
    items: Vec<T>,
    next: Option<String>,
}

/// Spotify Web API, Feb 2026 endpoints: /items, POST /me/playlists, search limit ≤ 10.
pub struct Spotify {
    oauth: OAuthClient,
    api: String,
}

impl Spotify {
    pub fn new(client_id: &str, store: Arc<dyn SecretStore>, open: Opener) -> Self {
        Self::with_urls(client_id, store, open, "https://api.spotify.com/v1", "https://accounts.spotify.com")
    }

    pub fn with_urls(client_id: &str, store: Arc<dyn SecretStore>, open: Opener, api: &str, accounts: &str) -> Self {
        let cfg = OAuthConfig {
            key: "spotify",
            auth_url: format!("{accounts}/authorize"),
            token_url: format!("{accounts}/api/token"),
            client_id: client_id.into(),
            client_secret: None,
            scope: SCOPES,
            extra_auth_params: &[],
        };
        Self { oauth: OAuthClient::new(cfg, store, open), api: api.into() }
    }

    async fn get<T: DeserializeOwned>(&self, url: &str) -> Result<T> {
        self.oauth.json(Method::GET, url, None).await
    }

    async fn all<T: DeserializeOwned>(&self, url: String) -> Result<Vec<T>> {
        let mut out = Vec::new();
        let mut next = Some(url);
        while let Some(url) = next {
            let page: Paging<T> = self.get(&url).await?;
            out.extend(page.items);
            next = page.next;
        }
        Ok(out)
    }
}

#[async_trait]
impl Connector for Spotify {
    fn source(&self) -> Source {
        Source::Spotify
    }

    fn is_connected(&self) -> bool {
        self.oauth.is_connected()
    }

    async fn connect(&self) -> Result<()> {
        self.oauth.connect().await
    }

    fn disconnect(&self) -> Result<()> {
        self.oauth.disconnect()
    }

    async fn list_playlists(&self) -> Result<Vec<PlaylistRef>> {
        #[derive(Deserialize)]
        struct Me {
            id: String,
        }
        #[derive(Deserialize)]
        struct Playlist {
            id: String,
            name: String,
            owner: Me,
            #[serde(default)]
            collaborative: bool,
        }
        let me: Me = self.get(&format!("{}/me", self.api)).await?;
        let lists: Vec<Playlist> = self.all(format!("{}/me/playlists?limit=50", self.api)).await?;
        // Since Feb 2026: content readable only for owned or collab playlists.
        Ok(lists.into_iter().filter(|p| p.owner.id == me.id || p.collaborative).map(|p| PlaylistRef { id: p.id, name: p.name }).collect())
    }

    async fn playlist_tracks(&self, playlist_id: &str) -> Result<Vec<Track>> {
        #[derive(Deserialize)]
        struct Entry {
            item: Option<SpotifyTrack>,
            // Deprecated alias of `item`.
            track: Option<SpotifyTrack>,
        }
        let mut url = Url::parse(&format!("{}/playlists/", self.api))?;
        url.path_segments_mut().map_err(|_| anyhow::anyhow!("bad api url"))?.pop_if_empty().extend([playlist_id, "items"]);
        url.set_query(Some("limit=50"));
        let entries: Vec<Entry> = self.all(url.into()).await?;
        Ok(entries.into_iter().filter_map(|e| e.item.or(e.track)?.into_track()).collect())
    }

    async fn search(&self, query: &str) -> Result<Vec<Track>> {
        #[derive(Deserialize)]
        struct Resp {
            tracks: Paging<SpotifyTrack>,
        }
        let url = Url::parse_with_params(&format!("{}/search", self.api), [("type", "track"), ("q", query), ("limit", "10")])?;
        let r: Resp = self.get(url.as_str()).await?;
        Ok(r.tracks.items.into_iter().filter_map(SpotifyTrack::into_track).collect())
    }

    async fn resolve(&self, track: &Track) -> Result<Option<Track>> {
        if let Some(isrc) = &track.isrc
            && let Some(hit) = best_match(track, &self.search(&format!("isrc:{isrc}")).await?)
        {
            return Ok(Some(hit.clone()));
        }
        let found = self.search(&format!("{} {}", normalize(&track.title), primary_artist(&track.artist))).await?;
        Ok(best_match(track, &found).cloned())
    }

    async fn write_playlist(&self, name: &str, tracks: &[Track]) -> Result<String> {
        #[derive(Deserialize)]
        struct Created {
            id: String,
        }
        let created: Created = self.oauth.json(Method::POST, &format!("{}/me/playlists", self.api), Some(&json!({ "name": name, "public": false }))).await?;
        let uris: Vec<String> = tracks.iter().filter_map(|t| t.ids.get(&Source::Spotify)).map(|id| format!("spotify:track:{id}")).collect();
        for chunk in uris.chunks(100) {
            let _: serde_json::Value = self
                .oauth
                .json(Method::POST, &format!("{}/playlists/{}/items", self.api, created.id), Some(&json!({ "uris": chunk })))
                .await?;
        }
        Ok(created.id)
    }
}

/// Spotify Connect device (desktop app, phone, speaker).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct Device {
    pub id: Option<String>,
    pub name: String,
    pub is_active: bool,
}

/// What the active device plays, shaped for the player bar.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playback {
    pub playing: bool,
    pub position_ms: u64,
    pub duration_ms: Option<u64>,
    pub track_id: Option<String>,
    pub device: Option<String>,
}

/// Remote control of the user's own Spotify app. Audio never passes through us.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PlayerCommand {
    #[serde(rename_all = "camelCase")]
    Play {
        track_id: String,
    },
    Pause,
    Resume,
    Next,
    Previous,
    Seek {
        ms: u64,
    },
    Volume {
        percent: u8,
    },
}

const NO_DEVICE: &str = "Open Spotify on a device (computer, phone or speaker), then try again";

/// Player API errors → what the user can do about them.
fn player_error(e: anyhow::Error) -> anyhow::Error {
    let s = e.to_string();
    if s.contains("PREMIUM_REQUIRED") {
        anyhow!("Spotify playback needs a Premium account")
    } else if s.contains("NO_ACTIVE_DEVICE") || s.contains("404") {
        anyhow!(NO_DEVICE)
    } else if s.contains("Insufficient client scope") || s.contains("401") {
        anyhow!("Reconnect Spotify to allow playback control")
    } else {
        e
    }
}

impl Spotify {
    async fn player(&self, method: Method, path: &str, params: &[(&str, &str)], body: Option<&serde_json::Value>) -> Result<()> {
        let base = format!("{}/me/player{path}", self.api);
        let url = if params.is_empty() { Url::parse(&base)? } else { Url::parse_with_params(&base, params)? };
        self.oauth.json::<serde_json::Value>(method, url.as_str(), body).await.map(|_| ()).map_err(player_error)
    }

    pub async fn devices(&self) -> Result<Vec<Device>> {
        #[derive(Deserialize)]
        struct List {
            devices: Vec<Device>,
        }
        Ok(self.get::<List>(&format!("{}/me/player/devices", self.api)).await.map_err(player_error)?.devices)
    }

    /// None = nothing playing anywhere (204).
    pub async fn playback(&self) -> Result<Option<Playback>> {
        #[derive(Deserialize)]
        struct Raw {
            is_playing: bool,
            progress_ms: Option<u64>,
            item: Option<Item>,
            device: Option<Device>,
        }
        #[derive(Deserialize)]
        struct Item {
            id: Option<String>,
            duration_ms: Option<u64>,
        }
        let raw: Option<Raw> = self.get(&format!("{}/me/player", self.api)).await.map_err(player_error)?;
        Ok(raw.map(|r| Playback {
            playing: r.is_playing,
            position_ms: r.progress_ms.unwrap_or(0),
            duration_ms: r.item.as_ref().and_then(|i| i.duration_ms),
            track_id: r.item.and_then(|i| i.id),
            device: r.device.map(|d| d.name),
        }))
    }

    pub async fn command(&self, cmd: PlayerCommand) -> Result<()> {
        match cmd {
            PlayerCommand::Play { track_id } => {
                // Trust boundary: base62 track id only, goes into a URI.
                ensure!(track_id.len() == 22 && track_id.bytes().all(|b| b.is_ascii_alphanumeric()), "Bad Spotify track id");
                // Active device first, else wake the first one listed.
                let devices = self.devices().await?;
                let device = devices.iter().find(|d| d.is_active).or(devices.first()).and_then(|d| d.id.clone()).context(NO_DEVICE)?;
                self.player(Method::PUT, "/play", &[("device_id", &device)], Some(&json!({ "uris": [format!("spotify:track:{track_id}")] }))).await
            }
            PlayerCommand::Pause => self.player(Method::PUT, "/pause", &[], None).await,
            PlayerCommand::Resume => self.player(Method::PUT, "/play", &[], None).await,
            PlayerCommand::Next => self.player(Method::POST, "/next", &[], None).await,
            PlayerCommand::Previous => self.player(Method::POST, "/previous", &[], None).await,
            PlayerCommand::Seek { ms } => self.player(Method::PUT, "/seek", &[("position_ms", &ms.to_string())], None).await,
            PlayerCommand::Volume { percent } => self.player(Method::PUT, "/volume", &[("volume_percent", &percent.min(100).to_string())], None).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oauth::tests::{no_open, valid_store};
    use mockito::{Matcher, Server};

    fn track_json(id: &str, name: &str, artist: &str, isrc: Option<&str>) -> serde_json::Value {
        json!({ "id": id, "type": "track", "name": name, "artists": [{ "name": artist }], "album": { "name": "Album", "images": [{ "url": format!("https://i.scdn.co/image/{id}") }] },
                "duration_ms": 200_000, "external_ids": isrc.map(|i| json!({ "isrc": i })).unwrap_or(json!({})) })
    }

    fn spotify(server: &Server) -> Spotify {
        Spotify::with_urls("CID", valid_store("spotify"), no_open(), &server.url(), &server.url())
    }

    const TRACK: &str = "4uLU6hMCjMI75M1A2tKUQC";

    #[tokio::test]
    async fn play_wakes_first_device_when_none_active() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/me/player/devices").with_body(r#"{"devices":[{"id":"pc","name":"PC","is_active":false},{"id":"phone","name":"Phone","is_active":false}]}"#).create_async().await;
        let play = s
            .mock("PUT", "/me/player/play")
            .match_query(Matcher::UrlEncoded("device_id".into(), "pc".into()))
            .match_body(Matcher::Json(json!({ "uris": [format!("spotify:track:{TRACK}")] })))
            .with_status(204)
            .create_async()
            .await;
        spotify(&s).command(PlayerCommand::Play { track_id: TRACK.into() }).await.unwrap();
        play.assert_async().await;
        assert!(spotify(&s).command(PlayerCommand::Play { track_id: "../me".into() }).await.is_err());
    }

    #[tokio::test]
    async fn explains_player_errors() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/me/player/devices").with_body(r#"{"devices":[]}"#).create_async().await;
        s.mock("PUT", "/me/player/pause").with_status(403).with_body(r#"{"error":{"status":403,"message":"Player command failed: Premium required","reason":"PREMIUM_REQUIRED"}}"#).create_async().await;
        let err = |r: Result<()>| r.unwrap_err().to_string();
        assert!(err(spotify(&s).command(PlayerCommand::Play { track_id: TRACK.into() }).await).contains("Open Spotify"));
        let e = err(spotify(&s).command(PlayerCommand::Pause).await);
        assert!(e.contains("Premium"), "{e}");
    }

    #[tokio::test]
    async fn reads_playback_state() {
        let mut s = Server::new_async().await;
        let m = s.mock("GET", "/me/player").with_status(204).create_async().await;
        assert_eq!(spotify(&s).playback().await.unwrap(), None);
        m.remove_async().await;
        s.mock("GET", "/me/player").with_body(json!({ "is_playing": true, "progress_ms": 1200, "item": { "id": TRACK, "duration_ms": 200_000 }, "device": { "id": "pc", "name": "PC", "is_active": true } }).to_string()).create_async().await;
        assert_eq!(
            spotify(&s).playback().await.unwrap(),
            Some(Playback { playing: true, position_ms: 1200, duration_ms: Some(200_000), track_id: Some(TRACK.into()), device: Some("PC".into()) })
        );
    }

    #[tokio::test]
    async fn lists_owned_and_collab_playlists_with_paging() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/me").with_body(r#"{"id":"me"}"#).create_async().await;
        let page2 = format!("{}/me/playlists?offset=50&limit=50", s.url());
        s.mock("GET", "/me/playlists")
            .match_query(Matcher::UrlEncoded("offset".into(), "50".into()))
            .with_body(json!({ "items": [{ "id": "c", "name": "Collab", "owner": { "id": "bob" }, "collaborative": true }], "next": null }).to_string())
            .create_async()
            .await;
        s.mock("GET", "/me/playlists")
            .match_query(Matcher::Exact("limit=50".into()))
            .with_body(
                json!({ "items": [
                    { "id": "a", "name": "Mine", "owner": { "id": "me" }, "collaborative": false },
                    { "id": "b", "name": "Followed", "owner": { "id": "bob" }, "collaborative": false }
                ], "next": page2 })
                .to_string(),
            )
            .create_async()
            .await;
        let names: Vec<_> = spotify(&s).list_playlists().await.unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, ["Mine", "Collab"]);
    }

    #[tokio::test]
    async fn reads_items_skipping_episodes_and_local_files() {
        let mut s = Server::new_async().await;
        let mut episode = track_json("3", "Pod", "C", None);
        episode["type"] = json!("episode");
        episode.as_object_mut().unwrap().remove("artists");
        let mut local = track_json("4", "Local", "D", None);
        local["is_local"] = json!(true);
        s.mock("GET", "/playlists/p1/items")
            .match_query(Matcher::Any)
            .with_body(
                json!({ "items": [
                    { "item": track_json("1", "One", "A", Some("usabc1234567")) },
                    { "track": track_json("2", "Two", "B", None) },
                    { "item": episode }, { "item": local }, { "item": null }
                ], "next": null })
                .to_string(),
            )
            .create_async()
            .await;
        let tracks = spotify(&s).playlist_tracks("p1").await.unwrap();
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0].isrc.as_deref(), Some("USABC1234567"));
        assert_eq!(tracks[0].art.as_deref(), Some("https://i.scdn.co/image/1"));
        assert_eq!(tracks[1].ids[&Source::Spotify], "2");
    }

    #[tokio::test]
    async fn resolve_tries_isrc_then_title_artist() {
        let mut s = Server::new_async().await;
        let isrc = s
            .mock("GET", "/search")
            .match_query(Matcher::AllOf(vec![Matcher::UrlEncoded("q".into(), "isrc:USQX91300108".into()), Matcher::UrlEncoded("limit".into(), "10".into())]))
            .with_body(json!({ "tracks": { "items": [], "next": null } }).to_string())
            .create_async()
            .await;
        s.mock("GET", "/search")
            .match_query(Matcher::UrlEncoded("q".into(), "get lucky daft punk".into()))
            .with_body(json!({ "tracks": { "items": [track_json("9", "Get Lucky", "Daft Punk", None)], "next": null } }).to_string())
            .create_async()
            .await;
        let yt = Track {
            title: "Get Lucky (Official Audio)".into(),
            artist: "Daft Punk".into(),
            duration_ms: Some(205_000),
            isrc: Some("USQX91300108".into()),
            ..Default::default()
        };
        let hit = spotify(&s).resolve(&yt).await.unwrap().unwrap();
        assert_eq!(hit.ids[&Source::Spotify], "9");
        isrc.assert_async().await;
    }

    #[tokio::test]
    async fn write_playlist_batches_by_100() {
        let mut s = Server::new_async().await;
        s.mock("POST", "/me/playlists")
            .match_body(Matcher::Json(json!({ "name": "Copie", "public": false })))
            .with_body(r#"{"id":"new"}"#)
            .create_async()
            .await;
        let first = s
            .mock("POST", "/playlists/new/items")
            .match_body(Matcher::Regex(r#"spotify:track:s0".*spotify:track:s99""#.into()))
            .with_status(201)
            .with_body(r#"{"snapshot_id":"x"}"#)
            .expect(1)
            .create_async()
            .await;
        let second = s
            .mock("POST", "/playlists/new/items")
            .match_body(Matcher::Regex(r#"^\{"uris":\["spotify:track:s100".*s149"\]\}$"#.into()))
            .with_status(201)
            .with_body(r#"{"snapshot_id":"y"}"#)
            .expect(1)
            .create_async()
            .await;
        let mut tracks: Vec<Track> = (0..150)
            .map(|i| Track { ids: BTreeMap::from([(Source::Spotify, format!("s{i}"))]), ..Default::default() })
            .collect();
        tracks.push(Track { ids: BTreeMap::from([(Source::Youtube, "v".into())]), ..Default::default() });
        assert_eq!(spotify(&s).write_playlist("Copie", &tracks).await.unwrap(), "new");
        first.assert_async().await;
        second.assert_async().await;
    }

    #[tokio::test]
    async fn surfaces_api_errors() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/me").with_status(403).with_body("forbidden").create_async().await;
        assert!(spotify(&s).list_playlists().await.unwrap_err().to_string().contains("403"));
    }
}
