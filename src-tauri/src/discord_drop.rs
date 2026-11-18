//! A link dragged or pasted from Discord (`music_connectors::discord_file`): checked and fetched here, kept as one file in
//! the cache folder under the extension its own bytes call for, and its path handed back. The page then opens that path like
//! a file dropped from disk (`share_read_image`, `lmix_read`: they check size and format again).

use crate::{CmdResult, err};
use music_connectors::discord_file::{self, Kind};
use tauri::{AppHandle, Manager};

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Taken {
    /// `image` (a share card) or `remix`.
    pub kind: String,
    pub path: String,
}

/// Dropped or pasted text → the file behind its Discord link, in the cache. Null: the text holds no link (nothing was asked).
#[tauri::command]
pub async fn discord_take(app: AppHandle, text: String) -> CmdResult<Option<Taken>> {
    let Some(link) = discord_file::link_in(&text) else { return Ok(None) };
    // Only text that names a Discord link is ours: any other link in a paste is the page's own business.
    if !link.contains("discordapp.") {
        return Ok(None);
    }
    let (kind, png, bytes) = discord_file::fetch(link).await.map_err(err)?;
    let dir = app.path().app_cache_dir().map_err(err)?.join("discord");
    std::fs::create_dir_all(&dir).map_err(err)?;
    let now = music_core::library::now_ms();
    // One name per take: a second drop right after never deletes the first before the page has read it.
    sweep(&dir, now);
    let path = dir.join(format!("dropped-{now}-{}.{}", NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed), kind.ext(png)));
    std::fs::write(&path, bytes).map_err(err)?;
    Ok(Some(Taken { kind: if kind == Kind::Remix { "remix" } else { "image" }.into(), path: path.to_string_lossy().into_owned() }))
}

static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// A taken file is read by the page within seconds: after a minute it is only litter.
const KEEP_MS: i64 = 60_000;

/// Takes older than a minute leave the folder (by the time in their name); anything else there is left alone.
fn sweep(dir: &std::path::Path, now_ms: i64) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        if stale(&e.file_name().to_string_lossy(), now_ms) {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// `dropped-<ms>-<n>.<ext>` taken more than `KEEP_MS` ago.
fn stale(name: &str, now_ms: i64) -> bool {
    name.strip_prefix("dropped-").and_then(|r| r.split('-').next()).and_then(|ms| ms.parse::<i64>().ok()).is_some_and(|at| now_ms - at > KEEP_MS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_takes_older_than_a_minute_are_swept() {
        assert!(stale("dropped-1000-0.png", 1000 + KEEP_MS + 1));
        assert!(!stale("dropped-1000-0.png", 1000 + KEEP_MS));
        assert!(!stale("notes.txt", i64::MAX));
        assert!(!stale("dropped-x-0.png", i64::MAX));
        let dir = std::env::temp_dir().join(format!("legato-discord-sweep-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["dropped-1000-0.png", "dropped-90000-1.lmix", "other.png"] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        sweep(&dir, 100_000);
        let mut left: Vec<String> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left, ["dropped-90000-1.lmix", "other.png"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
