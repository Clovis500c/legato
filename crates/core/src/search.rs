//! Catalog search results merged into one list: normal YouTube first (its own ranking, the widest catalog), then
//! YouTube Music songs and Apple Music tracks it didn't already show. Same recording = one hit.

use crate::matching::{merge_tracks, same_track};
use crate::model::{Source, Track};
use crate::musicness::Musicness;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    #[serde(flatten)]
    pub track: Track,
    pub musicness: Musicness,
}

/// `videos` = YouTube results with their classification; `songs` = YouTube Music songs; `apple` = Apple Music tracks.
/// A video matching a YouTube Music song keeps its video (what the user found) but takes the song's clean title,
/// artist, album and cover, and counts as music.
pub fn merge(videos: Vec<(Track, Musicness)>, songs: Vec<Track>, apple: Vec<Track>) -> Vec<Hit> {
    let mut out: Vec<Hit> = videos.into_iter().map(|(track, musicness)| Hit { track, musicness }).collect();
    for song in songs {
        match out.iter_mut().find(|h| same_track(&h.track, &song)) {
            Some(h) => {
                let video = h.track.ids.get(&Source::Youtube).cloned();
                h.track = merge_tracks(&song, &h.track);
                if let Some(v) = video {
                    h.track.ids.insert(Source::Youtube, v);
                }
                h.musicness = Musicness::Music;
            }
            None => out.push(Hit { track: song, musicness: Musicness::Music }),
        }
    }
    for t in apple {
        match out.iter_mut().find(|h| same_track(&h.track, &t)) {
            Some(h) => h.track = merge_tracks(&h.track, &t),
            None => out.push(Hit { track: t, musicness: Musicness::Music }),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn t(title: &str, artist: &str, ms: u32, source: Source, id: &str) -> Track {
        Track { title: title.into(), artist: artist.into(), duration_ms: Some(ms), ids: BTreeMap::from([(source, id.into())]), ..Default::default() }
    }

    #[test]
    fn videos_first_then_what_they_missed() {
        let videos = vec![(t("Get Lucky (Official Audio)", "Daft Punk", 248_000, Source::Youtube, "vid"), Musicness::Unsure), (t("Some talk", "Channel", 900_000, Source::Youtube, "talk"), Musicness::NotMusic)];
        let songs = vec![Track { album: Some("Random Access Memories".into()), ..t("Get Lucky", "Daft Punk", 248_000, Source::Youtube, "topic") }, t("Lose Yourself to Dance", "Daft Punk", 353_000, Source::Youtube, "lose")];
        let apple = vec![t("Get Lucky", "Daft Punk", 248_000, Source::Apple, "123"), t("Instant Crush", "Daft Punk", 337_000, Source::Apple, "456")];
        let hits = merge(videos, songs, apple);
        assert_eq!(hits.iter().map(|h| h.track.title.as_str()).collect::<Vec<_>>(), ["Get Lucky", "Some talk", "Lose Yourself to Dance", "Instant Crush"]);
        let lucky = &hits[0];
        // The video the user found, the song's clean data, and the Apple id.
        assert_eq!(lucky.track.ids[&Source::Youtube], "vid");
        assert_eq!(lucky.track.ids[&Source::Apple], "123");
        assert_eq!(lucky.track.album.as_deref(), Some("Random Access Memories"));
        assert_eq!(lucky.musicness, Musicness::Music);
        assert_eq!(hits[1].musicness, Musicness::NotMusic);
    }
}
