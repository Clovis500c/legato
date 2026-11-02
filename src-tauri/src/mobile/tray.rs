//! Phones have no tray: the same calls, doing nothing (the desktop one is `../tray.rs`).

use crate::media::NowPlaying;
use tauri::AppHandle;

pub struct Tray;

impl Tray {
    pub fn install(_: &AppHandle) -> tauri::Result<Self> {
        Ok(Self)
    }

    pub fn update(&self, _: Option<&NowPlaying>) -> tauri::Result<()> {
        Ok(())
    }

    pub fn relabel(&self) -> tauri::Result<()> {
        Ok(())
    }
}
