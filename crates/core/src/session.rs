//! What the operating system's media session says is playing (Windows: SMTC): title, artist, album, nothing more. No
//! sound is read; the Music Detector asks it first (a name for free, at once) before it listens. The OS half is in
//! `src-tauri/src/session.rs`; this half picks the right session and cleans its words.

use crate::model::Track;
use std::collections::BTreeMap;

/// One media session as the OS reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    /// The app behind it (Windows' AppUserModelId: `Spotify.exe`, `chrome.exe`, …).
    pub app: String,
    pub playing: bool,
    pub title: String,
    pub artist: String,
    pub album: String,
}

/// The song of the first session that is playing and says a title, never the app's own (`own`: a part of its id,
/// lower case). A session that says no artist is no song (a browser tab's page title, a video's file name).
pub fn pick(sessions: &[Session], own: &str) -> Option<Track> {
    let s = sessions.iter().find(|s| s.playing && !s.app.to_lowercase().contains(own) && !s.title.trim().is_empty() && !artist(&s.artist).is_empty())?;
    let album = s.album.trim();
    Some(Track {
        title: s.title.trim().to_string(),
        artist: artist(&s.artist),
        album: (!album.is_empty()).then(|| album.to_string()),
        duration_ms: None,
        isrc: None,
        ids: BTreeMap::new(),
        art: None,
        musicness: None,
        explicit: false,
    })
}

/// YouTube Music names an auto-generated channel "Artist - Topic".
fn artist(a: &str) -> String {
    let a = a.trim();
    a.strip_suffix(" - Topic").unwrap_or(a).trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(app: &str, playing: bool, title: &str, artist: &str) -> Session {
        Session { app: app.into(), playing, title: title.into(), artist: artist.into(), album: String::new() }
    }

    #[test]
    fn the_playing_session_names_the_song_and_a_paused_one_does_not() {
        let all = [s("Spotify.exe", false, "Old", "Someone"), s("chrome.exe", true, " Warriors ", "Imagine Dragons - Topic")];
        let t = pick(&all, "legato").unwrap();
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.album), ("Warriors", "Imagine Dragons", None));
        assert!(pick(&all[..1], "legato").is_none());
    }

    #[test]
    fn the_app_itself_and_pages_with_no_artist_are_not_songs() {
        let all = [s("app.legato.desktop", true, "Mine", "Me"), s("chrome.exe", true, "Some page", " "), s("vlc.exe", true, "", "Nobody")];
        assert!(pick(&all, "legato").is_none());
        let mut album = s("vlc.exe", true, "Song", "Band");
        album.album = "Record".into();
        assert_eq!(pick(&[album], "legato").unwrap().album.as_deref(), Some("Record"));
    }
}
