//! Settings › General › Library backup: the whole library in one file, and back (`music_core::library`).

use crate::{AppState, CmdResult, err};
use std::path::Path;
use tauri::{AppHandle, Manager, State};

/// A consistent copy of the library at `path`, the user's pick.
#[tauri::command]
pub async fn library_backup(app: AppHandle, path: String) -> CmdResult<()> {
    let db = app.path().app_data_dir().map_err(err)?.join("library.db");
    tauri::async_runtime::spawn_blocking(move || music_core::library::back_up(&db, Path::new(&path))).await.map_err(err)?.map_err(err)
}

/// The backup at `path` replaces the library, then the app restarts on it.
#[tauri::command]
pub async fn library_restore(app: AppHandle, state: State<'_, AppState>, path: String) -> CmdResult<()> {
    state.lib().restore(Path::new(&path)).map_err(err)?;
    crate::diag::closing();
    crate::window_place::save(&app);
    app.restart()
}
