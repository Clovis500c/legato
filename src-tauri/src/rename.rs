//! THE catch-up for the first name (2026-11-13: the rest of the app no longer knows it; remove this file when every PC
//! runs the new name, plan-v2 "Remove the rename catch-up"). Music App became Legato (2026-10-29), its identifier
//! `dev.musicapp.desktop` became `app.legato.desktop`: the folders and keychain entries named after the old one move to
//! the new name, once, before anything opens them (window place, WebView2 profile with the Google session, library,
//! settings, covers). Only renames: nothing is copied or deleted, so a move that fails leaves everything where it was.
//! The sync folder `Music App Sync` and its `.musicsync` files become `Legato Sync` and `.legatosync` the first time
//! Sync Mode looks at a folder: copied, then the old one removed only when everything is in the new one, never over a
//! file already there. Only the installed app migrates (`identity.rs`): a dev or bench build has nothing of the old
//! name to take.

use std::io;
use std::path::Path;

const OLD: &str = "dev.musicapp.desktop";

/// The old identifier of the installed app. None for any other build (dev, bench): they never migrate.
fn old_id(id: &str) -> Option<&'static str> {
    crate::identity::is_installed(id).then_some(OLD)
}

/// Folders first (an error: they're in use, the old app still runs), then keychain entries (best effort).
pub fn migrate(id: &str) -> io::Result<()> {
    let Some(old) = old_id(id) else { return Ok(()) };
    #[cfg(windows)]
    {
        for var in ["APPDATA", "LOCALAPPDATA"] {
            if let Some(base) = std::env::var_os(var).map(std::path::PathBuf::from) {
                move_dir(&base.join(old), &base.join(id))?;
            }
        }
        move_secrets(old, id);
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

const OLD_SYNC_DIR: &str = "Music App Sync";
const NEW_SYNC_DIR: &str = "Legato Sync";
const OLD_EXT: &str = "musicsync";

/// Sync Mode's folder `chosen/Music App Sync` → `chosen/Legato Sync`, if there is one. Best effort: a failure leaves the old
/// folder where it is and is told in the diagnostics; the next look tries again.
pub fn sync_folder(chosen: &Path) {
    if !crate::identity::installed() {
        return;
    }
    if let Err(e) = copy_sync_dir(&chosen.join(OLD_SYNC_DIR), &chosen.join(NEW_SYNC_DIR)) {
        crate::diag::warn("sync", "the Music App Sync folder could not be carried over", &e.to_string());
    }
}

/// `old`'s files copied into `new` (made if missing), their `.musicsync` extension now `.legatosync`; a file `new` has is
/// never touched. `old` goes only when every one of its files is in `new`. No `old`: nothing done.
fn copy_sync_dir(old: &Path, new: &Path) -> io::Result<()> {
    if !old.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(new)?;
    let mut left = false;
    for entry in std::fs::read_dir(old)? {
        let path = entry?.path();
        if !path.is_file() {
            // A folder or anything else is not ours: it stays, and so does `old`.
            left = true;
            continue;
        }
        let mut name = path.file_name().map(std::path::PathBuf::from).unwrap_or_default();
        if name.extension().is_some_and(|x| x == OLD_EXT) {
            name.set_extension(sm_ext());
        }
        let dest = new.join(name);
        if !dest.exists() {
            // Through `<name>.part`: a copy cut short (disk full, the app killed) is never taken for one done, and the old
            // folder stays until it is redone.
            let mut part = dest.clone().into_os_string();
            part.push(".part");
            if let Err(e) = std::fs::copy(&path, &part).and_then(|_| std::fs::rename(&part, &dest)) {
                let _ = std::fs::remove_file(&part);
                return Err(e);
            }
        }
    }
    if !left {
        std::fs::remove_dir_all(old)?;
    }
    Ok(())
}

fn sm_ext() -> &'static str {
    music_core::syncmode::FILE_EXT
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
        assert_eq!(old_id("app.legato.desktop"), Some("dev.musicapp.desktop"));
        // Guests never migrate: dev build, bench build, anything else.
        assert_eq!(old_id("app.legato.desktop.devbuild"), None);
        assert_eq!(old_id("app.legato.desktop.bench"), None);
        assert_eq!(old_id("com.example.other"), None);
    }

    fn scratch(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("legato-rename-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn the_old_sync_folder_becomes_the_new_one() {
        let root = scratch("old-dir");
        let (old, new) = (root.join(OLD_SYNC_DIR), root.join(NEW_SYNC_DIR));
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("sync.json"), "manifest").unwrap();
        std::fs::write(old.join("aa.musicsync"), "pc a").unwrap();
        copy_sync_dir(&old, &new).unwrap();
        assert!(!old.exists());
        assert_eq!(std::fs::read_to_string(new.join("sync.json")).unwrap(), "manifest");
        assert_eq!(std::fs::read_to_string(new.join("aa.legatosync")).unwrap(), "pc a");
        assert!(!new.join("aa.musicsync").exists());
        // Already carried over: nothing to do, nothing lost.
        copy_sync_dir(&old, &new).unwrap();
        assert_eq!(std::fs::read_dir(&new).unwrap().count(), 2);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn an_old_file_alone_or_both_folders_never_overwrite() {
        let root = scratch("both");
        let (old, new) = (root.join(OLD_SYNC_DIR), root.join(NEW_SYNC_DIR));
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("sync.json"), "old manifest").unwrap();
        std::fs::write(old.join("bb.musicsync"), "old b").unwrap();
        std::fs::write(new.join("sync.json"), "new manifest").unwrap();
        std::fs::write(new.join("cc.legatosync"), "new c").unwrap();
        copy_sync_dir(&old, &new).unwrap();
        // The new folder's own file wins; what only the old one had comes in; the old folder is gone.
        assert_eq!(std::fs::read_to_string(new.join("sync.json")).unwrap(), "new manifest");
        assert_eq!(std::fs::read_to_string(new.join("bb.legatosync")).unwrap(), "old b");
        assert_eq!(std::fs::read_to_string(new.join("cc.legatosync")).unwrap(), "new c");
        assert!(!old.exists());
        // Something in the old folder that is not a file: everything else comes, the old folder stays.
        std::fs::create_dir_all(old.join("odd")).unwrap();
        std::fs::write(old.join("dd.musicsync"), "d").unwrap();
        copy_sync_dir(&old, &new).unwrap();
        assert!(new.join("dd.legatosync").exists() && old.join("odd").is_dir());
        // No old folder at all.
        copy_sync_dir(&root.join("nothing"), &new).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_copy_cut_short_is_redone_never_taken_for_done() {
        let root = scratch("cut");
        let (old, new) = (root.join(OLD_SYNC_DIR), root.join(NEW_SYNC_DIR));
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("ee.musicsync"), "the whole of pc e").unwrap();
        // What a copy cut short leaves (the disk full, the app killed): never the file's own name, so it is done again.
        std::fs::write(new.join("ee.legatosync.part"), "the wh").unwrap();
        copy_sync_dir(&old, &new).unwrap();
        assert_eq!(std::fs::read_to_string(new.join("ee.legatosync")).unwrap(), "the whole of pc e");
        assert!(!new.join("ee.legatosync.part").exists() && !old.exists());
        std::fs::remove_dir_all(&root).unwrap();
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
