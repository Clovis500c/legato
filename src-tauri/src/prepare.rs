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
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

/// Files looked at per call: the playing one and the next ones of its gapless run.
const NEAR: usize = 4;
/// Being decoded in full now (a second call for the same file waits for the first one's answer).
static BUSY: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);
/// The longest wait for another call's decode of the same file.
const WAIT: Duration = Duration::from_secs(30);

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
/// them. Best effort: an unreadable file plays as it is. Server songs: their server's own gains only (`servers::gains`).
#[tauri::command]
pub async fn local_prepare(state: State<'_, AppState>, paths: Vec<String>, silence: bool, level: bool) -> Result<(), String> {
    let (remote, paths): (Vec<PathBuf>, Vec<PathBuf>) = paths.into_iter().take(NEAR).map(PathBuf::from).partition(|p| music_player::http::is_remote(p));
    if level && !remote.is_empty() {
        crate::servers::gains(&state, remote).await;
    }
    let mut trims = Vec::new();
    let mut files = Vec::new();
    {
        let lib = state.lib();
        for path in paths {
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
                if let Some((t, loud, _)) = measure(&app, &f.path, f.modified) {
                    let state = app.state::<AppState>();
                    if f.trim {
                        state.player.send(Command::Trims { list: vec![(f.path.clone(), t)] });
                    }
                    if let Some(g) = Gain::measured(loud).filter(|_| f.gain) {
                        state.player.send(Command::Gains { list: vec![(f.path.clone(), g)] });
                    }
                }
            }
        });
    }
    Ok(())
}

/// What a local song's ends hold, as the earlier measures kept them (silence at the start and the end, loudness).
#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SongEnds {
    pub track_id: i64,
    /// Silence before the music, ms.
    pub head_ms: u64,
    /// Silence after the music, ms.
    pub tail_ms: u64,
    /// Integrated loudness, LUFS; none for a file measured silent.
    pub lufs: Option<f32>,
}

/// The kept silence `(start, end, total)` and loudness of a file → its ends.
fn ends_of(track_id: i64, silence: (u64, Option<u64>, u64), lufs: Option<f32>) -> SongEnds {
    let (start, end, total) = silence;
    SongEnds { track_id, head_ms: start.min(total), tail_ms: end.map_or(0, |e| total.saturating_sub(e)), lufs }
}

/// What is already known of these songs' ends (local files that played or were measured; nothing is decoded here), for
/// Settings › Playback › Sweet fades. Eight songs at most; a song with no measure is left out.
#[tauri::command]
pub async fn song_ends(state: State<'_, AppState>, track_ids: Vec<i64>) -> Result<Vec<SongEnds>, String> {
    let lib = state.lib();
    let mut out = Vec::new();
    for id in track_ids.into_iter().take(8) {
        let Some(path) = lib.local_path(id).map_err(|e| e.to_string())? else { continue };
        let Some(modified) = modified(Path::new(&path)) else { continue };
        let Some(silence) = lib.cached_silence(&path, modified).ok().flatten() else { continue };
        let lufs = lib.cached_loudness(&path, modified).ok().flatten().and_then(|(lufs, _)| lufs);
        out.push(ends_of(id, silence, lufs));
    }
    Ok(out)
}

fn busy() -> std::sync::MutexGuard<'static, Option<HashSet<PathBuf>>> {
    BUSY.lock().unwrap_or_else(PoisonError::into_inner)
}

/// One full decode of a local file, its answers kept (silences, loudness, shape); the same file being decoded by another
/// call: that one's answers, once it is done. None when the file can't be read.
fn measure(app: &AppHandle, path: &Path, modified: i64) -> Option<(Trim, Loudness, Vec<u8>)> {
    let key = path.to_string_lossy().into_owned();
    let state = app.state::<AppState>();
    if !busy().get_or_insert_default().insert(path.to_path_buf()) {
        let start = std::time::Instant::now();
        while busy().get_or_insert_default().contains(path) && start.elapsed() < WAIT {
            std::thread::sleep(Duration::from_millis(100));
        }
        let lib = state.lib();
        let (start_ms, end_ms, total_ms) = lib.cached_silence(&key, modified).ok().flatten()?;
        let (lufs, peak) = lib.cached_loudness(&key, modified).ok().flatten()?;
        let shape = lib.cached_waveform(&key, modified).ok().flatten().unwrap_or_default();
        return Some((Trim { start_ms, end_ms, total_ms }, Loudness { lufs, peak }, shape));
    }
    let found = analyse(path).ok();
    if let Some((t, loud, shape)) = &found {
        let lib = state.lib();
        let _ = lib.save_silence(&key, modified, t.start_ms, t.end_ms, t.total_ms);
        let _ = lib.save_loudness(&key, modified, loud.lufs, loud.peak);
        if !shape.is_empty() {
            let _ = lib.save_waveform(&key, modified, shape);
        }
    }
    busy().get_or_insert_default().remove(path);
    found
}

/// A local file's shape for the seek bar (Settings › Appearance › Progress bar › Song's shape): the cache, else one full
/// decode now, which keeps its silences and loudness too. None when it can't be read. Local files only: a stream's
/// audio is never taken for it.
#[tauri::command]
pub async fn local_waveform(state: State<'_, AppState>, path: String) -> Result<Option<Vec<u8>>, String> {
    let path = PathBuf::from(path);
    let Some(m) = modified(&path) else { return Ok(None) };
    if let Some(shape) = state.lib().cached_waveform(&path.to_string_lossy(), m).map_err(|e| e.to_string())? {
        return Ok(Some(shape));
    }
    let app = state.app.clone();
    let found = tauri::async_runtime::spawn_blocking(move || measure(&app, &path, m)).await.map_err(|e| e.to_string())?;
    Ok(found.map(|(_, _, shape)| shape).filter(|s| !s.is_empty()))
}

#[cfg(test)]
mod ends_tests {
    use super::ends_of;

    #[test]
    fn silences_become_head_and_tail() {
        let e = ends_of(7, (1200, Some(178_000), 180_000), Some(-14.5));
        assert_eq!((e.track_id, e.head_ms, e.tail_ms, e.lufs), (7, 1200, 2000, Some(-14.5)));
        let none = ends_of(8, (0, None, 90_000), None);
        assert_eq!((none.head_ms, none.tail_ms), (0, 0));
        // A forged cache row cannot make a negative tail or a head past the end.
        let odd = ends_of(9, (500_000, Some(900_000), 100_000), None);
        assert_eq!((odd.head_ms, odd.tail_ms), (100_000, 0));
    }
}
