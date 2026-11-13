//! Storage: the caches' sizes and caps, Settings › Storage, the caches and the app's data cleared.

use super::*;

/// Settings › About: how much the caches answer.
#[tauri::command]
pub fn cache_stats(state: State<AppState>) -> CacheStats {
    let c = &state.cache;
    CacheStats { library: c.library.stats(), playlists: c.playlist.stats(), mixes: c.mixes.stats(), stats: c.stats.stats(), images: state.art.stats() }
}

/// Settings › General › Cover cache: how much the cover folder holds now.
#[tauri::command]
pub async fn art_cache_size(app: tauri::AppHandle) -> CmdResult<u64> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().art.size()).await.map_err(err)
}

/// New cap of the cover cache, in MB. Over it: pruned in the background.
#[tauri::command]
pub fn set_art_cache_cap(state: State<AppState>, mb: u64) {
    state.art.set_cap(mb.clamp(50, 20_000) << 20);
}

/// Settings › General › Storage: what the app keeps on disk, by kind, in bytes. `webview`: WebView2's own folder (the
/// sign-ins, the pages' caches), a PC's only.
#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Storage {
    library: u64,
    covers: u64,
    caches: u64,
    log: u64,
    webview: Option<u64>,
}

#[tauri::command]
pub async fn storage(app: tauri::AppHandle) -> CmdResult<Storage> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let dir = app.path().app_data_dir().map_err(err)?;
        let webview = if cfg!(desktop) { app.path().app_local_data_dir().ok().map(|d| music_core::storage::size(&d.join("EBWebView"))) } else { None };
        let caches = state.lib().caches_bytes().map_err(err)?;
        // The caches live in the library's file: counted once, as caches.
        let library = music_core::storage::library(&dir).saturating_sub(caches);
        Ok(Storage { library, covers: state.art.size(), caches, log: music_core::diag::bytes(&dir), webview })
    })
    .await
    .map_err(err)?
}

/// Storage's Clear: "caches" (lyrics found, SponsorBlock's parts, local files measured) or "log"; never the library.
/// Bytes freed.
#[tauri::command]
pub async fn clear_storage(app: tauri::AppHandle, what: String) -> CmdResult<u64> {
    tauri::async_runtime::spawn_blocking(move || match what.as_str() {
        "caches" => app.state::<AppState>().lib().clear_caches().map_err(err),
        "log" => Ok(diag::clear()),
        _ => Err("Nothing to clear by that name".into()),
    })
    .await
    .map_err(err)?
}

/// Empties the cover cache (covers download again when shown). Bytes freed.
#[tauri::command]
pub async fn clear_art_cache(app: tauri::AppHandle) -> CmdResult<u64> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().art.clear()).await.map_err(err)
}
