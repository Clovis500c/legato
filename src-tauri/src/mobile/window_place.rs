//! Phones: the app fills the screen, no place to keep (the desktop one is `../window_place.rs`).

use tauri::{AppHandle, WebviewWindow};

pub fn placed() -> bool {
    true
}

pub fn restore(window: &WebviewWindow) -> tauri::Result<()> {
    window.show()
}

pub fn save(_: &AppHandle) {}
