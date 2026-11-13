//! The output device (player bar menu › Output device): the system's list, the one picked kept on this PC (library setting
//! `outputDevice`, not synced) and applied at launch. A device gone since falls back to the system's default in the engine.

use crate::{AppState, CmdResult, err};
use music_player::Command;
use serde::Serialize;
use tauri::State;

const KEY: &str = "outputDevice";

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OutputDevices {
    pub names: Vec<String>,
    /// The one picked (None: the system's default).
    pub current: Option<String>,
}

fn picked(state: &AppState) -> Option<String> {
    state.lib().setting(KEY).ok().flatten().and_then(|v| v.as_str().map(str::to_string)).filter(|n| !n.is_empty())
}

/// At launch: the device picked last time.
pub fn apply(state: &AppState) {
    if let Some(name) = picked(state) {
        state.player.send(Command::SetDevice { name: Some(name) });
    }
}

#[tauri::command]
pub async fn output_devices(state: State<'_, AppState>) -> CmdResult<OutputDevices> {
    let names = tauri::async_runtime::spawn_blocking(music_player::output_devices).await.map_err(err)?;
    Ok(OutputDevices { names, current: picked(&state) })
}

/// Trust boundary: only a name the system listed, or None for the default.
#[tauri::command]
pub async fn set_output_device(state: State<'_, AppState>, name: Option<String>) -> CmdResult<()> {
    if let Some(n) = &name {
        let names = tauri::async_runtime::spawn_blocking(music_player::output_devices).await.map_err(err)?;
        if !names.contains(n) {
            return Err("That output device isn't there any more".into());
        }
    }
    state.lib().set_setting(KEY, &serde_json::json!(name.clone().unwrap_or_default())).map_err(err)?;
    state.player.send(Command::SetDevice { name });
    Ok(())
}
