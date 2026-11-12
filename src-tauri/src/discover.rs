//! Home's "New from your artists" (a Home section, off until the user turns it on): albums, EPs and singles of the
//! last two months by the ten artists listened to most, from MusicBrainz. Only then does the app talk to
//! musicbrainz.org: each artist's name and a date, one request a second (its rule), once a day; the answer kept in
//! this PC's library. A refusal or a network error stops the round; the next try waits an hour.

use crate::{AppState, unix_now};
use music_connectors::musicbrainz::{MusicBrainz, Release};
use music_core::discover::{ARTISTS, DAYS, day, top_artists};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::State;

const KEY: &str = "newReleases";
const FRESH_S: i64 = 86_400;
const RETRY_S: i64 = 3_600;
/// MusicBrainz allows one request a second for each address.
const GAP: Duration = Duration::from_millis(1_100);

#[derive(Serialize, Deserialize)]
struct Saved {
    at: i64,
    releases: Vec<Release>,
}

/// One round at a time: Home opened again while one runs would ask MusicBrainz twice a second.
static ROUND: AtomicBool = AtomicBool::new(false);

struct Round;

impl Round {
    fn start() -> Option<Self> {
        (!ROUND.swap(true, Ordering::SeqCst)).then_some(Self)
    }
}

impl Drop for Round {
    fn drop(&mut self) {
        ROUND.store(false, Ordering::SeqCst);
    }
}

/// An artist's page › Find links on MusicBrainz (one click, two requests): the artist's name goes there, nothing else.
#[tauri::command]
pub async fn artist_links(name: String) -> Result<Vec<music_connectors::musicbrainz::ArtistLink>, String> {
    MusicBrainz::default().artist_links(&name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn new_releases(state: State<'_, AppState>) -> Result<Vec<Release>, String> {
    let now = unix_now();
    let (_round, artists) = {
        let lib = state.lib();
        let saved = lib.setting(KEY).ok().flatten().and_then(|v| serde_json::from_value::<Saved>(v).ok());
        let fresh = saved.as_ref().is_some_and(|s| now - s.at < FRESH_S);
        // Fresh, or a round under way: what is kept.
        let Some(round) = (!fresh).then(Round::start).flatten() else { return Ok(saved.map(|s| s.releases).unwrap_or_default()) };
        let stats = lib.play_stats().map_err(|e| e.to_string())?;
        let tracks = lib.tracks().map_err(|e| e.to_string())?;
        (round, top_artists(tracks.iter().map(|t| (t.track.artist.as_str(), stats.get(&t.id).map_or(0, |s| s.0))), ARTISTS))
    };
    let since = day(now - DAYS * 86_400);
    let mb = MusicBrainz::default();
    let mut releases = Vec::new();
    let mut complete = true;
    for (i, artist) in artists.iter().enumerate() {
        if i > 0 {
            tokio::time::sleep(GAP).await;
        }
        match mb.new_releases(artist, &since).await {
            Ok(found) => releases.extend(found),
            // No detail: a request's error can hold its address, the artist's name in it.
            Err(_) => {
                crate::diag::warn("discover", "MusicBrainz stopped the new releases", "");
                complete = false;
                break;
            }
        }
    }
    releases.sort_by(|a, b| b.date.cmp(&a.date));
    let saved = Saved { at: if complete { now } else { now - FRESH_S + RETRY_S }, releases };
    if let Ok(json) = serde_json::to_value(&saved) {
        let _ = state.lib().set_setting(KEY, &json);
    }
    Ok(saved.releases)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_round_at_a_time() {
        let first = Round::start();
        assert!(first.is_some() && Round::start().is_none());
        drop(first);
        assert!(Round::start().is_some());
    }
}
