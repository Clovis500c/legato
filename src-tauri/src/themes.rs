//! Theme pictures and `.theme` files: backgrounds kept in the covers folder by content (`music_core::themefile`),
//! served by the `art` scheme.

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

/// Picture picked for a theme's background (the original can move).
#[tauri::command]
pub async fn save_background(app: tauri::AppHandle, path: String) -> CmdResult<String> {
    if std::fs::metadata(&path).map_err(err)?.len() > music_core::themefile::MAX_IMAGE as u64 {
        return Err("Picture too big (15 MB max)".into());
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

/// A `.theme` file read back: its picture stored, the theme returned for the interface to check.
#[tauri::command]
pub async fn import_theme(app: tauri::AppHandle, path: String) -> CmdResult<serde_json::Value> {
    if std::fs::metadata(&path).map_err(err)?.len() > 25 << 20 {
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
