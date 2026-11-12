//! Remix files (`.lmix`, music_dsp::lmix): read from a dropped or picked file, written to one the user chose. The
//! parser lives in the crate; here only the file's path and size are checked before it is read.

use crate::{CmdResult, err};
use music_dsp::lmix::{self, Lmix};
use std::path::PathBuf;

/// An absolute path to a `.lmix` file: the OS's drop or dialog, not trusted further.
fn lmix_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if p.is_absolute() && p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("lmix")) { Ok(p) } else { Err("A .lmix file expected".into()) }
}

/// A remix file: its video and settings, checked (size first, never read whole when too big).
#[tauri::command]
pub async fn lmix_read(path: String) -> CmdResult<Lmix> {
    let p = lmix_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        if std::fs::metadata(&p).map_err(err)?.len() > lmix::MAX_BYTES {
            return Err("This remix file is too big".to_string());
        }
        lmix::unpack(&String::from_utf8_lossy(&std::fs::read(&p).map_err(err)?))
    })
    .await
    .map_err(err)?
}

/// A remix as a file the user chose.
#[tauri::command]
pub async fn lmix_write(path: String, mix: Lmix) -> CmdResult<()> {
    let p = lmix_path(&path)?;
    let text = lmix::pack(&mix)?;
    tauri::async_runtime::spawn_blocking(move || std::fs::write(p, text).map_err(err)).await.map_err(err)?
}

/// A remix as a link to copy.
#[tauri::command]
pub async fn lmix_link(mix: Lmix) -> CmdResult<String> {
    lmix::to_link(&mix)
}

/// A remix from a pasted or opened link: checked like a file.
#[tauri::command]
pub async fn lmix_from_link(link: String) -> CmdResult<Lmix> {
    lmix::from_link(&link)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_absolute_lmix_path() {
        // An absolute path is the system's own kind: a drive letter on Windows, a root elsewhere.
        let dir = if cfg!(windows) { r"C:\Mixes" } else { "/mixes" };
        let at = |name: &str| std::path::Path::new(dir).join(name).to_string_lossy().into_owned();
        assert!(lmix_path(&at("a.lmix")).is_ok() && lmix_path(&at("A.LMIX")).is_ok());
        assert!(lmix_path("a.lmix").is_err() && lmix_path(&at("a.exe")).is_err() && lmix_path(&at("a.lmix.exe")).is_err());
    }
}
