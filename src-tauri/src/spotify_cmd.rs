//! Spotify: the player and its playback state, a pasted link imported, the web page's window; YouTube Music's sign-in window.

use super::*;

pub fn spotify_on(state: &AppState) -> CmdResult<Spotify> {
    state.spotify().filter(|s| s.is_connected()).ok_or_else(|| "Connect Spotify first (Settings › Sources)".into())
}

/// Spotify Connect remote: the user's own Spotify app plays.
#[tauri::command]
pub async fn spotify_player(state: State<'_, AppState>, cmd: music_connectors::spotify::PlayerCommand) -> CmdResult<()> {
    spotify_on(&state)?.command(cmd).await.map_err(err)
}

#[tauri::command]
pub async fn spotify_playback(state: State<'_, AppState>) -> CmdResult<Option<music_connectors::spotify::Playback>> {
    spotify_on(&state)?.playback().await.map_err(err)
}

/// Google sign-in window for YouTube Music (no keys). add = sign in one more Google account.
#[tauri::command]
pub async fn ytm_sign_in(app: tauri::AppHandle, add: bool) -> CmdResult<()> {
    ytm::open(&app, add).map_err(err)
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SpotifyImport {
    playlist_id: i64,
    name: String,
    tracks: usize,
    /// Tracks with a YouTube version (they play in full).
    playable: usize,
    /// Only the embed's first 100 came in (a longer playlist, no Spotify key to read the rest).
    truncated: bool,
}

/// Public Spotify playlist or album link → imported playlist, no account. Each track gets its YouTube version (playback).
#[tauri::command]
pub async fn import_spotify_link(app: tauri::AppHandle, state: State<'_, AppState>, url: String) -> CmdResult<SpotifyImport> {
    use music_connectors::spotify_embed;
    // Trust boundary: clipboard / typed text.
    if url.len() > 2048 {
        return Err("Link too long".into());
    }
    let mut list = spotify_embed::fetch(spotify_embed::EMBED, url.trim()).await.map_err(err)?;
    // The embed stops at 100: with the user's own Spotify key, the whole playlist from the API (paged).
    let mut truncated = list.kind == "playlist" && list.tracks.len() >= spotify_embed::EMBED_MAX;
    if truncated
        && let Some(sp) = state.spotify().filter(|s| s.is_connected())
        && let Ok(all) = sp.playlist_tracks(&list.id).await
        && all.len() > list.tracks.len()
    {
        list.tracks = all;
        truncated = false;
    }
    // Each song's YouTube version, signed in or not: YouTube Music's songs, then a music video (with_youtube). Signed
    // out, imports used to come in with nothing playable (2026-10-30). 6 at a time: quick, still polite.
    let mut tracks = Vec::with_capacity(list.tracks.len());
    for chunk in list.tracks.chunks(6) {
        let jobs: Vec<_> = chunk
            .iter()
            .cloned()
            .map(|t| {
                let app = app.clone();
                tauri::async_runtime::spawn(async move { with_youtube(&app.state::<AppState>(), t).await })
            })
            .collect();
        for job in jobs {
            tracks.push(job.await.map_err(err)?);
        }
    }
    let playable = tracks.iter().filter(|t| t.ids.contains_key(&Source::Youtube)).count();
    // Same id as a keyed Spotify sync, so both update one playlist. Albums get their own prefix.
    let source_id = if list.kind == "album" { format!("album:{}", list.id) } else { list.id.clone() };
    let playlist_id = state.lib().save_playlist(Source::Spotify, &source_id, &list.name, &tracks).map_err(err)?;
    Ok(SpotifyImport { playlist_id, name: list.name, tracks: tracks.len(), playable, truncated })
}

/// Spotify's official web player in an app window (prototype, no keys).
#[tauri::command]
pub async fn spotify_web_open(app: tauri::AppHandle) -> CmdResult<()> {
    spotify_web::open(&app).map_err(err)
}

#[tauri::command]
pub async fn spotify_web_status(app: tauri::AppHandle) -> bool {
    spotify_web::signed_in(&app)
}
