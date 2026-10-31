//! What the app's Spotify window reads from the pages it shows (`crates/shield/src/spotify.js`): the signed-in user's lists
//! and their songs, private ones and Liked Songs included, no key and no Premium. The page runs Spotify's scripts too:
//! everything here is a trust boundary (origin, shape, sizes).

use music_core::model::{Source, Track};
use music_core::musicness::Musicness;
use serde::Deserialize;
use std::collections::BTreeMap;

/// Prefix of the page's messages ("legato-spotify:" + JSON). Strings: WebView2 drops objects posted from that page.
const PREFIX: &str = "legato-spotify:";
const ORIGIN: &str = "https://open.spotify.com/";
/// A batch is 40 rows; a row with long names stays under 1 kB.
const MAX_MESSAGE: usize = 64 * 1024;
const MAX_TEXT: usize = 300;
const MAX_DURATION_MS: u32 = 86_400_000;
/// Liked Songs has no playlist id.
pub const LIKED: &str = "liked";

/// A playlist in the user's library, as Spotify's column shows it.
#[derive(Debug, Clone, PartialEq)]
pub struct PageList {
    pub id: String,
    pub name: String,
    pub cover: Option<String>,
}

#[derive(Debug, PartialEq)]
pub enum Message {
    Started,
    Done,
    Failed(String),
    Lists(Vec<PageList>),
    /// A batch of rows; `total` = the songs the list says it has.
    Songs {
        songs: Vec<Track>,
        total: usize,
    },
}

#[derive(Deserialize)]
struct RawList {
    id: String,
    name: String,
    cover: Option<String>,
}

#[derive(Deserialize)]
struct RawSong {
    id: String,
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

fn valid_id(id: &str) -> bool {
    id.len() == 22 && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

pub(crate) fn clean(text: &str) -> Option<String> {
    let t = text.trim();
    (!t.is_empty() && t.chars().count() <= MAX_TEXT && !t.chars().any(char::is_control)).then(|| t.to_string())
}

/// Image hosts `art` serves only (a playlist's cover can be a long mosaic address).
pub(crate) fn clean_art(url: Option<String>) -> Option<String> {
    url.filter(|u| u.len() <= 400 && crate::art::allowed(u))
}

fn list(r: RawList) -> Option<PageList> {
    valid_id(&r.id).then_some(())?;
    Some(PageList { id: r.id, name: clean(&r.name)?, cover: clean_art(r.cover) })
}

fn song(r: RawSong) -> Option<Track> {
    valid_id(&r.id).then_some(())?;
    let artist = r.artists.iter().filter_map(|a| clean(a)).take(20).collect::<Vec<_>>().join(", ");
    Some(Track {
        title: clean(&r.title)?,
        artist: clean(&artist)?,
        album: r.album.as_deref().and_then(clean),
        duration_ms: r.ms.filter(|ms| (1..=MAX_DURATION_MS).contains(ms)),
        isrc: None,
        ids: BTreeMap::from([(Source::Spotify, r.id)]),
        art: clean_art(r.art),
        musicness: Some(Musicness::Music),
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

/// Trust boundary: a list id from the UI → its page on open.spotify.com.
pub fn list_path(id: &str) -> Option<String> {
    if id == LIKED {
        return Some("collection/tracks".into());
    }
    valid_id(id).then(|| format!("playlist/{id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M";
    const ID: &str = "7bxaFZ1O3cHkgLKMsdC3xR";

    fn rows(json: &str) -> String {
        format!(r#"legato-spotify:{{"rows":{json},"total":50}}"#)
    }

    #[test]
    fn reads_a_batch_of_rows() {
        // As the real page gives them (2026-10-31, Today's Top Hits).
        let m = rows(&format!(r#"[{{"id":"{ID}","title":" Loser ","artists":["Tame Impala","Tame Impala 2"],"album":"Deadbeat","ms":223000,"art":"https://i.scdn.co/image/ab67"}}]"#));
        let Some(Message::Songs { songs, total }) = parse(PAGE, &m) else { panic!("not songs") };
        assert_eq!(total, 50);
        let t = &songs[0];
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.album.as_deref()), ("Loser", "Tame Impala, Tame Impala 2", Some("Deadbeat")));
        assert_eq!((t.duration_ms, t.ids[&Source::Spotify].as_str(), t.art.as_deref()), (Some(223_000), ID, Some("https://i.scdn.co/image/ab67")));
    }

    #[test]
    fn a_bad_row_goes_alone() {
        let good = format!(r#"{{"id":"{ID}","title":"Loser","artists":["Tame Impala"]}}"#);
        let bad = [
            r#"{"id":"short","title":"A","artists":["B"]}"#.to_string(),
            format!(r#"{{"id":"{ID}","title":"","artists":["B"]}}"#),
            format!(r#"{{"id":"{ID}","title":"A","artists":[]}}"#),
            format!(r#"{{"id":"{ID}","title":"{}","artists":["B"]}}"#, "x".repeat(301)),
            format!(r#"{{"id":"{ID}","title":"A\u0007","artists":["B"]}}"#),
        ];
        for b in bad {
            let Some(Message::Songs { songs, .. }) = parse(PAGE, &rows(&format!("[{b},{good}]"))) else { panic!("not songs") };
            assert_eq!(songs.len(), 1, "{b}");
        }
    }

    #[test]
    fn odd_values_are_left_out() {
        let m = rows(&format!(r#"[{{"id":"{ID}","title":"A","artists":["B"],"ms":0,"art":"https://evil.example/a.jpg"}}]"#));
        let Some(Message::Songs { songs, .. }) = parse(PAGE, &m) else { panic!("not songs") };
        assert_eq!((songs[0].duration_ms, songs[0].art.clone()), (None, None));
    }

    #[test]
    fn reads_lists_and_steps() {
        let m = format!(r#"legato-spotify:{{"lists":[{{"id":"{ID}","name":"Road trip","cover":"https://mosaic.scdn.co/60/ab"}},{{"id":"nope","name":"Bad"}}]}}"#);
        assert_eq!(parse(PAGE, &m), Some(Message::Lists(vec![PageList { id: ID.into(), name: "Road trip".into(), cover: Some("https://mosaic.scdn.co/60/ab".into()) }])));
        assert_eq!(parse(PAGE, r#"legato-spotify:{"lists":[]}"#), Some(Message::Lists(vec![])));
        assert_eq!(parse(PAGE, r#"legato-spotify:{"started":true}"#), Some(Message::Started));
        assert_eq!(parse(PAGE, r#"legato-spotify:{"done":true}"#), Some(Message::Done));
        assert_eq!(parse(PAGE, r#"legato-spotify:{"error":"boom"}"#), Some(Message::Failed("boom".into())));
    }

    #[test]
    fn other_senders_are_refused() {
        let m = r#"legato-spotify:{"done":true}"#;
        assert_eq!(parse("https://evil.example/", m), None);
        assert_eq!(parse("https://open.spotify.com.evil.example/", m), None);
        assert_eq!(parse("http://open.spotify.com/", m), None);
        assert_eq!(parse(PAGE, r#"{"done":true}"#), None);
        assert_eq!(parse(PAGE, "legato-spotify:not json"), None);
        assert_eq!(parse(PAGE, "legato-spotify:{}"), None);
        assert_eq!(parse(PAGE, &format!("legato-spotify:{}", " ".repeat(MAX_MESSAGE))), None);
    }

    #[test]
    fn list_pages_take_ids_only() {
        assert_eq!(list_path(LIKED).as_deref(), Some("collection/tracks"));
        assert_eq!(list_path(ID), Some(format!("playlist/{ID}")));
        assert_eq!(list_path("../settings"), None);
        assert_eq!(list_path(""), None);
    }
}
