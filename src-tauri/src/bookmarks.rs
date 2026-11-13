//! Bookmarks: moments of a library song kept, listed and deleted.

use super::*;

/// A moment of a library song kept, with an optional note (the player's "Bookmark this moment"): the song's bookmarks
/// after, None when it can't keep more (gone, or full).
#[tauri::command]
pub async fn add_bookmark(state: State<'_, AppState>, track_id: i64, ms: i64, note: String) -> CmdResult<Option<Vec<music_core::library::Bookmark>>> {
    let lib = state.lib();
    if !lib.add_bookmark(track_id, ms, &note, music_core::library::now_ms()).map_err(err)? {
        return Ok(None);
    }
    lib.bookmarks(track_id).map(Some).map_err(err)
}

#[tauri::command]
pub async fn bookmarks(state: State<'_, AppState>, track_id: i64) -> CmdResult<Vec<music_core::library::Bookmark>> {
    state.lib().bookmarks(track_id).map_err(err)
}

/// One bookmark gone: its song's bookmarks after.
#[tauri::command]
pub async fn delete_bookmark(state: State<'_, AppState>, id: i64, track_id: i64) -> CmdResult<Vec<music_core::library::Bookmark>> {
    let lib = state.lib();
    lib.delete_bookmark(id).map_err(err)?;
    lib.bookmarks(track_id).map_err(err)
}
