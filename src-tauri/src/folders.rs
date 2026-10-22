//! Local music folders watched (Settings › Accounts › Local files): audio files added, removed or renamed there show
//! up in the library on their own, 2 s after the last change (a copy of a whole album is one rescan).

use crate::AppState;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::mpsc::{RecvTimeoutError, channel};
use std::time::Duration;
use tauri::{Emitter, Manager};

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
