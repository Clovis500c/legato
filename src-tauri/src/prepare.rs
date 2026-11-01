//! Before local songs play, the shell tells the engine what their files hold: where the music starts and ends (Skip
//! silences) and how loud it is (Volume levelling). Quick answers first: the cache (SQLite by path and modified time),
//! ReplayGain tags, the start of the playing file (the scan stops at its first loud window). The rest comes from one
//! background decode per file, once, which gives both. Nothing is decoded at scan time.

use crate::AppState;
use music_player::level::{Gain, Loudness, analyse};
use music_player::silence::leading;
use music_player::{Command, Trim};
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

/// One file of the run, and what it still lacks.
struct File {
    path: PathBuf,
    modified: i64,
    trim: bool,
    gain: bool,
    /// Its loudness measured before (LUFS, peak), used when it has no ReplayGain tags.
    measured: Option<(Option<f32>, f32)>,
}

/// Tells the engine the silences (`silence`) and levelling gains (`level`) of the first files of a run, before it plays
/// them. Best effort: an unreadable file plays as it is.
#[tauri::command]
pub async fn local_prepare(state: State<'_, AppState>, paths: Vec<String>, silence: bool, level: bool) -> Result<(), String> {
    let mut trims = Vec::new();
    let mut files = Vec::new();
    {
        let lib = state.lib();
        for path in paths.into_iter().take(NEAR).map(PathBuf::from) {
            let Some(m) = modified(&path) else { continue };
            let key = path.to_string_lossy().into_owned();
            let cached = if silence { lib.cached_silence(&key, m).ok().flatten() } else { None };
            if let Some((start_ms, end_ms, total_ms)) = cached {
                trims.push((path.clone(), Trim { start_ms, end_ms, total_ms }));
            }
            let measured = if level { lib.cached_loudness(&key, m).ok().flatten() } else { None };
            files.push(File { path, modified: m, trim: silence && cached.is_none(), gain: level, measured });
        }
    }
    // Quick, before the song starts: tags win over a measure (a scanner's album gain too); only the playing file's start
    // is scanned, the next ones wait for the background pass, so a press on play never waits on four files.
    let (files, found, gains) = tauri::async_runtime::spawn_blocking(move || {
        let mut gains = Vec::new();
        for f in files.iter_mut().filter(|f| f.gain) {
            let tagged = music_core::local::replay_gain(&f.path).map(|rg| Gain::tagged(rg.track_db, rg.track_peak, rg.album));
            match tagged.or_else(|| f.measured.and_then(|(lufs, peak)| Gain::measured(Loudness { lufs, peak }))) {
                Some(g) => {
                    gains.push((f.path.clone(), g));
                    f.gain = false;
                }
                // Measured silent throughout: nothing to level, nothing to measure again.
                None => f.gain = f.measured.is_none(),
            }
        }
        let found: Vec<_> = files.iter().filter(|f| f.trim).take(1).filter_map(|f| leading(&f.path).ok().map(|t| (f.path.clone(), t))).collect();
        (files, found, gains)
    })
    .await
    .map_err(|e| e.to_string())?;
    trims.extend(found);
    if !trims.is_empty() {
        state.player.send(Command::Trims { list: trims });
    }
    if !gains.is_empty() {
        state.player.send(Command::Gains { list: gains });
    }
    let missed: Vec<File> = files.into_iter().filter(|f| f.trim || f.gain).collect();
    if !missed.is_empty() {
        let app = state.app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            for f in missed {
                if !BUSY.lock().unwrap_or_else(std::sync::PoisonError::into_inner).get_or_insert_default().insert(f.path.clone()) {
                    continue;
                }
                if let Ok((t, loud)) = analyse(&f.path) {
                    let state = app.state::<AppState>();
                    let key = f.path.to_string_lossy();
                    {
                        let lib = state.lib();
                        let _ = lib.save_silence(&key, f.modified, t.start_ms, t.end_ms, t.total_ms);
                        let _ = lib.save_loudness(&key, f.modified, loud.lufs, loud.peak);
                    }
                    if f.trim {
                        state.player.send(Command::Trims { list: vec![(f.path.clone(), t)] });
                    }
                    if let Some(g) = Gain::measured(loud).filter(|_| f.gain) {
                        state.player.send(Command::Gains { list: vec![(f.path.clone(), g)] });
                    }
                }
                BUSY.lock().unwrap_or_else(std::sync::PoisonError::into_inner).get_or_insert_default().remove(&f.path);
            }
        });
    }
    Ok(())
}
