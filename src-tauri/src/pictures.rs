//! Pictures saved by the user: a share card, a cover cropped from a song, a playlist's cover.

use super::*;

/// Share card drawn by the interface (PNG), saved where the user picked: as is for .png, encoded for .jpg. Returns the
/// file written.
#[tauri::command]
pub async fn save_picture(png: Vec<u8>, path: String, link: Option<String>) -> CmdResult<String> {
    if png.len() > 32 << 20 {
        return Err("Picture too big".into());
    }
    let path = std::path::PathBuf::from(path);
    music_core::cover::wanted(&path).map_err(err)?;
    // A share card keeps its link hidden in the PNG (a JPEG is encoded again: the QR in the picture stays).
    let png = link.filter(|l| share::parse(l).is_ok()).and_then(|l| music_core::pngmeta::add_text(&png, music_core::pngmeta::KEY, &l)).unwrap_or(png);
    let out = tauri::async_runtime::spawn_blocking(move || music_core::cover::export(&png, None, &path)).await.map_err(err)?.map_err(err)?;
    Ok(out.to_string_lossy().into_owned())
}

/// Cover saved where the user picked (save dialog). source = art scheme path (local/<id>, cover/<name> or a URL),
/// crop = what the big cover shows (video bars cut). Returns the file written (extension may change, see cover::export).
#[tauri::command]
pub async fn export_cover(app: tauri::AppHandle, source: String, crop: Option<music_core::cover::Crop>, path: String) -> CmdResult<String> {
    let path = std::path::PathBuf::from(path);
    music_core::cover::wanted(&path).map_err(err)?;
    let (bytes, _) = art::image(&app, &source, None).await.ok_or("Cover not available")?;
    let out = tauri::async_runtime::spawn_blocking(move || music_core::cover::export(&bytes, crop, &path)).await.map_err(err)?.map_err(err)?;
    Ok(out.to_string_lossy().into_owned())
}

/// Image picked for a playlist cover: copied into the app's covers folder. Returns its name (art scheme `cover/<name>`).
#[tauri::command]
pub async fn save_cover(app: tauri::AppHandle, playlist_id: i64, path: String) -> CmdResult<String> {
    let bytes = std::fs::read(&path).map_err(err)?;
    if bytes.len() > 10 << 20 {
        return Err("Image too big (10 MB max)".into());
    }
    let ext = match bytes.as_slice() {
        [0x89, b'P', b'N', b'G', ..] => "png",
        [0xFF, 0xD8, 0xFF, ..] => "jpg",
        [b'G', b'I', b'F', ..] => "gif",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "webp",
        _ => return Err("Not a PNG, JPEG, WebP or GIF image".into()),
    };
    let dir = art::covers_dir(&app).ok_or("No app data folder")?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    // Older picks for this playlist: gone.
    let prefix = format!("pl-{playlist_id}-");
    for e in std::fs::read_dir(&dir).map_err(err)?.flatten() {
        if e.file_name().to_string_lossy().starts_with(&prefix) {
            let _ = std::fs::remove_file(e.path());
        }
    }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(err)?.as_millis();
    let name = format!("{prefix}{stamp}.{ext}");
    std::fs::write(dir.join(&name), bytes).map_err(err)?;
    Ok(name)
}
