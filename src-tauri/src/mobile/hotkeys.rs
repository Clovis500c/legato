//! Phones have no global keys: the same calls (the desktop one is `../hotkeys.rs`).

use tauri::{AppHandle, Runtime};

#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)]
pub struct Entry {
    pub id: String,
    pub accelerator: String,
}

/// Every action refused: Settings › Shortcuts says so.
pub fn set<R: Runtime>(_: &AppHandle<R>, entries: &[Entry]) -> Vec<String> {
    entries.iter().map(|e| e.id.clone()).collect()
}
