//! Skip silences (Settings › Playback): before local songs play, the shell tells the engine where their music starts
//! and ends. Cache = SQLite by path and modified time. The start is found fast (the scan stops at the first loud
//! window); the whole file is decoded in the background, once, for the end. Nothing is decoded at scan time.

use crate::AppState;
use music_player::{Command, Trim, silence};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{Manager, State};

/// Files looked at per call: the playing one and the next ones of its gapless run.
const NEAR: usize = 4;
/// Being decoded in full now (a second call for the same file waits for the first one's answer).
static BUSY: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

fn modified(path: &Path) -> Option<i64> {
    Some(std::fs::metadata(path).ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis() as i64)
}

/// Tells the engine the silences of the first files of a run, before it plays them. Best effort: an unreadable file
/// plays as it is.
#[tauri::command]
pub async fn silence_prepare(state: State<'_, AppState>, paths: Vec<String>) -> Result<(), String> {
    let wanted: Vec<(PathBuf, i64)> = paths.into_iter().take(NEAR).filter_map(|p| modified(Path::new(&p)).map(|m| (PathBuf::from(p), m))).collect();
    let mut known = Vec::new();
    let mut missed = Vec::new();
    {
        let lib = state.lib();
        for (path, m) in wanted {
            match lib.cached_silence(&path.to_string_lossy(), m).ok().flatten() {
                Some((start_ms, end_ms, total_ms)) => known.push((path, Trim { start_ms, end_ms, total_ms })),
                None => missed.push((path, m)),
            }
        }
    }
    // Start of the playing file only: fast, decoded until the first loud window (30 s at most). The next ones wait for
    // the background pass, so a press on play never waits on four files.
    let quick: Vec<_> = missed.iter().take(1).cloned().collect();
    let found = tauri::async_runtime::spawn_blocking(move || quick.into_iter().filter_map(|(path, _)| silence::leading(&path).ok().map(|t| (path, t))).collect::<Vec<_>>()).await.map_err(|e| e.to_string())?;
    known.extend(found);
    if !known.is_empty() {
        state.player.send(Command::Trims { list: known });
    }
    if !missed.is_empty() {
        let app = state.app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            for (path, m) in missed {
                if !BUSY.lock().unwrap_or_else(std::sync::PoisonError::into_inner).get_or_insert_default().insert(path.clone()) {
                    continue;
                }
                if let Ok(t) = silence::measure(&path) {
                    let state = app.state::<AppState>();
                    let _ = state.lib().save_silence(&path.to_string_lossy(), m, t.start_ms, t.end_ms, t.total_ms);
                    state.player.send(Command::Trims { list: vec![(path.clone(), t)] });
                }
                BUSY.lock().unwrap_or_else(std::sync::PoisonError::into_inner).get_or_insert_default().remove(&path);
            }
        });
    }
    Ok(())
}
