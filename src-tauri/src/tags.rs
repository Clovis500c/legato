//! Edit song info (right-click on a local file): its tags rewritten (title, artist, album, front cover), its library row
//! following. Other services' songs aren't files of the user's: not offered.

use crate::{AppState, CmdResult, err};
use music_core::local::{TagEdit, write_tags};
use serde::Deserialize;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tags {
    title: String,
    artist: String,
    album: Option<String>,
    /// Picture file picked for the new front cover.
    cover_path: Option<String>,
    #[serde(default)]
    remove_cover: bool,
}

#[tauri::command]
pub async fn edit_tags(state: State<'_, AppState>, track_id: i64, tags: Tags) -> CmdResult<()> {
    // Trust boundary: text that goes into the file and the library, bounded; a picture file, bounded.
    let (title, artist) = (tags.title.trim().to_string(), tags.artist.trim().to_string());
    let album = tags.album.map(|a| a.trim().to_string()).filter(|a| !a.is_empty());
    let short = |s: &str| s.chars().count() <= 500;
    if title.is_empty() || artist.is_empty() || !short(&title) || !short(&artist) || !album.as_deref().is_none_or(short) {
        return Err("A title and an artist are needed (500 characters at most)".into());
    }
    let path = state.lib().local_path(track_id).map_err(err)?.ok_or("Only your own music files can be edited")?;
    let cover = match &tags.cover_path {
        Some(p) if std::fs::metadata(p).map_err(err)?.len() > music_core::themefile::MAX_IMAGE as u64 => return Err("Picture too big (15 MB max)".into()),
        Some(p) => Some(std::fs::read(p).map_err(err)?),
        None => None,
    };
    let edit = TagEdit { title: title.clone(), artist: artist.clone(), album: album.clone(), cover, remove_cover: tags.remove_cover };
    let file = PathBuf::from(path);
    tauri::async_runtime::spawn_blocking(move || write_tags(&file, &edit)).await.map_err(err)?.map_err(err)?;
    state.lib().set_details(track_id, &title, &artist, album.as_deref()).map_err(err)
}
