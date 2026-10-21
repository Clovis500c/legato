//! Live Editor: effects for the native engine, saved edits per song (SQLite `edits`), and the WAV export of local
//! files (`music_player::export`).

use crate::{AppState, CmdResult, err, unix_now};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, State};

/// Trust boundary: a song key the UI makes (features/player/effects.ts songKey).
fn song_key_ok(song: &str) -> bool {
    song.len() <= 1024 && (song.starts_with("t:") || song.starts_with("yt:") || song.starts_with("f:"))
}

/// Live Editor: a song's saved edits, or the presets (song None).
#[tauri::command]
pub fn edits(state: State<AppState>, song: Option<String>) -> CmdResult<Vec<music_core::library::Edit>> {
    if song.as_deref().is_some_and(|s| !song_key_ok(s)) {
        return Err("bad song key".into());
    }
    state.lib.lock().unwrap().edits(song.as_deref()).map_err(err)
}

/// New (id None) or changed edit; effects clamped, stored as numbers only. Returns its id.
#[tauri::command]
pub fn save_edit(state: State<AppState>, id: Option<i64>, song: Option<String>, name: String, effects: music_player::Effects) -> CmdResult<i64> {
    let name: String = name.trim().chars().take(60).collect();
    if name.is_empty() || song.as_deref().is_some_and(|s| !song_key_ok(s)) {
        return Err("bad edit".into());
    }
    let json = serde_json::to_string(&effects.clamped()).map_err(err)?;
    state.lib.lock().unwrap().save_edit(id, song.as_deref(), &name, &json, unix_now()).map_err(err)
}

#[tauri::command]
pub fn delete_edit(state: State<AppState>, id: i64) -> CmdResult<()> {
    state.lib.lock().unwrap().delete_edit(id).map_err(err)
}

/// The edit that plays with this song from now on (None = as is).
#[tauri::command]
pub fn activate_edit(state: State<AppState>, song: String, id: Option<i64>) -> CmdResult<()> {
    if !song_key_ok(&song) {
        return Err("bad song key".into());
    }
    state.lib.lock().unwrap().activate_edit(&song, id).map_err(err)
}

/// Live Editor settings for the native engine (local files, previews). Clamped on the way in.
#[tauri::command]
pub fn player_effects(state: State<AppState>, effects: music_player::Effects) {
    state.player.set_effects(effects);
}

static EXPORT_BUSY: AtomicBool = AtomicBool::new(false);

static EXPORT_STOP: AtomicBool = AtomicBool::new(false);

/// Live Editor: a local file's copy with `effects` applied, as a new WAV (`output`, picked in the save dialog). Local
/// files only: `input` is a path on disk, never a stream. Progress: "export" events (0..1, null = length unknown).
#[tauri::command]
pub async fn export_edit(app: tauri::AppHandle, input: String, output: String, effects: music_player::Effects) -> CmdResult<()> {
    let (input, output) = (PathBuf::from(input), PathBuf::from(output));
    if !input.is_absolute() || !input.is_file() || !output.is_absolute() {
        return Err("not a local file".into());
    }
    if EXPORT_BUSY.swap(true, Ordering::AcqRel) {
        return Err("an export is already running".into());
    }
    EXPORT_STOP.store(false, Ordering::Relaxed);
    let done = tauri::async_runtime::spawn_blocking(move || {
        music_player::export::export(&input, &output, effects, &EXPORT_STOP, |p| {
            let _ = app.emit_to("main", "export", p);
        })
    })
    .await;
    EXPORT_BUSY.store(false, Ordering::Release);
    done.map_err(err)?.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_stop() {
    EXPORT_STOP.store(true, Ordering::Relaxed);
}
