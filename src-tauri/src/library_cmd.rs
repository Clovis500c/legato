//! The library for the interface: songs and playlists, changes since a version, local folders and their rescans, a pasted link added.

use super::*;

#[derive(Serialize, ts_rs::TS)]
#[ts(export)]
pub struct LibraryData {
    tracks: Vec<LibraryTrack>,
    playlists: Vec<LibraryPlaylist>,
    /// Track ids of every playlist in order: covers (first song, grid of 4) are picked from them.
    orders: HashMap<i64, Vec<i64>>,
}

/// The whole library. After an edit, `library_changes` brings what changed instead.
#[tauri::command]
pub async fn library(state: State<'_, AppState>) -> CmdResult<Response> {
    // Lock held while computing: no write can slip between the version read, the answer and the change log emptied.
    let lib = state.lib();
    let answer = state.cache.library.get_or((), lib.versions.library(), || {
        serde_json::to_string(&LibraryData { tracks: lib.tracks().map_err(err)?, playlists: lib.playlists().map_err(err)?, orders: lib.playlist_orders().map_err(err)? }).map_err(err)
    })?;
    lib.forget_changes().map_err(err)?;
    Ok(json(answer))
}

/// Songs and playlists written since the last library read (any write: likes, edits, syncs, Sync Mode), whole rows. None =
/// more than a few thousand songs: read the library whole.
#[tauri::command]
pub async fn library_changes(state: State<'_, AppState>) -> CmdResult<Option<Changes>> {
    state.lib().take_changes(5_000).map_err(err)
}

#[tauri::command]
pub async fn playlist_tracks(state: State<'_, AppState>, id: i64) -> CmdResult<Response> {
    let lib = state.lib();
    let answer = state.cache.playlist.get_or(id, lib.versions.library(), || serde_json::to_string(&lib.playlist_tracks(id).map_err(err)?).map_err(err))?;
    Ok(json(answer))
}

pub fn folders(lib: &Library) -> Vec<String> {
    lib.setting("folders").ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

/// Audio files dropped on their own, outside the watched folders (`folders::add_dropped`).
pub fn loose_files(lib: &Library) -> Vec<String> {
    lib.setting("files").ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

/// Scan off the IPC thread, then mirror into library. Returns local file count. Files dropped on their own go with the
/// folders.
pub async fn rescan(state: &AppState, dirs: Vec<String>) -> CmdResult<usize> {
    let loose = loose_files(&state.lib());
    let paths: Vec<PathBuf> = dirs.iter().chain(&loose).map(PathBuf::from).collect();
    // Files read so far, told to the interface (at most every 200 ms, and the last): Songs shows it while a big folder reads.
    let app = state.app.clone();
    let last = std::sync::atomic::AtomicU64::new(0);
    let started = std::time::Instant::now();
    let tracks = tauri::async_runtime::spawn_blocking(move || {
        music_core::local::scan_with(&paths, &|done, total| {
            let now = started.elapsed().as_millis() as u64;
            if done == total || now >= last.load(std::sync::atomic::Ordering::Relaxed) + 200 {
                last.store(now, std::sync::atomic::Ordering::Relaxed);
                let _ = app.emit("scan-progress", [done, total]);
            }
        })
    })
    .await
    .map_err(err)?;
    state.lib().replace_local(&tracks).map_err(err)
}

#[tauri::command]
pub async fn local_folders(state: State<'_, AppState>) -> CmdResult<Vec<String>> {
    Ok(folders(&state.lib()))
}

#[tauri::command]
pub async fn set_local_folders(state: State<'_, AppState>, folders: Vec<String>) -> CmdResult<usize> {
    // Trust boundary: existing absolute folders only.
    let clean: Vec<String> = folders.into_iter().map(|f| f.trim().to_string()).filter(|f| Path::new(f).is_absolute() && Path::new(f).is_dir()).take(music_core::local::MAX_FOLDERS).collect();
    state.lib().set_setting("folders", &serde_json::json!(clean)).map_err(err)?;
    folders::watch(&state.app, &clean);
    rescan(&state, clean).await
}

#[tauri::command]
pub async fn rescan_local(state: State<'_, AppState>) -> CmdResult<usize> {
    let dirs = folders(&state.lib());
    rescan(&state, dirs).await
}

/// Pasted link → library track: a YouTube video, or a SoundCloud song found on YouTube. Returns "Artist – Title" for
/// the notice.
#[tauri::command]
pub async fn add_link(state: State<'_, AppState>, url: String) -> CmdResult<String> {
    // Trust boundary: clipboard text.
    if url.len() > 2048 {
        return Err("Link too long".into());
    }
    let url = url.trim();
    let t = match links::song_link(&state, url).await? {
        Some(t) => t,
        None => music_connectors::youtube::track_from_link(url, music_connectors::youtube::OEMBED).await.map_err(err)?,
    };
    {
        // Added by hand: a song removed earlier comes back.
        let lib = state.lib();
        lib.unremove(&t).map_err(err)?;
        lib.upsert_track(&t).map_err(err)?;
    }
    Ok(format!("{} – {}", t.artist, t.title))
}
