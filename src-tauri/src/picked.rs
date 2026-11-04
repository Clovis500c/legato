//! Files through the system's own dialogs. Android's picker gives `content://` addresses, which no command taking a path
//! can open: a picked document is copied into the cache first (`picked_in`), a saved one is written in the cache
//! (`picked_temp`), then copied out to its address (`picked_out`). Desktop dialogs give paths: nothing to do there.
//! The interface's side: `ui/src/shared/files.ts`.

use crate::{err, CmdResult};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Cache folders: what came in from the last pick, what waits to go out.
const IN: &str = "picked";
const OUT: &str = "saving";

/// A picker's address, not a path.
fn is_address(s: &str) -> bool {
    s.starts_with("content://")
}

/// A file name for the cache: the last part only, no characters a file system refuses, at most 120 characters.
fn safe_name(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let kept: String = last.chars().filter(|c| !c.is_control() && !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|')).take(120).collect();
    let kept = kept.trim().trim_start_matches('.');
    if kept.is_empty() { "file".into() } else { kept.into() }
}

/// The cache folder, emptied: a pick replaces the last one's copy.
fn fresh(app: &AppHandle, sub: &str) -> CmdResult<PathBuf> {
    let dir = app.path().app_cache_dir().map_err(err)?.join(sub);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

/// A picked file as a path the commands open: an address is copied into the cache, a path stays as it is.
#[tauri::command]
pub async fn picked_in(app: AppHandle, address: String) -> CmdResult<String> {
    if !is_address(&address) {
        return Ok(address);
    }
    let dir = fresh(&app, IN)?;
    tauri::async_runtime::spawn_blocking(move || copy_in(&address, &dir)).await.map_err(err)?
}

/// Where to write a file before it goes out to an address: `name` in an emptied cache folder.
#[tauri::command]
pub async fn picked_temp(app: AppHandle, name: String) -> CmdResult<String> {
    Ok(fresh(&app, OUT)?.join(safe_name(&name)).to_string_lossy().into_owned())
}

/// The file written at `path` (from `picked_temp`) copied out to the address the user picked; its name there.
#[tauri::command]
pub async fn picked_out(app: AppHandle, path: String, address: String) -> CmdResult<String> {
    let dir = app.path().app_cache_dir().map_err(err)?.join(OUT);
    let path = PathBuf::from(path);
    // Trust boundary: only a file in the outgoing folder leaves, and only to an address.
    if !is_address(&address) || path.parent() != Some(dir.as_path()) {
        return Err("Invalid file".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let name = copy_out(&path, &address);
        let _ = std::fs::remove_file(&path);
        name
    })
    .await
    .map_err(err)?
}

#[cfg(target_os = "android")]
fn copy_in(address: &str, dir: &Path) -> CmdResult<String> {
    let path = crate::picked_jni::copy_in(address, dir).map_err(err)?;
    // The copy keeps the name's last part: in the folder, nowhere else.
    if path.parent() != Some(dir) {
        return Err("Invalid file".into());
    }
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(target_os = "android")]
fn copy_out(path: &Path, address: &str) -> CmdResult<String> {
    crate::picked_jni::copy_out(path, address).map_err(err)
}

// Desktop dialogs never give an address.
#[cfg(not(target_os = "android"))]
fn copy_in(_: &str, _: &Path) -> CmdResult<String> {
    Err("Not a file".into())
}

#[cfg(not(target_os = "android"))]
fn copy_out(_: &Path, _: &str) -> CmdResult<String> {
    Err("Not a file".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_are_androids_content_ones() {
        assert!(is_address("content://com.android.providers.downloads.documents/document/42"));
        assert!(!is_address("C:\\Music\\list.m3u8"));
        assert!(!is_address("/storage/emulated/0/Download/list.m3u8"));
    }

    #[test]
    fn names_keep_their_last_part_only() {
        assert_eq!(safe_name("Legato 2026-11-04.legato"), "Legato 2026-11-04.legato");
        assert_eq!(safe_name("../../secrets.bin"), "secrets.bin");
        assert_eq!(safe_name("C:\\Users\\me\\a.theme"), "a.theme");
        assert_eq!(safe_name("a: b?.jpg"), "a b.jpg");
        assert_eq!(safe_name(".."), "file");
        assert_eq!(safe_name(""), "file");
        assert_eq!(safe_name(&"x".repeat(300)).len(), 120);
    }
}
