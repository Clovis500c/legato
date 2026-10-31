//! Catalog search results merged into one list: normal YouTube first (its own ranking, the widest catalog), then
//! YouTube Music songs and Apple Music tracks it didn't already show. Same recording = one hit.

use crate::matching::{merge_tracks, same_track};
use crate::model::{Source, Track};
use crate::musicness::Musicness;
use serde::Serialize;

/// Where a hit was found: YouTube's video search, YouTube Music's songs, Apple Music's catalog.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Origin {
    Youtube,
    Ytmusic,
    Apple,
}

#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Hit {
    #[serde(flatten)]
    pub track: Track,
    /// Same JSON key as the flattened track's (None for a hit): TS keeps the track's.
    #[ts(skip)]
    pub musicness: Musicness,
    /// Each search that found it, in that order (Search page: per-source counts, songs vs videos).
    pub from: Vec<Origin>,
}

/// Two songs of one search can match the same hit: each origin once.
fn found_by(from: &mut Vec<Origin>, o: Origin) {
    if !from.contains(&o) {
        from.push(o);
    }
}

/// `videos` = YouTube results with their classification; `songs` = YouTube Music songs; `apple` = Apple Music tracks.
/// A video matching a YouTube Music song keeps its video (what the user found) but takes the song's clean title,
/// artist, album and cover, and counts as music.
pub fn merge(videos: Vec<(Track, Musicness)>, songs: Vec<Track>, apple: Vec<Track>) -> Vec<Hit> {
    let mut out: Vec<Hit> = videos.into_iter().map(|(track, musicness)| Hit { track, musicness, from: vec![Origin::Youtube] }).collect();
    for song in songs {
        match out.iter_mut().find(|h| same_track(&h.track, &song)) {
            Some(h) => {
                let video = h.track.ids.get(&Source::Youtube).cloned();
                h.track = merge_tracks(&song, &h.track);
                if let Some(v) = video {
                    h.track.ids.insert(Source::Youtube, v);
                }
                h.musicness = Musicness::Music;
                found_by(&mut h.from, Origin::Ytmusic);
            }
            None => out.push(Hit { track: song, musicness: Musicness::Music, from: vec![Origin::Ytmusic] }),
        }
    }
    for t in apple {
        match out.iter_mut().find(|h| same_track(&h.track, &t)) {
            Some(h) => {
                h.track = merge_tracks(&h.track, &t);
                found_by(&mut h.from, Origin::Apple);
            }
            None => out.push(Hit { track: t, musicness: Musicness::Music, from: vec![Origin::Apple] }),
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
        assert_eq!(lucky.from, [Origin::Youtube, Origin::Ytmusic, Origin::Apple]);
        assert_eq!(hits[1].from, [Origin::Youtube]);
        assert_eq!(hits[2].from, [Origin::Ytmusic]);
        assert_eq!(hits[3].from, [Origin::Apple]);
    }
}
