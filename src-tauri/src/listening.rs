//! Listening: a play recorded, the mixes, a path between two artists, finds blocked, the radios.

use super::*;

pub fn unix_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

#[tauri::command]
pub async fn record_play(state: State<'_, AppState>, play: Play) -> CmdResult<()> {
    // Trust boundary: plausible times only (no future plays skewing scores).
    let now = unix_now();
    if !(0..=now + 60).contains(&play.started_at) || play.listened_ms > 24 * 3600 * 1000 {
        return Err("Invalid play".into());
    }
    state.lib().record_play(&play).map_err(err)
}

/// Mixes for today. `utc_offset` = local minus UTC, seconds (from the UI clock).
#[tauri::command]
pub async fn mixes(state: State<'_, AppState>, utc_offset: i64) -> CmdResult<Response> {
    let utc_offset = utc_offset.clamp(-14 * 3600, 14 * 3600);
    let now = unix_now();
    let (stamp, (tracks, plays, playlists, saved, liked, prefs)) = {
        let lib = state.lib();
        // Same data, same day, same hour: same mixes.
        let stamp = (lib.versions.library(), lib.versions.history(), today(), (now + utc_offset).div_euclid(3600));
        if let Some(hit) = state.cache.mixes.peek(&utc_offset, &stamp) {
            return Ok(json(hit));
        }
        (stamp, (lib.tracks().map_err(err)?, lib.plays().map_err(err)?, lib.custom_playlists().map_err(err)?, lib.saved_playlists().map_err(err)?, lib.liked_tracks().map_err(err)?, lib.prefs().map_err(err)?))
    };
    let input = music_core::mixes::Input { tracks: &tracks, plays: &plays, playlists: &playlists, saved: &saved, liked: &liked, prefs: &prefs, now, utc_offset, seed: today(), found: &[] };
    let found = music_core::mixes::without_blocked(radios(&state, music_core::mixes::seeds(&input)).await, &blocked_finds(&state));
    let answer = state.cache.mixes.get_or(utc_offset, stamp, || serde_json::to_string(&music_core::mixes::mixes(&music_core::mixes::Input { found: &found, ..input })).map_err(err))?;
    Ok(json(answer))
}

/// A walk from one artist to another through the artists listened to together (`walk::artist_path`); None = no chain.
#[tauri::command]
pub async fn artist_path(state: State<'_, AppState>, from: String, to: String) -> CmdResult<Option<music_core::walk::ArtistPath>> {
    if from.chars().count() > 300 || to.chars().count() > 300 {
        return Err("Not an artist".into());
    }
    let (tracks, plays, playlists, saved, liked, prefs) = {
        let lib = state.lib();
        (lib.tracks().map_err(err)?, lib.plays().map_err(err)?, lib.custom_playlists().map_err(err)?, lib.saved_playlists().map_err(err)?, lib.liked_tracks().map_err(err)?, lib.prefs().map_err(err)?)
    };
    let input = music_core::mixes::Input { tracks: &tracks, plays: &plays, playlists: &playlists, saved: &saved, liked: &liked, prefs: &prefs, now: unix_now(), utc_offset: 0, seed: 0, found: &[] };
    Ok(music_core::walk::artist_path(&input, &from, &to))
}

/// Songs found by the mixes' radios that the user said never to see again (their `match_key`s, in the library's settings).
pub const BLOCKED_FINDS: &str = "blockedFinds";
pub const MAX_BLOCKED: usize = 2_000;

pub fn blocked_finds(state: &AppState) -> std::collections::HashSet<String> {
    state.lib().setting(BLOCKED_FINDS).ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

/// "Never in mixes" on a song a mix discovered (it has no library row): its title and artist are remembered (`block`
/// false: its Undo), and the mixes are made again.
#[tauri::command]
pub async fn block_find(state: State<'_, AppState>, title: String, artist: String, block: bool) -> CmdResult<()> {
    if title.trim().is_empty() || title.chars().count() > 300 || artist.chars().count() > 300 {
        return Err("Not a song".into());
    }
    let mut all = blocked_finds(&state);
    music_core::mixes::set_blocked(&mut all, &title, &artist, block, MAX_BLOCKED);
    state.lib().set_setting(BLOCKED_FINDS, &serde_json::to_value(&all).map_err(err)?).map_err(err)?;
    state.cache.mixes.clear();
    Ok(())
}

/// YouTube Music's radio of each mix seed (track id, video id): the mixes' discoveries. Kept for hours; a radio that
/// fails (offline) is left out, the mixes come without its songs.
pub async fn radios(state: &AppState, seeds: Vec<(i64, String)>) -> Vec<(i64, Vec<Track>)> {
    let mut yt: Option<Arc<YouTubeMusic>> = None;
    let mut out = Vec::new();
    let mut asked = Vec::new();
    for (id, video) in seeds {
        if let Some(hit) = state.cache.radios.get(&video) {
            out.push((id, (*hit).clone()));
            continue;
        }
        let list = ListRef::Radio { video_id: Some(video.clone()), playlist_id: format!("RDAMVM{video}") };
        // Trust boundary: ids go into YouTube requests.
        if !list.valid() {
            continue;
        }
        // Signed out: anonymous radios.
        let yt = yt.get_or_insert_with(|| Arc::new(state.ytm_or_public())).clone();
        asked.push((id, video, tauri::async_runtime::spawn(async move { yt.list_tracks(&list).await })));
    }
    for (id, video, task) in asked {
        if let Ok(Ok(tracks)) = task.await {
            out.push((id, (*state.cache.radios.put(&video, tracks)).clone()));
        }
    }
    out
}
