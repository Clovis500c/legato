//! Music App became Legato (2026-10-29), its identifier `dev.musicapp.desktop` became `app.legato.desktop`: the folders
//! and keychain entries named after the old one move to the new name, once, before anything opens them (window place,
//! WebView2 profile with the Google session, library, settings, covers). Only renames: nothing is copied or deleted, so
//! a move that fails leaves everything where it was.

use std::io;
#[cfg(any(windows, test))]
use std::path::Path;

const OLD: &str = "dev.musicapp.desktop";
const NEW: &str = "app.legato.desktop";

/// The old identifier of this build's (installed app or dev build: same suffix).
fn old_id(id: &str) -> Option<String> {
    id.strip_prefix(NEW).map(|rest| format!("{OLD}{rest}"))
}

/// Folders first (an error: they're in use, the old app still runs), then keychain entries (best effort).
pub fn migrate(id: &str) -> io::Result<()> {
    let Some(old) = old_id(id) else { return Ok(()) };
    #[cfg(windows)]
    {
        for var in ["APPDATA", "LOCALAPPDATA"] {
            if let Some(base) = std::env::var_os(var).map(std::path::PathBuf::from) {
                move_dir(&base.join(&old), &base.join(id))?;
            }
        }
        move_secrets(&old, id);
    }
    #[cfg(not(windows))]
    let _ = old;
    Ok(())
}

/// `from` becomes `to`. If `to` is there already, `from`'s entries it lacks move in (its own are kept, the others stay
/// in `from`). Nothing to move: nothing done.
#[cfg(any(windows, test))]
fn move_dir(from: &Path, to: &Path) -> io::Result<()> {
    if !from.is_dir() {
        return Ok(());
    }
    if !to.exists() {
        return std::fs::rename(from, to);
    }
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let dest = to.join(entry.file_name());
        if !dest.exists() {
            std::fs::rename(entry.path(), dest)?;
        }
    }
    // Only when emptied.
    let _ = std::fs::remove_dir(from);
    Ok(())
}

/// keyring names an entry "<key>.<service>" (service = identifier). Each one of the old identifier is written under the
/// new one, then the old one goes. Credential Manager filters by prefix only: all are listed, the suffix picks ours.
#[cfg(windows)]
fn move_secrets(old: &str, new: &str) {
    use windows::Win32::Security::Credentials::{CREDENTIALW, CredEnumerateW, CredFree};
    use windows::core::PCWSTR;
    let suffix = format!(".{old}");
    let mut count = 0u32;
    let mut list: *mut *mut CREDENTIALW = std::ptr::null_mut();
    // SAFETY: out pointers to locals; the list is read, then freed once, as the API asks.
    let keys: Vec<String> = unsafe {
        if CredEnumerateW(PCWSTR::null(), None, &mut count, &mut list).is_err() {
            return;
        }
        let keys = (0..count as usize).filter_map(|i| (**list.add(i)).TargetName.to_string().ok()).filter_map(|t| t.strip_suffix(&suffix).map(str::to_string)).collect();
        CredFree(list as *const _);
        keys
    };
    for key in keys {
        let Ok(value) = keyring::Entry::new(old, &key).and_then(|e| e.get_password()) else { continue };
        if keyring::Entry::new(new, &key).and_then(|e| e.set_password(&value)).is_ok() {
            let _ = keyring::Entry::new(old, &key).and_then(|e| e.delete_credential());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_names() {
        assert_eq!(old_id("app.legato.desktop").as_deref(), Some("dev.musicapp.desktop"));
        assert_eq!(old_id("app.legato.desktop.devbuild").as_deref(), Some("dev.musicapp.desktop.devbuild"));
        assert_eq!(old_id("com.example.other"), None);
    }

    #[test]
    fn folders_move_once_and_merge() {
        let root = std::env::temp_dir().join(format!("legato-rename-{}", std::process::id()));
        let (from, to) = (root.join("old"), root.join("new"));
        std::fs::create_dir_all(from.join("art")).unwrap();
        std::fs::write(from.join("library.db"), "lib").unwrap();
        move_dir(&from, &to).unwrap();
        assert!(!from.exists() && to.join("library.db").exists() && to.join("art").is_dir());
        // Nothing left to move: no-op.
        move_dir(&from, &to).unwrap();
        // New folder already started (a log, say): the old library still comes in, the new file stays.
        std::fs::create_dir_all(&from).unwrap();
        std::fs::write(from.join("settings.json"), "old").unwrap();
        std::fs::write(from.join("library.db"), "old lib").unwrap();
        move_dir(&from, &to).unwrap();
        assert_eq!(std::fs::read_to_string(to.join("settings.json")).unwrap(), "old");
        assert_eq!(std::fs::read_to_string(to.join("library.db")).unwrap(), "lib");
        assert_eq!(std::fs::read_to_string(from.join("library.db")).unwrap(), "old lib");
        std::fs::remove_dir_all(&root).unwrap();
    }
}
