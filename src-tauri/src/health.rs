//! Library health (`features/library/HealthView.tsx`): songs that need a hand. What only Rust can tell: songs whose file
//! is gone that playlists still hold, local files with no cover. Videos the player found unplayable are the interface's.

use crate::{AppState, CmdResult, err};
use music_core::library::LibraryTrack;
use serde::Serialize;
use std::path::Path;
use tauri::State;

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LibraryHealth {
    /// Every source gone (a local file moved or deleted), still in a playlist: they can't play.
    gone: Vec<LibraryTrack>,
    /// Local songs with no picture in their file and none stored.
    no_cover: Vec<i64>,
}

/// Reads every local file's tags for a picture: seconds on a big library, so only when the page asks.
#[tauri::command]
pub async fn library_health(state: State<'_, AppState>) -> CmdResult<LibraryHealth> {
    let (gone, local) = {
        let lib = state.lib();
        (lib.sourceless().map_err(err)?, lib.local_files().map_err(err)?)
    };
    let no_cover = tauri::async_runtime::spawn_blocking(move || {
        local.into_iter().filter(|(_, file, art)| !art && Path::new(file).is_file() && music_core::local::picture(Path::new(file)).is_none()).map(|(id, ..)| id).collect()
    })
    .await
    .map_err(err)?;
    Ok(LibraryHealth { gone, no_cover })
}
