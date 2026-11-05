//! Theme pictures and `.theme` files: backgrounds kept in the covers folder by content (`music_core::themefile`),
//! served by the `art` scheme. Also the visualizer's preset files (`.milk`, `.json`), read and written as text.

use crate::{CmdResult, art, err};

/// A theme's background picture, kept in the covers folder by content. Returns its name (art scheme `cover/<name>`).
fn store_background(app: &tauri::AppHandle, bytes: &[u8]) -> CmdResult<String> {
    let name = music_core::themefile::background_name(bytes).map_err(err)?;
    let dir = art::covers_dir(app).ok_or("No app data folder")?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    if !dir.join(&name).exists() {
        std::fs::write(dir.join(&name), bytes).map_err(err)?;
    }
    Ok(name)
}

/// Picture or video picked for a theme's background (the original can move).
#[tauri::command]
pub async fn save_background(app: tauri::AppHandle, path: String) -> CmdResult<String> {
    if std::fs::metadata(&path).map_err(err)?.len() > music_core::themefile::MAX_VIDEO as u64 {
        return Err("File too big (40 MB max for a video, 15 MB for a picture)".into());
    }
    store_background(&app, &std::fs::read(&path).map_err(err)?)
}

/// A background no theme uses any more.
#[tauri::command]
pub async fn forget_background(app: tauri::AppHandle, name: String) -> CmdResult<()> {
    if name.starts_with("bg-") && art::valid_cover_name(&name) {
        let _ = std::fs::remove_file(art::covers_dir(&app).ok_or("No app data folder")?.join(name));
    }
    Ok(())
}

/// A `.theme` file: the theme and its background picture in one.
#[tauri::command]
pub async fn export_theme(app: tauri::AppHandle, path: String, theme: serde_json::Value) -> CmdResult<()> {
    let picture = theme["background"]["image"].as_str().filter(|n| art::valid_cover_name(n)).and_then(|n| std::fs::read(art::covers_dir(&app)?.join(n)).ok());
    std::fs::write(path, music_core::themefile::pack(&theme, picture.as_deref()).map_err(err)?).map_err(err)
}

/// A preset file's largest size, bytes (a MilkDrop preset is a few kB; its shaders, left out, make the big ones).
const MAX_PRESET: u64 = 256 * 1024;

/// A visualizer preset file the user picked (`.milk`, `.json`): its text, for the interface to read (`vizPresetList.ts`).
/// MilkDrop's files are often Windows-1252: a byte that isn't UTF-8 becomes a replacement character (in comments, mostly).
#[tauri::command]
pub async fn read_preset(path: String) -> CmdResult<String> {
    if std::fs::metadata(&path).map_err(err)?.len() > MAX_PRESET {
        return Err("File too big for a preset".into());
    }
    Ok(String::from_utf8_lossy(&std::fs::read(&path).map_err(err)?).into_owned())
}

/// A preset's `.json` written where the user picked.
#[tauri::command]
pub async fn write_preset(path: String, text: String) -> CmdResult<()> {
    if text.len() as u64 > MAX_PRESET {
        return Err("Preset too big".into());
    }
    std::fs::write(path, text).map_err(err)
}

/// A `.theme` file read back: its picture stored, the theme returned for the interface to check.
#[tauri::command]
pub async fn import_theme(app: tauri::AppHandle, path: String) -> CmdResult<serde_json::Value> {
    if std::fs::metadata(&path).map_err(err)?.len() > (music_core::themefile::MAX_VIDEO * 4 / 3 + (1 << 20)) as u64 {
        return Err("File too big for a theme".into());
    }
    let (mut theme, picture) = music_core::themefile::unpack(&std::fs::read_to_string(&path).map_err(err)?).map_err(err)?;
    if let Some(p) = picture {
        let name = store_background(&app, &p)?;
        if let Some(bg) = theme.get_mut("background").and_then(|b| b.as_object_mut()) {
            bg.insert("image".into(), name.into());
        }
    }
    Ok(theme)
}
