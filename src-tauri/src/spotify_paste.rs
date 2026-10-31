//! Spotify's songs by paste, any list, private ones and Liked Songs too, no sign-in: Ctrl+A then Ctrl+C in Spotify's
//! desktop app copies a list's songs as `open.spotify.com/track/…` links. Each is named from its public embed page
//! (`music_connectors::spotify_embed::track`), a few at a time, then the import screen's search at YouTube's pace. The
//! songs make a playlist of yours, those not found kept for Songs not found.

use crate::spotify_web::{SpotifyLibraryImport, SpotifyProgress, SpotifySong};
use crate::{AppState, CmdResult, err, links};
use music_connectors::linklist::MAX_TRACKS;
use music_connectors::spotify_embed;
use music_core::library::PlaylistEdit;
use music_core::model::Track;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// Pasted text read, at most: 3,000 links fit well under.
const MAX_TEXT: usize = 1 << 20;
/// Pages asked for at once: Spotify's own site, gently.
const AT_ONCE: usize = 4;

/// One song's names, once more after a moment when Spotify is slow (one real page gave a 504). None: unread.
async fn named(id: String) -> Option<Track> {
    for wait in [0, 2] {
        tokio::time::sleep(Duration::from_secs(wait)).await;
        match spotify_embed::track(spotify_embed::EMBED, &id).await {
            Ok(t) => return Some(t),
            Err(e) if e.to_string().contains("doesn't exist") => return None,
            Err(_) => {}
        }
    }
    None
}

#[tauri::command]
pub async fn import_spotify_tracks(app: AppHandle, state: State<'_, AppState>, name: String, text: String) -> CmdResult<SpotifyLibraryImport> {
    // Trust boundary: pasted text, bounded; the name too.
    if text.len() > MAX_TEXT {
        return Err("Text too long for a list of songs (1 MB max)".into());
    }
    let ids = spotify_embed::track_ids(&text, MAX_TRACKS);
    if ids.is_empty() {
        return Err("No Spotify song links in that text".into());
    }
    let name: String = Some(name.trim()).filter(|n| !n.is_empty()).unwrap_or("Spotify").chars().take(100).collect();
    let _running = links::begin()?;
    let total = ids.len();
    let tell = |matching, done, playable, wait_secs, song: Option<&Track>| {
        let _ = app.emit_to("main", "spotify-import", SpotifyProgress { name: name.clone(), list: 1, lists: 1, matching, done, total, all_done: 0, all_total: 0, playable, searched: 0, to_search: 0, wait_secs, song: song.map(SpotifySong::from) });
    };
    tell(false, 0, 0, 0, None);
    let mut read = Vec::with_capacity(total);
    for (n, chunk) in ids.chunks(AT_ONCE).enumerate() {
        if links::stopped() {
            return Err("canceled".into());
        }
        let jobs: Vec<_> = chunk.iter().cloned().map(|id| tauri::async_runtime::spawn(named(id))).collect();
        for job in jobs {
            read.extend(job.await.map_err(err)?);
        }
        tell(false, (n * AT_ONCE + chunk.len()).min(total), 0, 0, read.last());
    }
    if read.is_empty() {
        return Err("Spotify's pages didn't answer: try again later".into());
    }
    let Some(links::Found { tracks, unsearched }) = links::find_on_youtube(&app, &read, |step| tell(true, step.done, step.found, step.wait_secs, step.song)).await? else { return Err("canceled".into()) };
    let id = {
        let lib = state.lib();
        let id = lib.edit_playlist(PlaylistEdit::Create { name: name.clone() }).map_err(err)?.ok_or("Playlist not created")?;
        let mut ids = Vec::with_capacity(tracks.len());
        for t in &tracks {
            // Asked for by hand: a song removed earlier comes back.
            lib.unremove(t).map_err(err)?;
            ids.push(lib.upsert_track(t).map_err(err)?);
        }
        lib.edit_playlist(PlaylistEdit::Add { id, track_ids: ids }).map_err(err)?;
        id
    };
    // Saved only now, so remembered only now. YouTube's refusals left some unsearched: can't tell which.
    if unsearched == 0 {
        for song in tracks.iter().filter(|t| !links::has_version(t) && !state.lib().not_found_lately(t).unwrap_or(true)) {
            links::note_search(&state, song);
        }
    }
    let playable = tracks.iter().filter(|t| links::has_version(t)).count();
    Ok(SpotifyLibraryImport { playlist_id: Some(id), lists: 1, songs: total, playable, failed: Vec::new(), unsearched })
}
