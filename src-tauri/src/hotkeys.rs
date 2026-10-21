//! Global keyboard shortcuts (Settings › Shortcuts, "Everywhere"): OS hotkeys that work with the app in the background
//! or in the tray. The UI hands its bindings over (`set`); a press sends the action id to the UI as a `shortcut` event,
//! except "show the app", done here (the window may be hidden). Media keys are never registered: the Windows media
//! session (media.rs) owns them.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Runtime, plugin::TauriPlugin};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Hotkey id → action id.
static ACTIONS: Mutex<Option<HashMap<u32, String>>> = Mutex::new(None);

#[derive(Debug, serde::Deserialize)]
pub struct Entry {
    pub id: String,
    pub accelerator: String,
}

pub fn plugin() -> TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let action = ACTIONS.lock().unwrap().as_ref().and_then(|m| m.get(&shortcut.id()).cloned());
            match action.as_deref() {
                Some("showApp") => crate::tray::show_main(app),
                Some(id) => {
                    crate::background::wake(app);
                    let _ = app.emit_to("main", "shortcut", id);
                }
                None => {}
            }
        })
        .build()
}

/// Trust boundary: ids and accelerators from the UI. Short, plain names only.
fn valid(e: &Entry) -> bool {
    let plain = |s: &str, n: usize| !s.is_empty() && s.len() <= n && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '+');
    plain(&e.id, 40) && plain(&e.accelerator, 60) && !e.accelerator.to_lowercase().contains("media")
}

/// Replaces every global shortcut. Returns the actions the OS refused (another app holds the combo, or it can't be
/// parsed): Settings › Shortcuts says so.
pub fn set<R: Runtime>(app: &AppHandle<R>, entries: &[Entry]) -> Vec<String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut map = HashMap::new();
    let mut failed = Vec::new();
    for e in entries {
        let parsed = valid(e).then(|| e.accelerator.parse::<Shortcut>().ok()).flatten();
        match parsed {
            Some(s) if gs.register(s).is_ok() => {
                map.insert(s.id(), e.id.clone());
            }
            _ => failed.push(e.id.clone()),
        }
    }
    *ACTIONS.lock().unwrap() = Some(map);
    failed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entries_are_checked() {
        let e = |id: &str, a: &str| Entry { id: id.into(), accelerator: a.into() };
        assert!(valid(&e("playPause", "Ctrl+Alt+Space")));
        assert!(!valid(&e("x", "Ctrl+Alt+MediaPlayPause")));
        assert!(!valid(&e("x;alert(1)", "Ctrl+KeyS")));
        assert!(!valid(&e("x", "")));
        // Same names as the UI's combos.
        assert!("Ctrl+Alt+ArrowRight".parse::<Shortcut>().is_ok());
        assert!("Super+Shift+KeyK".parse::<Shortcut>().is_ok());
        assert!("Ctrl+Comma".parse::<Shortcut>().is_ok());
    }
}
