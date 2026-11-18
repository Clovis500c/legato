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
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(err)?;
    let path = dir.join(format!("dropped.{}", kind.ext(png)));
    std::fs::write(&path, bytes).map_err(err)?;
    Ok(Some(Taken { kind: if kind == Kind::Remix { "remix" } else { "image" }.into(), path: path.to_string_lossy().into_owned() }))
}
