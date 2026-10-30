//! Which build runs. Only the installed app (`app.legato.desktop`) may change what lives outside its own data: install an
//! update over itself, own the HKCU Run entry, move the old folders and keychain entries. Any other identifier (dev build
//! `.devbuild`, bench build `.bench`, a first-run test) is a guest on this PC. A release-profile guest would otherwise run
//! all of it for real, and the Run entry and the installer are shared by every build under this user.

use std::sync::OnceLock;

/// `tauri.conf.json`'s identifier. A guest adds a suffix in its own config (`tauri.dev.conf.json`, `tauri.bench.conf.json`).
pub const INSTALLED: &str = "app.legato.desktop";

static RUNNING: OnceLock<String> = OnceLock::new();

/// Exactly the installed app's identifier, no prefix match: `app.legato.desktop.bench` is a guest.
pub fn is_installed(id: &str) -> bool {
    id == INSTALLED
}

/// Once, first thing in `run()`.
pub fn init(id: &str) {
    let _ = RUNNING.set(id.to_string());
}

/// This process is the installed app. False until `init` ran: unknown is a guest.
pub fn installed() -> bool {
    RUNNING.get().is_some_and(|id| is_installed(id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_exact_identifier_is_the_installed_app() {
        assert!(is_installed("app.legato.desktop"));
        for guest in ["app.legato.desktop.devbuild", "app.legato.desktop.bench", "app.legato.desktop.firstrun", "app.legato.desktop2", "App.Legato.Desktop", "dev.musicapp.desktop", " app.legato.desktop", ""] {
            assert!(!is_installed(guest), "{guest:?} would act as the installed app");
        }
    }

    #[test]
    fn unknown_is_a_guest() {
        // No test calls `init`: nothing passes for the installed app before `run()` names it.
        assert!(!installed());
    }

    #[test]
    fn the_configs_agree_with_the_guard() {
        let id = |json: &str| serde_json::from_str::<serde_json::Value>(json).unwrap()["identifier"].as_str().unwrap().to_string();
        assert_eq!(id(include_str!("../tauri.conf.json")), INSTALLED, "tauri.conf.json is the installed app");
        for guest in [include_str!("../tauri.dev.conf.json"), include_str!("../tauri.bench.conf.json")] {
            assert!(!is_installed(&id(guest)), "a guest config carries the installed identifier");
        }
    }
}
