use crate::oauth::{OAuthClient, OAuthConfig, Opener};
use anyhow::Result;
use async_trait::async_trait;
use music_core::matching::best_match;
use music_core::model::{Connector, PlaylistRef, SecretStore, Source, Track};
use regex::Regex;
use reqwest::Method;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::json;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, LazyLock};
use url::Url;

static TOPIC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.+) - Topic$").unwrap());
static DASH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.+?)\s+[-–—]\s+(.+)$").unwrap());
static CHANNEL_NOISE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\s*VEVO$|\s*-?\s*Official$").unwrap());
static ISO_DURATION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$").unwrap());

/// Guess (artist, title). "X - Topic" channel = clean metadata; else "Artist - Title"; else channel.
pub fn parse_video(title: &str, channel: &str) -> (String, String) {
    if let Some(c) = TOPIC.captures(channel) {
        return (c[1].to_string(), title.to_string());
    }
    if let Some(c) = DASH.captures(title) {
        return (c[1].to_string(), c[2].to_string());
    }
    (CHANNEL_NOISE.replace_all(channel, "").into_owned(), title.to_string())
}

/// ISO 8601 "PT1H2M3S" → ms.
pub fn parse_duration(iso: &str) -> Option<u32> {
    let c = ISO_DURATION.captures(iso)?;
    let n = |i| c.get(i).map_or(0, |m| m.as_str().parse::<u32>().unwrap_or(0));
    Some(((n(1) * 60 + n(2)) * 60 + n(3)) * 1000)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Page<T> {
    items: Vec<T>,
    next_page_token: Option<String>,
}

/// YouTube Data API v3. Quota: 10k units/day shared (list = 1, insert = 50); search.list own bucket, 100 calls/day.
/// Google Desktop OAuth client = user's own client id + secret ("bring your key").
pub struct YouTube {
    oauth: OAuthClient,
    api: String,
}

impl YouTube {
    pub fn new(client_id: &str, client_secret: &str, store: Arc<dyn SecretStore>, open: Opener) -> Self {
        Self::with_urls(client_id, client_secret, store, open, "https://www.googleapis.com/youtube/v3", "https://accounts.google.com/o/oauth2/v2/auth", "https://oauth2.googleapis.com/token")
    }

    pub fn with_urls(client_id: &str, client_secret: &str, store: Arc<dyn SecretStore>, open: Opener, api: &str, auth: &str, token: &str) -> Self {
        let cfg = OAuthConfig {
            key: "youtube",
            auth_url: auth.into(),
            token_url: token.into(),
            client_id: client_id.into(),
            client_secret: Some(client_secret.into()),
            scope: "https://www.googleapis.com/auth/youtube",
            // offline + consent = refresh token every time.
            extra_auth_params: &[("access_type", "offline"), ("prompt", "consent")],
        };
        Self { oauth: OAuthClient::new(cfg, store, open), api: api.into() }
    }

    async fn get<T: DeserializeOwned>(&self, path: &str, params: &[(&str, &str)]) -> Result<T> {
        let url = Url::parse_with_params(&format!("{}/{path}", self.api), params)?;
        self.oauth.json(Method::GET, url.as_str(), None).await
    }

    async fn all<T: DeserializeOwned>(&self, path: &str, params: &[(&str, &str)]) -> Result<Vec<T>> {
        let mut out = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let mut p = params.to_vec();
            p.push(("maxResults", "50"));
            if let Some(t) = &token {
                p.push(("pageToken", t));
            }
            let page: Page<T> = self.get(path, &p).await?;
            out.extend(page.items);
            token = page.next_page_token;
            if token.is_none() {
                return Ok(out);
            }
        }
    }

    async fn durations(&self, ids: &[String]) -> Result<HashMap<String, u32>> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Video {
            id: String,
            content_details: Details,
        }
        #[derive(Deserialize)]
        struct Details {
            duration: String,
        }
        let mut out = HashMap::new();
        for chunk in ids.chunks(50) {
            let page: Page<Video> = self.get("videos", &[("part", "contentDetails"), ("id", &chunk.join(","))]).await?;
            out.extend(page.items.into_iter().filter_map(|v| Some((v.id, parse_duration(&v.content_details.duration)?))));
        }
        Ok(out)
    }
}

fn video_track(title: &str, channel: &str, video_id: String, duration_ms: Option<u32>) -> Track {
    let (artist, title) = parse_video(title, channel);
    Track { title, artist, duration_ms, ids: BTreeMap::from([(Source::Youtube, video_id)]), ..Default::default() }
}

#[async_trait]
impl Connector for YouTube {
    fn source(&self) -> Source {
        Source::Youtube
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
        struct Playlist {
            id: String,
            snippet: Title,
        }
        #[derive(Deserialize)]
        struct Title {
            title: String,
        }
        let lists: Vec<Playlist> = self.all("playlists", &[("part", "snippet"), ("mine", "true")]).await?;
        Ok(lists.into_iter().map(|p| PlaylistRef { id: p.id, name: p.snippet.title }).collect())
    }

    async fn playlist_tracks(&self, playlist_id: &str) -> Result<Vec<Track>> {
        #[derive(Deserialize)]
        struct Item {
            snippet: Snippet,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Snippet {
            title: String,
            video_owner_channel_title: Option<String>,
            resource_id: Resource,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Resource {
            video_id: String,
        }
        let items: Vec<Item> = self.all("playlistItems", &[("part", "snippet"), ("playlistId", playlist_id)]).await?;
        // Deleted/private videos have no owner channel. Skip.
        let videos: Vec<Snippet> = items.into_iter().map(|i| i.snippet).filter(|s| s.video_owner_channel_title.is_some()).collect();
        let durations = self.durations(&videos.iter().map(|v| v.resource_id.video_id.clone()).collect::<Vec<_>>()).await?;
        Ok(videos
            .into_iter()
            .map(|s| {
                let ms = durations.get(&s.resource_id.video_id).copied();
                video_track(&s.title, s.video_owner_channel_title.as_deref().unwrap_or_default(), s.resource_id.video_id, ms)
            })
            .collect())
    }

    /// Costs 1 of 100 daily search calls. No duration (would cost videos.list).
    async fn search(&self, query: &str) -> Result<Vec<Track>> {
        #[derive(Deserialize)]
        struct Hit {
            id: VideoId,
            snippet: Snippet,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct VideoId {
            video_id: String,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Snippet {
            title: String,
            channel_title: String,
        }
        let params = [("part", "snippet"), ("type", "video"), ("videoCategoryId", "10"), ("maxResults", "10"), ("q", query)];
        let page: Page<Hit> = self.get("search", &params).await?;
        Ok(page.items.into_iter().map(|h| video_track(&h.snippet.title, &h.snippet.channel_title, h.id.video_id, None)).collect())
    }

    async fn resolve(&self, track: &Track) -> Result<Option<Track>> {
        let found = self.search(&format!("{} {}", track.artist, track.title)).await?;
        Ok(best_match(track, &found).cloned())
    }

    /// 50 units per insert: ~190 tracks/day max.
    async fn write_playlist(&self, name: &str, tracks: &[Track]) -> Result<String> {
        #[derive(Deserialize)]
        struct Created {
            id: String,
        }
        let body = json!({ "snippet": { "title": name }, "status": { "privacyStatus": "private" } });
        let created: Created = self.oauth.json(Method::POST, &format!("{}/playlists?part=snippet,status", self.api), Some(&body)).await?;
        for video_id in tracks.iter().filter_map(|t| t.ids.get(&Source::Youtube)) {
            let item = json!({ "snippet": { "playlistId": created.id, "resourceId": { "kind": "youtube#video", "videoId": video_id } } });
            let _: serde_json::Value = self.oauth.json(Method::POST, &format!("{}/playlistItems?part=snippet", self.api), Some(&item)).await?;
        }
        Ok(created.id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oauth::tests::{no_open, valid_store};
    use mockito::{Matcher, Server};

    fn yt(s: &Server) -> YouTube {
        YouTube::with_urls("CID", "SECRET", valid_store("youtube"), no_open(), &s.url(), &s.url(), &s.url())
    }

    #[test]
    fn parses_video_titles() {
        for (title, channel, artist, out) in [
            ("Get Lucky", "Daft Punk - Topic", "Daft Punk", "Get Lucky"),
            ("Daft Punk - Get Lucky (Official Audio) ft. Pharrell Williams", "DaftPunkVEVO", "Daft Punk", "Get Lucky (Official Audio) ft. Pharrell Williams"),
            ("Stromae – Alors on danse", "stromae", "Stromae", "Alors on danse"),
            ("Hello", "AdeleVEVO", "Adele", "Hello"),
            ("Bad Guy", "Billie Eilish Official", "Billie Eilish", "Bad Guy"),
        ] {
            assert_eq!(parse_video(title, channel), (artist.to_string(), out.to_string()), "{title}");
        }
    }

    #[test]
    fn parses_durations() {
        assert_eq!(parse_duration("PT4M8S"), Some(248_000));
        assert_eq!(parse_duration("PT1H0M1S"), Some(3_601_000));
        assert_eq!(parse_duration("PT45S"), Some(45_000));
        assert_eq!(parse_duration("P1D"), None);
    }

    #[tokio::test]
    async fn lists_playlists_with_page_token() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/playlists")
            .match_query(Matcher::UrlEncoded("pageToken".into(), "n".into()))
            .with_body(r#"{"items":[{"id":"PL2","snippet":{"title":"B"}}]}"#)
            .create_async()
            .await;
        s.mock("GET", "/playlists")
            .match_query(Matcher::UrlEncoded("mine".into(), "true".into()))
            .with_body(r#"{"items":[{"id":"PL1","snippet":{"title":"A"}}],"nextPageToken":"n"}"#)
            .create_async()
            .await;
        let names: Vec<_> = yt(&s).list_playlists().await.unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, ["A", "B"]);
    }

    #[tokio::test]
    async fn reads_playlist_skips_deleted_adds_durations() {
        let mut s = Server::new_async().await;
        let item = |id: &str, title: &str, channel: Option<&str>| json!({ "snippet": { "title": title, "videoOwnerChannelTitle": channel, "resourceId": { "videoId": id } } });
        s.mock("GET", "/playlistItems")
            .match_query(Matcher::Any)
            .with_body(json!({ "items": [item("v1", "Get Lucky", Some("Daft Punk - Topic")), item("v2", "Deleted video", None), item("v3", "Adele - Hello", Some("AdeleVEVO"))] }).to_string())
            .create_async()
            .await;
        s.mock("GET", "/videos")
            .match_query(Matcher::UrlEncoded("id".into(), "v1,v3".into()))
            .with_body(r#"{"items":[{"id":"v1","contentDetails":{"duration":"PT4M8S"}},{"id":"v3","contentDetails":{"duration":"PT6M7S"}}]}"#)
            .create_async()
            .await;
        let tracks = yt(&s).playlist_tracks("PL1").await.unwrap();
        let got: Vec<_> = tracks.iter().map(|t| (t.artist.as_str(), t.title.as_str(), t.duration_ms)).collect();
        assert_eq!(got, [("Daft Punk", "Get Lucky", Some(248_000)), ("Adele", "Hello", Some(367_000))]);
    }

    #[tokio::test]
    async fn write_playlist_private_then_one_insert_per_video() {
        let mut s = Server::new_async().await;
        s.mock("POST", "/playlists")
            .match_query(Matcher::Any)
            .match_body(Matcher::PartialJson(json!({ "status": { "privacyStatus": "private" } })))
            .with_body(r#"{"id":"PLNEW"}"#)
            .create_async()
            .await;
        let insert = s
            .mock("POST", "/playlistItems")
            .match_query(Matcher::Any)
            .match_body(Matcher::PartialJson(json!({ "snippet": { "playlistId": "PLNEW", "resourceId": { "videoId": "v1" } } })))
            .with_body("{}")
            .expect(1)
            .create_async()
            .await;
        let tracks = [
            Track { ids: BTreeMap::from([(Source::Youtube, "v1".into())]), ..Default::default() },
            Track { ids: BTreeMap::from([(Source::Spotify, "s".into())]), ..Default::default() },
        ];
        assert_eq!(yt(&s).write_playlist("Copie", &tracks).await.unwrap(), "PLNEW");
        insert.assert_async().await;
    }

    #[tokio::test]
    async fn resolve_searches_music_category() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/search")
            .match_query(Matcher::UrlEncoded("videoCategoryId".into(), "10".into()))
            .with_body(r#"{"items":[{"id":{"videoId":"v9"},"snippet":{"title":"Hello","channelTitle":"Adele - Topic"}}]}"#)
            .create_async()
            .await;
        let q = Track { title: "Hello".into(), artist: "Adele".into(), ..Default::default() };
        assert_eq!(yt(&s).resolve(&q).await.unwrap().unwrap().ids[&Source::Youtube], "v9");
    }
}
