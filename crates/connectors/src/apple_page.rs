//! What the app's Apple Music window reads from the pages it shows (`crates/shield/src/apple.js`): the signed-in user's
//! playlists and their songs, no key and no developer account. The page runs Apple's scripts too: everything here is a
//! trust boundary (origin, shape, sizes). Same messages as Spotify's page.

use crate::spotify_page::{clean, clean_art};
pub use crate::spotify_page::{Message, PageList};
use music_core::model::{Source, Track};
use music_core::musicness::Musicness;
use serde::Deserialize;
use std::collections::BTreeMap;

/// Prefix of the page's messages ("legato-apple:" + JSON). Strings: WebView2 drops objects posted from that page.
const PREFIX: &str = "legato-apple:";
const ORIGIN: &str = "https://music.apple.com/";
/// A batch is 40 rows; a row with long names stays under 1 kB.
const MAX_MESSAGE: usize = 64 * 1024;
const MAX_DURATION_MS: u32 = 86_400_000;

#[derive(Deserialize)]
struct RawList {
    id: String,
    name: String,
    cover: Option<String>,
}

#[derive(Deserialize)]
struct RawSong {
    /// Catalog id; a song of the user's own files has none.
    id: Option<String>,
    title: String,
    artists: Vec<String>,
    album: Option<String>,
    ms: Option<u32>,
    art: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct Raw {
    started: bool,
    done: bool,
    error: Option<String>,
    lists: Option<Vec<RawList>>,
    rows: Option<Vec<RawSong>>,
    total: usize,
}

/// Library playlist ("p." + letters) or one added from the catalog ("pl." + letters, dashes).
fn valid_list(id: &str) -> bool {
    let rest = id.strip_prefix("pl.").or_else(|| id.strip_prefix("p."));
    rest.is_some_and(|r| (4..=60).contains(&r.len()) && r.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
}

fn valid_song(id: &str) -> bool {
    (1..=12).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit())
}

fn list(r: RawList) -> Option<PageList> {
    valid_list(&r.id).then_some(())?;
    Some(PageList { id: r.id, name: clean(&r.name)?, cover: clean_art(r.cover) })
}

fn song(r: RawSong) -> Option<Track> {
    let artist = r.artists.iter().filter_map(|a| clean(a)).take(20).collect::<Vec<_>>().join(", ");
    Some(Track {
        title: clean(&r.title)?,
        artist: clean(&artist)?,
        album: r.album.as_deref().and_then(clean),
        duration_ms: r.ms.filter(|ms| (1..=MAX_DURATION_MS).contains(ms)),
        isrc: None,
        ids: r.id.filter(|id| valid_song(id)).map(|id| BTreeMap::from([(Source::Apple, id)])).unwrap_or_default(),
        art: clean_art(r.art),
        musicness: Some(Musicness::Music),
        explicit: false,
    })
}

/// A message from the page, or None when it isn't ours. Rows that don't hold up are dropped, the rest of the batch kept.
pub fn parse(source: &str, message: &str) -> Option<Message> {
    if !source.starts_with(ORIGIN) || message.len() > MAX_MESSAGE {
        return None;
    }
    let r: Raw = serde_json::from_str(message.strip_prefix(PREFIX)?).ok()?;
    Some(if let Some(rows) = r.rows {
        Message::Songs { songs: rows.into_iter().filter_map(song).collect(), total: r.total }
    } else if let Some(lists) = r.lists {
        Message::Lists(lists.into_iter().filter_map(list).collect())
    } else if let Some(e) = r.error {
        Message::Failed(e.chars().take(200).collect())
    } else if r.started {
        Message::Started
    } else if r.done {
        Message::Done
    } else {
        return None;
    })
}

/// Trust boundary: a list id from the UI → its page on music.apple.com.
pub fn list_path(id: &str) -> Option<String> {
    valid_list(id).then(|| format!("library/playlist/{id}"))
}

/// Where the user's playlists are listed.
pub const LISTS_PATH: &str = "library/all-playlists/";

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = "https://music.apple.com/library/playlist/p.qQXLxPLtA9mmVq";
    const LIST: &str = "p.qQXLxPLtA9mmVq";

    fn rows(json: &str) -> String {
        format!(r#"legato-apple:{{"rows":{json},"total":50}}"#)
    }

    #[test]
    fn reads_a_batch_of_rows() {
        // As apple.js reads a real page (2026-10-31, Today's Hits).
        let m = rows(r#"[{"id":"6818209989","title":"Solar Eclipse","artists":["Drake","Don Toliver"],"album":"HABIBTI (FOMO)","ms":218000,"art":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/bb/45/a.jpg/300x300bb.jpg"}]"#);
        let Some(Message::Songs { songs, total }) = parse(PAGE, &m) else { panic!("not songs") };
        assert_eq!(total, 50);
        let t = &songs[0];
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.album.as_deref()), ("Solar Eclipse", "Drake, Don Toliver", Some("HABIBTI (FOMO)")));
        assert_eq!((t.duration_ms, t.ids[&Source::Apple].as_str()), (Some(218_000), "6818209989"));
        assert!(t.art.is_some());
    }

    #[test]
    fn a_song_without_catalog_id_keeps_its_names() {
        for id in [r#""#, r#","id":"12a""#, r#","id":"1234567890123""#] {
            let m = rows(&format!(r#"[{{"title":"Demo"{id},"artists":["Me"]}}]"#));
            let Some(Message::Songs { songs, .. }) = parse(PAGE, &m) else { panic!("not songs") };
            assert_eq!((songs[0].title.as_str(), songs[0].ids.len()), ("Demo", 0), "{id}");
        }
    }

    #[test]
    fn a_bad_row_goes_alone() {
        let good = r#"{"title":"Loser","artists":["Tame Impala"]}"#;
        let bad = [r#"{"title":"","artists":["B"]}"#.to_string(), r#"{"title":"A","artists":[]}"#.to_string(), format!(r#"{{"title":"{}","artists":["B"]}}"#, "x".repeat(301)), r#"{"title":"A\u0007","artists":["B"]}"#.to_string()];
        for b in bad {
            let Some(Message::Songs { songs, .. }) = parse(PAGE, &rows(&format!("[{b},{good}]"))) else { panic!("not songs") };
            assert_eq!(songs.len(), 1, "{b}");
        }
        let m = rows(r#"[{"title":"A","artists":["B"],"ms":0,"art":"https://evil.example/a.jpg"}]"#);
        let Some(Message::Songs { songs, .. }) = parse(PAGE, &m) else { panic!("not songs") };
        assert_eq!((songs[0].duration_ms, songs[0].art.clone()), (None, None));
    }

    #[test]
    fn reads_lists_and_steps() {
        let m = format!(r#"legato-apple:{{"lists":[{{"id":"{LIST}","name":"Road trip","cover":"https://is1-ssl.mzstatic.com/image/a/300x300bb.jpg"}},{{"id":"pl.u-abcd-EF12","name":"Added"}},{{"id":"nope","name":"Bad"}},{{"id":"p.ab/../x","name":"Bad"}}]}}"#);
        let Some(Message::Lists(lists)) = parse(PAGE, &m) else { panic!("not lists") };
        assert_eq!(lists.iter().map(|l| l.id.as_str()).collect::<Vec<_>>(), [LIST, "pl.u-abcd-EF12"]);
        assert_eq!(lists[0].cover.as_deref(), Some("https://is1-ssl.mzstatic.com/image/a/300x300bb.jpg"));
        assert_eq!(parse(PAGE, r#"legato-apple:{"started":true}"#), Some(Message::Started));
        assert_eq!(parse(PAGE, r#"legato-apple:{"done":true}"#), Some(Message::Done));
        assert_eq!(parse(PAGE, r#"legato-apple:{"error":"signed out"}"#), Some(Message::Failed("signed out".into())));
    }

    #[test]
    fn other_senders_are_refused() {
        let m = r#"legato-apple:{"done":true}"#;
        assert_eq!(parse("https://evil.example/", m), None);
        assert_eq!(parse("https://music.apple.com.evil.example/", m), None);
        assert_eq!(parse("https://open.spotify.com/", m), None);
        assert_eq!(parse(PAGE, r#"legato-spotify:{"done":true}"#), None);
        assert_eq!(parse(PAGE, "legato-apple:{}"), None);
        assert_eq!(parse(PAGE, &format!("legato-apple:{}", " ".repeat(MAX_MESSAGE))), None);
    }

    #[test]
    fn list_pages_take_ids_only() {
        assert_eq!(list_path(LIST), Some(format!("library/playlist/{LIST}")));
        assert_eq!(list_path("p.abc"), None);
        assert_eq!(list_path("../settings"), None);
        assert_eq!(list_path(""), None);
    }
}
