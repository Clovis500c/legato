//! YouTube Music's home: its recommendation shelves (Quick picks, Listen again, Mixed for you…), and the songs behind
//! a playlist, album or radio there, to play without importing anything. An artist's page: same shelves.

use super::{ARTISTS, YouTubeMusic, all, big_thumb, page_type, parse_duration, row_track, row_track_with, text};
use anyhow::Result;
use music_core::matching::normalize;
use music_core::model::{Source, Track};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashSet};

/// Shelves after the first page: two more pages at most.
const MORE_PAGES: usize = 2;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shelf {
    pub title: String,
    pub items: Vec<HomeItem>,
}

/// Home page: its shelves, and the mood chips above them (Relax, Energize, Focus…) that filter it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Home {
    pub shelves: Vec<Shelf>,
    pub moods: Vec<Mood>,
}

/// A chip over the home: `params` asks the home filtered to it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mood {
    pub title: String,
    pub params: String,
}

/// Params from YouTube's own chips: base64 (URL-safe too), bounded.
pub fn valid_mood(params: &str) -> bool {
    !params.is_empty() && params.len() <= 400 && params.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_=%+/".contains(&b))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeItem {
    pub title: String,
    pub subtitle: String,
    pub art: Option<String>,
    /// Song or video: plays as is.
    pub track: Option<Track>,
    /// Playlist, album or radio: its songs come from `YouTubeMusic::list_tracks`.
    pub list: Option<ListRef>,
}

/// An artist's page: top songs (every song behind `all_songs`, a playlist), then its shelves (albums, singles, videos,
/// playlists it's featured on, its own playlists).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artist {
    pub name: String,
    pub art: Option<String>,
    pub songs: Vec<Track>,
    pub all_songs: Option<ListRef>,
    pub shelves: Vec<Shelf>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ListRef {
    /// Playlist (VL…) or album (MPRE…) page.
    Browse { id: String },
    /// Radio or mix (RD…), from a song when there is one.
    Radio { video_id: Option<String>, playlist_id: String },
}

impl ListRef {
    /// Ids only from YouTube's own pages: letters, digits, - and _.
    pub fn valid(&self) -> bool {
        let ok = |s: &str| !s.is_empty() && s.len() <= 80 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        match self {
            ListRef::Browse { id } => ok(id) && (id.starts_with("VL") || id.starts_with("MPRE")),
            ListRef::Radio { video_id, playlist_id } => ok(playlist_id) && video_id.as_deref().is_none_or(ok),
        }
    }

    pub fn key(&self) -> String {
        match self {
            ListRef::Browse { id } => id.clone(),
            ListRef::Radio { video_id, playlist_id } => format!("{playlist_id}/{}", video_id.as_deref().unwrap_or("")),
        }
    }
}

const LABELS: [&str; 11] = ["Song", "Video", "Single", "Album", "EP", "Playlist", "Episode", " • ", " & ", ", ", " and "];

/// Artist in a subtitle or byline ("Song • Artist • Album", "Artist • 2M views"): linked artists, else the first plain
/// run that isn't a label, a count or a length.
fn artist_of(runs: Option<&Value>) -> String {
    let runs: Vec<&Value> = runs.and_then(|s| s.get("runs")?.as_array()).map(|r| r.iter().collect()).unwrap_or_default();
    let linked: Vec<&str> = runs.iter().filter(|r| matches!(page_type(r), "MUSIC_PAGE_TYPE_ARTIST" | "MUSIC_PAGE_TYPE_USER_CHANNEL")).filter_map(|r| r.get("text")?.as_str()).collect();
    if !linked.is_empty() {
        return linked.join(", ");
    }
    runs.iter().filter_map(|r| r.get("text")?.as_str()).find(|t| !LABELS.contains(t) && !t.contains(" views") && !t.contains(" plays") && parse_duration(t).is_none() && t.parse::<u32>().is_err()).unwrap_or("").to_string()
}

fn album_of(runs: Option<&Value>) -> Option<String> {
    runs?.get("runs")?.as_array()?.iter().find(|r| page_type(r) == "MUSIC_PAGE_TYPE_ALBUM").and_then(|r| r.get("text")?.as_str().map(String::from))
}

fn last_thumb(v: Option<&Value>) -> Option<String> {
    all(v?, "thumbnails").into_iter().filter_map(Value::as_array).flatten().last().and_then(|t| t.get("url")?.as_str()).map(big_thumb)
}

/// Card in a shelf: song or video to play, playlist / album / radio to open. Artists: nothing to play, skipped.
fn card(item: &Value) -> Option<HomeItem> {
    let title = item.get("title").and_then(text)?;
    let subtitle = item.get("subtitle").and_then(text).unwrap_or_default();
    let art = last_thumb(item.get("thumbnailRenderer"));
    let nav = item.get("navigationEndpoint")?;
    if let Some(w) = nav.get("watchEndpoint") {
        let video = w.get("videoId").and_then(Value::as_str).map(String::from);
        if let Some(pl) = w.get("playlistId").and_then(Value::as_str).filter(|p| p.starts_with("RD")) {
            return Some(HomeItem { title, subtitle, art, track: None, list: Some(ListRef::Radio { video_id: video, playlist_id: pl.into() }) });
        }
        let artist = artist_of(item.get("subtitle"));
        let track = Track { title: title.clone(), artist, album: album_of(item.get("subtitle")), duration_ms: None, isrc: None, ids: BTreeMap::from([(Source::Youtube, video?)]), art: art.clone(), musicness: None };
        return Some(HomeItem { title, subtitle, art, track: Some(track), list: None });
    }
    if let Some(pl) = nav.pointer("/watchPlaylistEndpoint/playlistId").and_then(Value::as_str) {
        return Some(HomeItem { title, subtitle, art, track: None, list: Some(ListRef::Radio { video_id: None, playlist_id: pl.into() }) });
    }
    let id = nav.pointer("/browseEndpoint/browseId")?.as_str()?;
    (id.starts_with("VL") || id.starts_with("MPRE")).then(|| HomeItem { title, subtitle, art, track: None, list: Some(ListRef::Browse { id: id.into() }) })
}

/// Row in a shelf (Quick picks): a song.
fn row_card(row: &Value) -> Option<HomeItem> {
    let t = row_track(row)?;
    Some(HomeItem { title: t.title.clone(), subtitle: t.artist.clone(), art: t.art.clone(), track: Some(t), list: None })
}

fn shelves(v: &Value) -> Vec<Shelf> {
    all(v, "musicCarouselShelfRenderer")
        .into_iter()
        .filter_map(|s| {
            let title = s.pointer("/header/musicCarouselShelfBasicHeaderRenderer/title").and_then(text)?;
            let items: Vec<HomeItem> = s.get("contents")?.as_array()?.iter().filter_map(|c| c.get("musicTwoRowItemRenderer").and_then(card).or_else(|| c.get("musicResponsiveListItemRenderer").and_then(row_card))).collect();
            (!items.is_empty()).then_some(Shelf { title, items })
        })
        .collect()
}

/// Chips that reload the home with a filter.
fn moods(v: &Value) -> Vec<Mood> {
    all(v, "chipCloudChipRenderer")
        .into_iter()
        .filter_map(|c| {
            let ep = c.pointer("/navigationEndpoint/browseEndpoint")?;
            (ep.get("browseId")?.as_str()? == "FEmusic_home").then_some(())?;
            let params = ep.get("params")?.as_str()?;
            valid_mood(params).then(|| Some(Mood { title: c.get("text").and_then(text)?, params: params.into() }))?
        })
        .collect()
}

/// Next page of shelves: the section list's own continuation (not a shelf's).
fn more(v: &Value) -> Option<String> {
    let list = all(v, "sectionListRenderer").into_iter().chain(all(v, "sectionListContinuation")).next()?;
    all(list.get("continuations")?, "continuation").into_iter().find_map(|c| c.as_str().map(String::from))
}

/// Songs of a radio's queue panel.
fn panel_tracks(v: &Value) -> Vec<Track> {
    let mut seen = HashSet::new();
    all(v, "playlistPanelVideoRenderer")
        .into_iter()
        .filter_map(|p| {
            let video = p.get("videoId")?.as_str()?.to_string();
            let title = p.get("title").and_then(text)?;
            let byline = p.get("longBylineText").or_else(|| p.get("shortBylineText"));
            let duration_ms = p.get("lengthText").and_then(text).and_then(|t| parse_duration(&t));
            Some(Track { title, artist: artist_of(byline), album: album_of(byline), duration_ms, isrc: None, ids: BTreeMap::from([(Source::Youtube, video)]), art: last_thumb(p.get("thumbnail")), musicness: None })
        })
        .filter(|t| seen.insert(t.ids[&Source::Youtube].clone()))
        .collect()
}

/// Album page: rows carry neither artist nor cover, the header does.
fn album_tracks(page: &Value) -> Vec<Track> {
    let header = all(page, "musicResponsiveHeaderRenderer").into_iter().chain(all(page, "musicDetailHeaderRenderer")).next();
    let album = header.and_then(|h| h.get("title")).and_then(text);
    let artist = header.map(|h| artist_of(h.get("straplineTextOne").or_else(|| h.get("subtitle")))).unwrap_or_default();
    let art = header.and_then(|h| last_thumb(h.get("thumbnail")));
    all(page, "musicResponsiveListItemRenderer")
        .into_iter()
        .filter_map(|r| row_track_with(r, Some(&artist)))
        .map(|mut t| {
            t.album = t.album.or_else(|| album.clone());
            t.art = t.art.or_else(|| art.clone());
            t
        })
        .collect()
}

/// Channel of the artist with this very name (case, accents, punctuation aside) in an artists search.
fn artist_id(found: &Value, name: &str) -> Option<String> {
    let want = normalize(name);
    all(found, "musicResponsiveListItemRenderer").into_iter().find_map(|r| {
        let id = r.pointer("/navigationEndpoint/browseEndpoint/browseId")?.as_str()?;
        let title = r.pointer("/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/text").and_then(text)?;
        (id.starts_with("UC") && normalize(&title) == want).then(|| id.to_string())
    })
}

/// Artist channel page: header, "Top songs" (rows, its "Show all" playlist), carousels.
fn artist_page(page: &Value) -> Option<Artist> {
    let header = all(page, "musicImmersiveHeaderRenderer").into_iter().chain(all(page, "musicVisualHeaderRenderer")).next()?;
    let name = header.get("title").and_then(text)?;
    let top = all(page, "musicShelfRenderer").into_iter().next();
    let songs = top.map(|s| all(s, "musicResponsiveListItemRenderer").into_iter().filter_map(|r| row_track_with(r, Some(&name))).collect()).unwrap_or_default();
    let all_songs = top
        .and_then(|s| s.pointer("/bottomEndpoint/browseEndpoint/browseId").or_else(|| s.pointer("/title/runs/0/navigationEndpoint/browseEndpoint/browseId")))
        .and_then(Value::as_str)
        .map(|id| ListRef::Browse { id: id.into() })
        .filter(ListRef::valid);
    Some(Artist { name, art: last_thumb(header.get("thumbnail")), songs, all_songs, shelves: shelves(page) })
}

impl YouTubeMusic {
    /// An artist's page by name: the artists search's one with that very name. None: no such artist there.
    pub async fn artist(&self, name: &str) -> Result<Option<Artist>> {
        let found = self.call("search", json!({ "query": name, "params": ARTISTS })).await?;
        let Some(id) = artist_id(&found, name) else { return Ok(None) };
        Ok(artist_page(&self.call("browse", json!({ "browseId": id })).await?))
    }

    /// Home shelves, first page and a couple more; `mood` = a chip's params (the home filtered to it).
    pub async fn home(&self, mood: Option<&str>) -> Result<Home> {
        let mut body = json!({ "browseId": "FEmusic_home" });
        if let Some(m) = mood {
            body["params"] = json!(m);
        }
        let first = self.call("browse", body).await?;
        let moods = moods(&first);
        let mut out = shelves(&first);
        let mut token = more(&first);
        for _ in 0..MORE_PAGES {
            let Some(t) = token else { break };
            let next = self.call("browse", json!({ "continuation": t })).await?;
            out.extend(shelves(&next));
            token = more(&next);
        }
        Ok(Home { shelves: out, moods })
    }

    /// Songs of a home card's playlist, album or radio.
    pub async fn list_tracks(&self, list: &ListRef) -> Result<Vec<Track>> {
        match list {
            ListRef::Browse { id } if id.starts_with("MPRE") => Ok(album_tracks(&self.call("browse", json!({ "browseId": id })).await?)),
            ListRef::Browse { id } => self.browse_rows(id).await,
            ListRef::Radio { video_id, playlist_id } => {
                let mut body = json!({ "playlistId": playlist_id, "isAudioOnly": true, "enablePersistentPlaylistPanel": true });
                if let Some(v) = video_id {
                    body["videoId"] = json!(v);
                }
                Ok(panel_tracks(&self.call("next", body).await?))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(t: &str, page: Option<(&str, &str)>) -> Value {
        match page {
            Some((ty, id)) => json!({ "text": t, "navigationEndpoint": { "browseEndpoint": { "browseId": id, "browseEndpointContextSupportedConfigs": { "browseEndpointContextMusicConfig": { "pageType": ty } } } } }),
            None => json!({ "text": t }),
        }
    }

    fn thumb(url: &str) -> Value {
        json!({ "musicThumbnailRenderer": { "thumbnail": { "thumbnails": [{ "url": "https://lh3.googleusercontent.com/s=w60-h60" }, { "url": url }] } } })
    }

    #[test]
    fn reads_home_shelves() {
        let page = json!({ "contents": { "sectionListRenderer": {
            "contents": [
                { "musicCarouselShelfRenderer": {
                    "header": { "musicCarouselShelfBasicHeaderRenderer": { "title": { "runs": [{ "text": "Listen again" }] } } },
                    "contents": [
                        { "musicTwoRowItemRenderer": { "title": { "runs": [{ "text": "Get Lucky" }] }, "subtitle": { "runs": [run("Song", None), run(" • ", None), run("Daft Punk", Some(("MUSIC_PAGE_TYPE_ARTIST", "UC1")))] }, "thumbnailRenderer": thumb("https://lh3.googleusercontent.com/a=w226-h226"), "navigationEndpoint": { "watchEndpoint": { "videoId": "v1" } } } },
                        { "musicTwoRowItemRenderer": { "title": { "runs": [{ "text": "Chill Mix" }] }, "subtitle": { "runs": [run("Playlist", None)] }, "navigationEndpoint": { "browseEndpoint": { "browseId": "VLRDCLAK1" } } } },
                        { "musicTwoRowItemRenderer": { "title": { "runs": [{ "text": "Some Artist" }] }, "navigationEndpoint": { "browseEndpoint": { "browseId": "UC9" } } } },
                        { "musicTwoRowItemRenderer": { "title": { "runs": [{ "text": "My Supermix" }] }, "navigationEndpoint": { "watchPlaylistEndpoint": { "playlistId": "RDTMAK1" } } } }
                    ] } },
                { "musicCarouselShelfRenderer": {
                    "header": { "musicCarouselShelfBasicHeaderRenderer": { "title": { "runs": [{ "text": "Quick picks" }] } } },
                    "contents": [{ "musicResponsiveListItemRenderer": { "playlistItemData": { "videoId": "v2" }, "flexColumns": [
                        { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": "Intro" }] } } },
                        { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [run("The xx", Some(("MUSIC_PAGE_TYPE_ARTIST", "UC2")))] } } }
                    ] } }] } }
            ],
            "continuations": [{ "nextContinuationData": { "continuation": "NEXT" } }]
        } } });
        let s = shelves(&page);
        assert_eq!(s.iter().map(|x| x.title.as_str()).collect::<Vec<_>>(), ["Listen again", "Quick picks"]);
        let again = &s[0].items;
        assert_eq!(again.len(), 3, "artist card skipped");
        let song = again[0].track.as_ref().unwrap();
        assert_eq!((song.artist.as_str(), song.ids[&Source::Youtube].as_str(), song.art.as_deref()), ("Daft Punk", "v1", Some("https://lh3.googleusercontent.com/a=w544-h544")));
        assert_eq!(again[1].list, Some(ListRef::Browse { id: "VLRDCLAK1".into() }));
        assert_eq!(again[2].list, Some(ListRef::Radio { video_id: None, playlist_id: "RDTMAK1".into() }));
        assert_eq!(s[1].items[0].track.as_ref().unwrap().artist, "The xx");
        assert_eq!(more(&page).as_deref(), Some("NEXT"));
    }

    #[test]
    fn reads_mood_chips() {
        let chip = |t: &str, id: &str, params: &str| json!({ "chipCloudChipRenderer": { "text": { "runs": [{ "text": t }] }, "navigationEndpoint": { "browseEndpoint": { "browseId": id, "params": params } } } });
        let page = json!({ "header": { "chipCloudRenderer": { "chips": [chip("Relax", "FEmusic_home", "ggNCSg=="), chip("Focus", "FEmusic_home", "gg-_Nx"), chip("Charts", "FEmusic_charts", "x"), chip("Bad", "FEmusic_home", "a b"), json!({ "chipCloudChipRenderer": { "text": { "runs": [{ "text": "No params" }] } } })] } } });
        assert_eq!(moods(&page), [Mood { title: "Relax".into(), params: "ggNCSg==".into() }, Mood { title: "Focus".into(), params: "gg-_Nx".into() }]);
        assert!(!valid_mood("") && !valid_mood(&"a".repeat(401)) && !valid_mood("x\"
"));
        assert!(moods(&json!({ "chipCloudChipRenderer": 3 })).is_empty());
    }

    #[test]
    fn reads_radio_panel_and_album_page() {
        let panel = json!({ "contents": [
            { "playlistPanelVideoRenderer": { "videoId": "a", "title": { "runs": [{ "text": "One" }] }, "lengthText": { "runs": [{ "text": "3:05" }] }, "longBylineText": { "runs": [run("Muse", Some(("MUSIC_PAGE_TYPE_ARTIST", "UC3"))), run(" • ", None), run("Origin", Some(("MUSIC_PAGE_TYPE_ALBUM", "MPRE1"))), run(" • ", None), run("2001", None)] }, "thumbnail": { "thumbnails": [{ "url": "https://i.ytimg.com/vi/a/hqdefault.jpg" }] } } },
            { "playlistPanelVideoWrapperRenderer": { "primaryRenderer": { "playlistPanelVideoRenderer": { "videoId": "a", "title": { "runs": [{ "text": "One" }] } } } } },
            { "playlistPanelVideoRenderer": { "videoId": "b", "title": { "runs": [{ "text": "Two" }] }, "shortBylineText": { "runs": [{ "text": "Plain Channel" }] } } }
        ] });
        let t = panel_tracks(&panel);
        assert_eq!(t.len(), 2, "same video once");
        assert_eq!((t[0].artist.as_str(), t[0].album.as_deref(), t[0].duration_ms), ("Muse", Some("Origin"), Some(185_000)));
        assert_eq!(t[1].artist, "Plain Channel");

        let album = json!({
            "header": { "musicResponsiveHeaderRenderer": { "title": { "runs": [{ "text": "Discovery" }] }, "straplineTextOne": { "runs": [run("Daft Punk", Some(("MUSIC_PAGE_TYPE_ARTIST", "UC4")))] }, "thumbnail": thumb("https://lh3.googleusercontent.com/d=w544-h544") } },
            "rows": [{ "musicResponsiveListItemRenderer": { "playlistItemData": { "videoId": "c" }, "flexColumns": [
                { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": "One More Time" }] } } }
            ], "fixedColumns": [{ "musicResponsiveListItemFixedColumnRenderer": { "text": { "runs": [{ "text": "5:20" }] } } }] } }]
        });
        let t = album_tracks(&album);
        assert_eq!(t.len(), 1);
        assert_eq!((t[0].artist.as_str(), t[0].album.as_deref(), t[0].duration_ms), ("Daft Punk", Some("Discovery"), Some(320_000)));
        assert!(t[0].art.is_some());
    }

    #[test]
    fn reads_an_artist_page() {
        let row = |name: &str, id: &str| json!({ "musicResponsiveListItemRenderer": { "navigationEndpoint": { "browseEndpoint": { "browseId": id } }, "flexColumns": [{ "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": name }] } } }] } });
        let found = json!({ "contents": [row("Daft Punk Tribute", "UC1"), row("Daft Punk", "UC2"), row("Beyoncé", "UC3")] });
        assert_eq!(artist_id(&found, "daft punk").as_deref(), Some("UC2"));
        assert_eq!(artist_id(&found, "Beyonce").as_deref(), Some("UC3"));
        assert_eq!(artist_id(&found, "Daft"), None, "same name only");

        let col = |runs: Value| json!({ "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": runs } } });
        let song = json!({ "musicResponsiveListItemRenderer": { "playlistItemData": { "videoId": "k1" }, "flexColumns": [
            col(json!([{ "text": "Instant Crush" }])),
            col(json!([run("Daft Punk", Some(("MUSIC_PAGE_TYPE_ARTIST", "UC2"))), run(" & ", None), run("Julian Casablancas", Some(("MUSIC_PAGE_TYPE_ARTIST", "UC5")))])),
            col(json!([{ "text": "1.2B plays" }])),
            col(json!([run("Random Access Memories", Some(("MUSIC_PAGE_TYPE_ALBUM", "MPRE1")))]))
        ] } });
        let carousel = |title: &str, item: Value| json!({ "musicCarouselShelfRenderer": { "header": { "musicCarouselShelfBasicHeaderRenderer": { "title": { "runs": [{ "text": title }] } } }, "contents": [item] } });
        let card = |title: &str, id: &str| json!({ "musicTwoRowItemRenderer": { "title": { "runs": [{ "text": title }] }, "navigationEndpoint": { "browseEndpoint": { "browseId": id } } } });
        let page = json!({
            "header": { "musicImmersiveHeaderRenderer": { "title": { "runs": [{ "text": "Daft Punk" }] }, "thumbnail": thumb("https://lh3.googleusercontent.com/b=w540-h225-p-l90-rj") } },
            "contents": { "sectionListRenderer": { "contents": [
                { "musicShelfRenderer": { "title": { "runs": [{ "text": "Top songs", "navigationEndpoint": { "browseEndpoint": { "browseId": "VLOLAK5uy_top" } } }] }, "contents": [song] } },
                carousel("Featured on", card("This Is Daft Punk", "VLRDCLAK5uy_x")),
                carousel("Fans might also like", card("Justice", "UC9"))
            ] } }
        });
        let a = artist_page(&page).unwrap();
        assert_eq!((a.name.as_str(), a.art.as_deref()), ("Daft Punk", Some("https://lh3.googleusercontent.com/b=w544-h544-p-l90-rj")));
        assert_eq!(a.songs.len(), 1);
        assert_eq!((a.songs[0].artist.as_str(), a.songs[0].album.as_deref(), a.songs[0].duration_ms), ("Daft Punk, Julian Casablancas", Some("Random Access Memories"), None));
        assert_eq!(a.all_songs, Some(ListRef::Browse { id: "VLOLAK5uy_top".into() }));
        assert_eq!(a.shelves.iter().map(|s| s.title.as_str()).collect::<Vec<_>>(), ["Featured on"], "artists-only shelf dropped");
    }

    #[test]
    fn list_refs_only_take_youtube_ids() {
        assert!(ListRef::Browse { id: "VLPL123_-".into() }.valid());
        assert!(ListRef::Browse { id: "MPREb_x".into() }.valid());
        assert!(!ListRef::Browse { id: "UC123".into() }.valid());
        assert!(!ListRef::Browse { id: "VL../x".into() }.valid());
        assert!(ListRef::Radio { video_id: Some("abc".into()), playlist_id: "RDAMVMabc".into() }.valid());
        assert!(!ListRef::Radio { video_id: Some("a b".into()), playlist_id: "RD1".into() }.valid());
        let json = serde_json::to_string(&ListRef::Radio { video_id: Some("v".into()), playlist_id: "RD".into() }).unwrap();
        assert_eq!(json, r#"{"type":"radio","videoId":"v","playlistId":"RD"}"#);
    }

    /// Unofficial API: a reshuffled answer gives nothing, never a panic.
    #[test]
    fn parsers_survive_unknown_shapes() {
        let odd = [
            json!(null),
            json!({}),
            json!([1, "x"]),
            json!({ "musicCarouselShelfRenderer": { "header": 3, "contents": "nope" } }),
            json!({ "musicCarouselShelfRenderer": { "header": { "musicCarouselShelfBasicHeaderRenderer": { "title": { "runs": [{ "text": "Quick picks" }] } } }, "contents": [{ "musicTwoRowItemRenderer": [] }] } }),
            json!({ "playlistPanelVideoRenderer": { "videoId": 5, "title": {} } }),
            json!({ "sectionListRenderer": { "continuations": [{ "nextContinuationData": { "continuation": [] } }] } }),
        ];
        for v in &odd {
            assert!(shelves(v).is_empty(), "{v}");
            assert_eq!(more(v), None, "{v}");
            assert!(panel_tracks(v).is_empty(), "{v}");
            assert!(album_tracks(v).is_empty(), "{v}");
            assert_eq!(artist_page(v), None, "{v}");
            assert_eq!(artist_id(v, "x"), None, "{v}");
        }
    }
}
