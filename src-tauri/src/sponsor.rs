//! Skip non-music parts (Settings › Playback, off by default): SponsorBlock's community segments for a YouTube video,
//! asked by the first 4 hex characters of the id's hash only (the id never leaves the PC). Cached per video in SQLite,
//! the empty answer too, for a week so new segments can arrive. A failure is no skip: the song plays on.

use crate::{AppState, hosts, unix_now};
use music_connectors::sponsorblock::{Segment, SponsorBlock};
use tauri::State;

const FRESH_S: i64 = 7 * 86_400;

#[tauri::command]
pub async fn sponsor_segments(state: State<'_, AppState>, video: String) -> Result<Vec<Segment>, String> {
    let now = unix_now();
    let cached = state.lib().cached_sponsor(&video).ok().flatten();
    if let Some((body, at)) = cached
        && now - at < FRESH_S
        && let Ok(list) = serde_json::from_str::<Vec<Segment>>(&body)
    {
        return Ok(list);
    }
    let list = SponsorBlock::with_urls(hosts::get().sponsorblock).segments(&video).await.map_err(|e| e.to_string())?;
    if let Ok(json) = serde_json::to_string(&list) {
        let _ = state.lib().save_sponsor(&video, &json, now);
    }
    Ok(list)
}
