//! YouTube Music's home: its recommendation shelves (Quick picks, Listen again, Mixed for you…), and the songs behind
//! a playlist, album or radio there, to play without importing anything. An artist's page: same shelves.

use super::{ARTISTS, YouTubeMusic, all, big_thumb, explicit_badge, page_type, parse_duration, row_track, row_track_with, text};
use anyhow::Result;
use music_core::matching::normalize;
use music_core::model::{Source, Track};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashSet};

/// Shelves after the first page: two more pages at most.
const MORE_PAGES: usize = 2;

#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Shelf {
    pub title: String,
    pub items: Vec<HomeItem>,
}

/// Home page: its shelves, and the mood chips above them (Relax, Energize, Focus…) that filter it.
#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "YtmHome")]
pub struct Home {
    pub shelves: Vec<Shelf>,
    pub moods: Vec<Mood>,
}

/// A chip over the home: `params` asks the home filtered to it.
#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "YtmMood")]
pub struct Mood {
    pub title: String,
    pub params: String,
}

/// Params from YouTube's own chips: base64 (URL-safe too), bounded.
pub fn valid_mood(params: &str) -> bool {
    !params.is_empty() && params.len() <= 400 && params.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_=%+/".contains(&b))
}

#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
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
#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "YtmArtist")]
pub struct Artist {
    pub name: String,
    pub art: Option<String>,
    pub songs: Vec<Track>,
    pub all_songs: Option<ListRef>,
    pub shelves: Vec<Shelf>,
    /// The page's "About" text, as YouTube Music shows it (often Wikipedia's, its credit line kept at the end).
    pub about: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, ts_rs::TS)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[ts(export)]
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
        let track = Track { title: title.clone(), artist, album: album_of(item.get("subtitle")), duration_ms: None, isrc: None, ids: BTreeMap::from([(Source::Youtube, video?)]), art: art.clone(), musicness: None, explicit: explicit_badge(item) };
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
            Some(Track { title, artist: artist_of(byline), album: album_of(byline), duration_ms, isrc: None, ids: BTreeMap::from([(Source::Youtube, video)]), art: last_thumb(p.get("thumbnail")), musicness: None, explicit: explicit_badge(p) })
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

/// Channels of the artists with this very name (case, accents, punctuation aside) in an artists search, in YouTube Music's
/// order, at most `max`: two artists may share a name ("Rust"), and the first is only the most popular of them.
fn artist_ids(found: &Value, name: &str, max: usize) -> Vec<String> {
    let want = normalize(name);
    all(found, "musicResponsiveListItemRenderer")
        .into_iter()
        .filter_map(|r| {
            let id = r.pointer("/navigationEndpoint/browseEndpoint/browseId")?.as_str()?;
            let title = r.pointer("/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/text").and_then(text)?;
            (id.starts_with("UC") && normalize(&title) == want).then(|| id.to_string())
        })
        .take(max)
        .collect()
}

/// A song or card title as compared across pages: its credits "(feat. X)", "[Remix]" and " - Version" tail dropped, then normalized.
fn loose(title: &str) -> String {
    static GROUPS: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"\([^)]*\)|\[[^\]]*\]").unwrap());
    let plain = GROUPS.replace_all(title, " ");
    // A space after: "feat" and "ft" as whole words ("Birds of a Feather" keeps its feather).
    let lower = format!("{} ", plain.to_lowercase());
    let cut = [" - ", " feat. ", " feat ", " ft. ", " ft ", " featuring "].iter().filter_map(|m| lower.find(m)).min().unwrap_or(lower.len());
    normalize(&lower[..cut])
}

/// Two titles name the same song: equal, or one the start of the other (a long enough one: "Bad Piggies Theme" and "Bad Piggies").
fn same_song(a: &str, b: &str) -> bool {
    !a.is_empty() && !b.is_empty() && (a == b || (a.len().min(b.len()) >= 6 && (a.starts_with(b) || b.starts_with(a))))
}

/// Is this page really the artist of the song(s) `titles`? Its top songs or a card of its shelves must be one of them.
pub(crate) fn confirms(page: &Artist, titles: &[String]) -> bool {
    let mine: Vec<String> = titles.iter().map(|t| loose(t)).collect();
    let shown = page.songs.iter().map(|t| loose(&t.title)).chain(page.shelves.iter().flat_map(|s| s.items.iter().map(|i| loose(&i.title))));
    shown.into_iter().any(|s| mine.iter().any(|m| same_song(&s, m)))
}

/// The first page that is the artist of one of `titles`. Without titles there is nothing to check against: the first page.
pub(crate) fn pick_verified(pages: Vec<Artist>, titles: &[String]) -> Option<Artist> {
    if titles.is_empty() {
        return pages.into_iter().next();
    }
    pages.into_iter().find(|p| confirms(p, titles))
}

/// Pages asked at most, for one name: the most popular artist of that name and the next one.
const CANDIDATES: usize = 2;

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
    Some(Artist { name, art: last_thumb(header.get("thumbnail")), songs, all_songs, shelves: shelves(page), about: about(page, header) })
}

/// A channel id from YouTube's own pages: `UC`, then letters, digits, - and _ (bounded). It goes into a `browse` request.
pub fn valid_channel(id: &str) -> bool {
    id.starts_with("UC") && id.len() >= 3 && id.len() <= 40 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The channel of the artist called `name` in a `next` response: the linked run of a song's byline (a catalogue artist's page, or an
/// uploader's channel: `MUSIC_PAGE_TYPE_USER_CHANNEL`, which has no entry in the artists search) whose text is that very name.
pub(crate) fn channel_in(v: &Value, video: &str, name: &str) -> Option<String> {
    let want = normalize(name);
    // The asked song's own entry only: the radio after it is other uploads, whose same-named channel would be a guess.
    all(v, "playlistPanelVideoRenderer").into_iter().filter(|p| p.get("videoId").and_then(Value::as_str) == Some(video)).flat_map(|p| [p.get("longBylineText"), p.get("shortBylineText")]).flatten().find_map(|b| {
        b.get("runs")?.as_array()?.iter().find_map(|r| {
            let id = r.pointer("/navigationEndpoint/browseEndpoint/browseId")?.as_str()?;
            let linked = matches!(page_type(r), "MUSIC_PAGE_TYPE_ARTIST" | "MUSIC_PAGE_TYPE_USER_CHANNEL");
            (linked && valid_channel(id) && normalize(r.get("text")?.as_str()?) == want).then(|| id.to_string())
        })
    })
}

/// An uploader channel's page: the artist page's own parse (its visual header, its carousels), and, with no "Top songs" shelf (a
/// channel has videos), its first carousel of songs or videos as the top songs. The layout ytmusicapi's `get_user` reads.
fn channel_page(page: &Value) -> Option<Artist> {
    let mut a = artist_page(page)?;
    if a.songs.is_empty() {
        // A channel with no video listed still has its picture and name.
        a.songs = a
            .shelves
            .iter()
            .find_map(|s| {
                let songs: Vec<Track> = s.items.iter().filter_map(|i| i.track.clone()).collect();
                (!songs.is_empty()).then_some(songs)
            })
            .unwrap_or_default();
    }
    Some(a)
}

/// "About": the description shelf at the page's foot, else the header's own description (older layout).
fn about(page: &Value, header: &Value) -> Option<String> {
    all(page, "musicDescriptionShelfRenderer")
        .into_iter()
        .find_map(|d| d.get("description").and_then(text))
        .or_else(|| header.get("description").and_then(text))
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
}

impl YouTubeMusic {
    /// An artist's page by name, checked against `titles` (songs of that artist the app knows: the page must show one of them).
    /// A name alone is not an artist: "Rust" the rapper's channel is not the band that tops the search. Of the artists with
    /// that very name, the first two are looked at (the second only when the first does not confirm), one request each.
    /// None: no artist of that name shows these songs. No titles: the first of that name, unchecked.
    pub async fn artist(&self, name: &str, titles: &[String]) -> Result<Option<Artist>> {
        let found = self.call("search", json!({ "query": name, "params": ARTISTS })).await?;
        for id in artist_ids(&found, name, CANDIDATES) {
            let Some(page) = artist_page(&self.call("browse", json!({ "browseId": id })).await?) else { continue };
            if let Some(ok) = pick_verified(vec![page], titles) {
                return Ok(Some(ok));
            }
        }
        Ok(None)
    }

    /// A channel's page by its id (an uploader that is no catalogue artist, or an artist's own): one `browse`. None: not a page YouTube Music
    /// shows for it. The id is checked first: it only ever comes from YouTube's own pages.
    pub async fn channel(&self, id: &str) -> Result<Option<Artist>> {
        if !valid_channel(id) {
            return Ok(None);
        }
        Ok(channel_page(&self.call("browse", json!({ "browseId": id })).await?))
    }

    /// The channel of the artist `name` from one of its songs: one `next` for that video, its byline read. None: the byline links no
    /// channel of that name. The caller keeps the answer, so a song is asked once per artist.
    pub async fn channel_of(&self, video_id: &str, name: &str) -> Result<Option<String>> {
        let ok = !video_id.is_empty() && video_id.len() <= 20 && video_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        if !ok {
            return Ok(None);
        }
        Ok(channel_in(&self.call("next", json!({ "videoId": video_id, "isAudioOnly": true })).await?, video_id, name))
    }

    /// An artist's page for the app, whatever kind of "artist" it is: the channel kept for the name (`kept`: one request), else the
    /// catalogue's by name checked against `titles` (as `artist`), else, given the video of one of its songs, the channel its byline
    /// links (one `next`, one `browse`): an uploader that is no catalogue artist. The second value is a channel found that way, for
    /// the caller to keep (so a song is asked once per artist). Any refusal is an error and ends it: no other endpoint, no retry.
    pub async fn artist_or_channel(&self, name: &str, titles: &[String], kept: Option<&str>, video: Option<&str>) -> Result<(Option<Artist>, Option<String>)> {
        if let Some(page) = match kept {
            Some(id) => self.channel(id).await?,
            None => None,
        } {
            return Ok((Some(page), None));
        }
        if let Some(page) = self.artist(name, titles).await? {
            return Ok((Some(page), None));
        }
        let Some(video) = video else { return Ok((None, None)) };
        let Some(id) = self.channel_of(video, name).await? else { return Ok((None, None)) };
        let page = self.channel(&id).await?;
        let found = page.is_some().then_some(id);
        Ok((page, found))
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
        let first = |n: &str| artist_ids(&found, n, 1).into_iter().next();
        assert_eq!(first("daft punk").as_deref(), Some("UC2"));
        assert_eq!(first("Beyonce").as_deref(), Some("UC3"));
        assert_eq!(first("Daft"), None, "same name only");

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
        assert_eq!(a.about, None, "no About: none");
    }

    fn byline(runs: Vec<Value>) -> Value {
        json!({ "contents": [{ "playlistPanelVideoRenderer": { "videoId": "v1", "title": { "runs": [{ "text": "Girl" }] }, "longBylineText": { "runs": runs } } }] })
    }

    #[test]
    fn a_channel_id_is_only_ever_youtubes_own_shape() {
        assert!(valid_channel("UCabcdefghijklmnopqrstuv"));
        assert!(valid_channel("UC-_09aZ"));
        for bad in ["", "UC", "VLPL1", "UC../x", "UC abc", "UC?x=1", "https://x", &format!("UC{}", "a".repeat(40))] {
            assert!(!valid_channel(bad), "{bad:?}");
        }
    }

    #[test]
    fn the_channel_of_an_uploader_is_read_from_the_songs_byline() {
        // An uploader channel (not a catalogue artist) as a song's linked byline run.
        let page = byline(vec![run("prodphanda", Some(("MUSIC_PAGE_TYPE_USER_CHANNEL", "UCchan0000000000000000aa"))), run(" • ", None), run("3 views", None)]);
        assert_eq!(channel_in(&page, "v1", "prodphanda").as_deref(), Some("UCchan0000000000000000aa"));
        assert_eq!(channel_in(&page, "v1", "ProdPhanda").as_deref(), Some("UCchan0000000000000000aa"), "case and accents aside");
        // A catalogue artist's page counts too; another name, an unlinked run and a bad id do not.
        let art = byline(vec![run("Muse", Some(("MUSIC_PAGE_TYPE_ARTIST", "UC3abcdefghijklmnopqrstu")))]);
        assert_eq!(channel_in(&art, "v1", "Muse").as_deref(), Some("UC3abcdefghijklmnopqrstu"));
        assert_eq!(channel_in(&page, "v1", "Someone else"), None);
        assert_eq!(channel_in(&byline(vec![run("prodphanda", None)]), "v1", "prodphanda"), None);
        assert_eq!(channel_in(&byline(vec![run("prodphanda", Some(("MUSIC_PAGE_TYPE_USER_CHANNEL", "UC../evil")))]), "v1", "prodphanda"), None);
        assert_eq!(channel_in(&json!({}), "v1", "x"), None);
    }

    #[test]
    fn only_the_asked_songs_own_byline_counts_not_the_radio_after_it() {
        // `next` answers the song (v1) and a radio of others: a same-named channel there is not confirmed as this artist.
        let mut page = byline(vec![run("prodphanda", None)]);
        page["contents"].as_array_mut().unwrap().push(json!({ "playlistPanelVideoRenderer": { "videoId": "v2", "longBylineText": { "runs": [run("prodphanda", Some(("MUSIC_PAGE_TYPE_USER_CHANNEL", "UCother000000000000000aa")))] } } }));
        assert_eq!(channel_in(&page, "v1", "prodphanda"), None);
    }

    #[test]
    fn a_channel_page_gives_its_picture_and_its_videos_as_the_top_songs() {
        // The shape ytmusicapi's get_user reads: a visual header, then carousels of videos (no "Top songs" shelf).
        let video = json!({ "musicTwoRowItemRenderer": { "title": { "runs": [{ "text": "Girl (prod. phanda)" }] }, "subtitle": { "runs": [run("Video", None), run(" • ", None), run("prodphanda", Some(("MUSIC_PAGE_TYPE_USER_CHANNEL", "UCchan0000000000000000aa")))] }, "thumbnailRenderer": thumb("https://i.ytimg.com/vi/vid1/hqdefault.jpg"), "navigationEndpoint": { "watchEndpoint": { "videoId": "vid1" } } } });
        let page = json!({
            "header": { "musicVisualHeaderRenderer": { "title": { "runs": [{ "text": "prodphanda" }] }, "thumbnail": thumb("https://yt3.googleusercontent.com/avatar=w544-h544-p") } },
            "contents": { "sectionListRenderer": { "contents": [json!({ "musicCarouselShelfRenderer": { "header": { "musicCarouselShelfBasicHeaderRenderer": { "title": { "runs": [{ "text": "Videos" }] } } }, "contents": [video] } })] } }
        });
        let got = channel_page(&page).unwrap();
        assert_eq!(got.name, "prodphanda");
        assert!(got.art.as_deref().unwrap().starts_with("https://yt3.googleusercontent.com/avatar"));
        assert_eq!(got.songs.len(), 1);
        assert_eq!(got.songs[0].title, "Girl (prod. phanda)");
        assert_eq!(got.songs[0].ids[&Source::Youtube], "vid1");
        assert_eq!(channel_page(&json!({})), None);
    }

    #[tokio::test]
    async fn an_uploader_with_no_catalogue_page_is_found_through_its_songs_byline_once() {
        let mut s = mockito::Server::new_async().await;
        // The name search finds no artist; the song's own byline links the channel; the channel's page has the picture.
        let search = s.mock("POST", "/search").match_query(mockito::Matcher::Any).with_body(r#"{"contents":{}}"#).expect(1).create_async().await;
        let next = s.mock("POST", "/next").match_query(mockito::Matcher::Any).with_body(byline(vec![run("prodphanda", Some(("MUSIC_PAGE_TYPE_USER_CHANNEL", "UCchan0000000000000000aa")))]).to_string()).expect(1).create_async().await;
        let browse = s
            .mock("POST", "/browse")
            .match_query(mockito::Matcher::Any)
            .match_body(mockito::Matcher::PartialJson(json!({ "browseId": "UCchan0000000000000000aa" })))
            .with_body(json!({ "header": { "musicVisualHeaderRenderer": { "title": { "runs": [{ "text": "prodphanda" }] }, "thumbnail": thumb("https://yt3.googleusercontent.com/avatar=w544-h544-p") } } }).to_string())
            .expect(2)
            .create_async()
            .await;
        let yt = YouTubeMusic::anonymous_with_api(&s.url());
        // No video of its songs: nothing more is asked beyond the search.
        assert_eq!(yt.artist_or_channel("prodphanda", &["Girl".into()], None, None).await.unwrap(), (None, None));
        let (page, found) = yt.artist_or_channel("prodphanda", &["Girl".into()], None, Some("v1")).await.unwrap();
        // (the first call above searched too: the search mock expects 1, so reset its count by asking the kept way below)
        let page = page.unwrap();
        assert!(page.art.as_deref().unwrap().starts_with("https://yt3.googleusercontent.com/avatar"));
        assert_eq!(found.as_deref(), Some("UCchan0000000000000000aa"));
        // Kept: one browse, no search and no `next`.
        let (again, new) = yt.artist_or_channel("prodphanda", &[], found.as_deref(), Some("v1")).await.unwrap();
        assert!(again.is_some() && new.is_none());
        search.expect(2).assert_async().await;
        next.assert_async().await;
        browse.assert_async().await;
    }

    #[tokio::test]
    async fn a_refusal_is_an_error_not_a_reason_to_try_another_way() {
        let mut s = mockito::Server::new_async().await;
        let search = s.mock("POST", "/search").match_query(mockito::Matcher::Any).with_status(429).with_body("Sorry").expect(1).create_async().await;
        let next = s.mock("POST", "/next").match_query(mockito::Matcher::Any).expect(0).create_async().await;
        let yt = YouTubeMusic::anonymous_with_api(&s.url());
        assert!(yt.artist_or_channel("prodphanda", &[], None, Some("vid1")).await.is_err());
        search.assert_async().await;
        next.assert_async().await;
    }

    #[test]
    fn reads_the_artists_about() {
        let bio = "Daft Punk were a French electronic music duo.\n\nFrom Wikipedia (https://en.wikipedia.org/wiki/Daft_Punk) under Creative Commons Attribution CC-BY-SA 3.0";
        let header = |extra: Value| {
            let mut h = json!({ "title": { "runs": [{ "text": "Daft Punk" }] } });
            h.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            json!({ "musicImmersiveHeaderRenderer": h })
        };
        let shelf = json!({ "musicDescriptionShelfRenderer": { "header": { "runs": [{ "text": "About" }] }, "subheader": { "runs": [{ "text": "1.2B views" }] }, "description": { "runs": [{ "text": format!("  {bio}\n") }] } } });
        let page = json!({ "header": header(json!({ "description": { "runs": [{ "text": "Old header text" }] } })), "contents": { "sectionListRenderer": { "contents": [shelf] } } });
        assert_eq!(artist_page(&page).unwrap().about.as_deref(), Some(bio), "the shelf first, trimmed, its credit kept");
        let old = json!({ "header": header(json!({ "description": { "runs": [{ "text": "Old " }, { "text": "header text" }] } })), "contents": {} });
        assert_eq!(artist_page(&old).unwrap().about.as_deref(), Some("Old header text"), "the header's when no shelf");
        let blank = json!({ "header": header(json!({ "description": { "runs": [{ "text": "  " }] } })), "contents": {} });
        assert_eq!(artist_page(&blank).unwrap().about, None);
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
            assert!(artist_ids(v, "x", 1).is_empty(), "{v}");
        }
    }

    fn page(name: &str, songs: &[&str]) -> Artist {
        let t = |title: &str| Track { title: title.into(), artist: name.into(), album: None, duration_ms: None, isrc: None, ids: Default::default(), art: None, musicness: None, explicit: false };
        Artist { name: name.into(), art: None, songs: songs.iter().map(|s| t(s)).collect(), all_songs: None, shelves: vec![], about: None }
    }

    #[test]
    fn two_artists_with_one_name_are_told_apart_by_the_songs_that_play() {
        // The popular "Rust" of the catalogue, and the rapper whose channel the song came from.
        let band = page("Rust", &["Diaspora", "Shanta", "Laa"]);
        let rapper = page("Rust", &["Bad Piggies Theme", "Cybercity"]);
        let playing = vec!["Bad Piggies Theme (featuring King Von)".to_string()];
        // The first in the search is the band: it is not taken for a song it does not show.
        let got = pick_verified(vec![band.clone(), rapper.clone()], &playing).unwrap();
        assert_eq!(got.songs[0].title, "Bad Piggies Theme");
        // Only the band shows up and the song is not on it: no artist at all, not the band's top songs.
        assert!(pick_verified(vec![band.clone()], &playing).is_none());
        // And the band's own song picks the band.
        assert_eq!(pick_verified(vec![band, rapper], &["Shanta".to_string()]).unwrap().songs[0].title, "Diaspora");
    }

    #[test]
    fn titles_are_compared_without_their_credits_and_versions() {
        assert_eq!(loose("Bad Piggies Theme (featuring King Von)"), loose("Bad Piggies Theme"));
        assert_eq!(loose("Song - 2011 Remaster"), loose("song"));
        assert_eq!(loose("Song [Live] feat. Someone"), loose("Song"));
        assert!(same_song(&loose("Bad Piggies Theme"), &loose("Bad Piggies")));
        assert!(!same_song(&loose("Rust"), &loose("Rust Never Sleeps")), "a short title is not a prefix of another song");
        assert!(!same_song("", ""));
        // "feat" as a whole word only: a title with a word that starts with it keeps that word.
        assert_ne!(loose("Birds of a Feather"), loose("Birds of a"));
        assert_eq!(loose("Song ft Someone"), loose("Song"));
        // No titles: nothing to check against, the first page.
        assert_eq!(pick_verified(vec![page("Rust", &["Diaspora"])], &[]).unwrap().songs[0].title, "Diaspora");
    }
}
