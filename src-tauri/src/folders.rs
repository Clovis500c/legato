//! Local music folders watched (Settings › Accounts › Local files): audio files added, removed or renamed there show
//! up in the library on their own, 2 s after the last change (a copy of a whole album is one rescan). Files and folders
//! dropped from Explorer join them (`add_dropped`).

use crate::{AppState, CmdResult, err};
use music_core::model::Source;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::mpsc::{RecvTimeoutError, channel};
use std::time::Duration;
use tauri::{Emitter, Manager, State};

/// Quiet this long after the last change: then one rescan.
const SETTLE: Duration = Duration::from_secs(2);

static WATCHER: Mutex<Option<RecommendedWatcher>> = Mutex::new(None);

/// A change worth a rescan: an audio file, or a folder (moved / deleted with its files).
fn matters(path: &Path) -> bool {
    music_core::local::is_audio(path) || path.extension().is_none()
}

/// Watches `dirs` (replacing what was watched). Best effort: a folder that can't be watched still scans at launch.
pub fn watch(app: &tauri::AppHandle, dirs: &[String]) {
    let mut slot = WATCHER.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    // Dropping the old watcher ends its thread (the channel closes).
    *slot = None;
    if dirs.is_empty() {
        return;
    }
    let (tx, rx) = channel::<PathBuf>();
    let Ok(mut w) = notify::recommended_watcher(move |ev: notify::Result<notify::Event>| {
        if let Ok(ev) = ev {
            for p in ev.paths {
                let _ = tx.send(p);
            }
        }
    }) else {
        return;
    };
    for d in dirs {
        let _ = w.watch(Path::new(d), RecursiveMode::Recursive);
    }
    *slot = Some(w);
    let app = app.clone();
    std::thread::spawn(move || {
        let mut dirty = false;
        loop {
            match rx.recv_timeout(SETTLE) {
                Ok(p) => dirty |= matters(&p),
                Err(RecvTimeoutError::Timeout) if dirty => {
                    dirty = false;
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app.state::<AppState>();
                        let dirs = crate::folders(&state.lib());
                        if let Ok(n) = crate::rescan(&state, dirs).await {
                            let _ = app.emit_to("main", "local-changed", n);
                        }
                    });
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
    });
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Dropped {
    /// Folders now watched.
    folders: usize,
    /// Songs new in the library.
    added: usize,
    /// The drop's songs in the library, its folders' too: what Play plays.
    paths: Vec<String>,
}

/// Explorer's drop on the window: folders join the watched ones, audio files outside them are kept on their own
/// (setting `files`), then one rescan.
#[tauri::command]
pub async fn add_dropped(app: tauri::AppHandle, state: State<'_, AppState>, paths: Vec<String>) -> CmdResult<Dropped> {
    // Trust boundary: the OS's drop. Absolute paths only, bounded.
    let dropped: Vec<PathBuf> = paths.into_iter().take(1000).map(PathBuf::from).filter(|p| p.is_absolute()).collect();
    let known = crate::songlist::own_files(&state)?;
    let (mut dirs, mut loose) = {
        let lib = state.lib();
        (crate::folders(&lib), crate::loose_files(&lib))
    };
    let folders = music_core::local::take_drop(&dropped, &mut dirs, &mut loose);
    {
        let lib = state.lib();
        lib.set_setting("folders", &serde_json::json!(dirs)).map_err(err)?;
        lib.set_setting("files", &serde_json::json!(loose)).map_err(err)?;
    }
    if folders > 0 {
        watch(&app, &dirs);
    }
    crate::rescan(&state, dirs).await?;
    let (mut added, mut paths) = (0, Vec::new());
    for t in state.lib().tracks().map_err(err)? {
        let Some(p) = t.track.ids.get(&Source::Local).filter(|p| dropped.iter().any(|d| Path::new(p).starts_with(d))) else { continue };
        added += usize::from(!known.contains_key(&music_core::playfile::path_key(Path::new(p))));
        paths.push(p.clone());
    }
    Ok(Dropped { folders, added, paths })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_files_and_folders_matter_other_files_dont() {
        assert!(matters(Path::new("C:/Music/Album/01.flac")));
        assert!(matters(Path::new("C:/Music/Album")));
        assert!(!matters(Path::new("C:/Music/Album/cover.jpg")));
        assert!(!matters(Path::new("C:/Music/Album/desktop.ini")));
    }
}
