mod secrets;
#[cfg(windows)]
mod shield;

use music_connectors::oauth::Opener;
use music_connectors::spotify::Spotify;
use music_connectors::youtube::YouTube;
use music_core::library::{Library, LibraryPlaylist, LibraryTrack, PlaylistEdit};
use music_core::model::{Connector, SecretStore, Source};
use music_core::sync::{SyncReport, sync};
use music_player::{Command, Player, Status};
use music_shield::Shield;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;

/// Errors cross IPC as plain strings (full anyhow chain).
type CmdResult<T> = Result<T, String>;

fn err(e: impl Into<anyhow::Error>) -> String {
    format!("{:#}", e.into())
}

/// User-supplied app keys ("bring your own key"). Stored in OS keychain.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Credentials {
    spotify_client_id: Option<String>,
    youtube_client_id: Option<String>,
    youtube_client_secret: Option<String>,
}

impl Credentials {
    /// Trust boundary: trim, drop blanks, keep known fields only.
    fn merged_with(mut self, new: Credentials) -> Self {
        let clean = |v: Option<String>| v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        self.spotify_client_id = clean(new.spotify_client_id).or(self.spotify_client_id);
        self.youtube_client_id = clean(new.youtube_client_id).or(self.youtube_client_id);
        self.youtube_client_secret = clean(new.youtube_client_secret).or(self.youtube_client_secret);
        self
    }
}

struct AppState {
    lib: Mutex<Library>,
    store: Arc<dyn SecretStore>,
    open: Opener,
    player: Player,
    shield: Arc<Shield>,
}

impl AppState {
    fn credentials(&self) -> Credentials {
        self.store.load("credentials").unwrap_or_default()
    }

    fn spotify(&self) -> Option<Spotify> {
        let id = self.credentials().spotify_client_id?;
        Some(Spotify::new(&id, self.store.clone(), self.open.clone()))
    }

    fn youtube(&self) -> Option<YouTube> {
        let c = self.credentials();
        Some(YouTube::new(&c.youtube_client_id?, &c.youtube_client_secret?, self.store.clone(), self.open.clone()))
    }

    fn connector(&self, source: Source) -> Option<Box<dyn Connector>> {
        match source {
            Source::Spotify => self.spotify().map(|c| Box::new(c) as _),
            Source::Youtube => self.youtube().map(|c| Box::new(c) as _),
            Source::Local => None,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceStatus {
    configured: bool,
    connected: bool,
}

#[tauri::command]
fn sources_status(state: State<AppState>) -> Vec<(Source, SourceStatus)> {
    [Source::Spotify, Source::Youtube]
        .into_iter()
        .map(|s| {
            let c = state.connector(s);
            (s, SourceStatus { configured: c.is_some(), connected: c.is_some_and(|c| c.is_connected()) })
        })
        .collect()
}

#[tauri::command]
async fn connect(state: State<'_, AppState>, source: Source, credentials: Credentials) -> CmdResult<()> {
    let merged = state.credentials().merged_with(credentials);
    state.store.save("credentials", &merged).map_err(err)?;
    let c = state.connector(source).ok_or("Identifiants manquants")?;
    c.connect().await.map_err(err)
}

#[tauri::command]
fn disconnect(state: State<AppState>, source: Source) -> CmdResult<()> {
    state.connector(source).map_or(Ok(()), |c| c.disconnect()).map_err(err)
}

#[tauri::command]
async fn sync_all(state: State<'_, AppState>) -> CmdResult<SyncReport> {
    let (spotify, youtube) = (state.spotify(), state.youtube());
    let mut all: Vec<&dyn Connector> = Vec::new();
    all.extend(spotify.as_ref().map(|c| c as &dyn Connector));
    all.extend(youtube.as_ref().map(|c| c as &dyn Connector));
    Ok(sync(&state.lib, &all, spotify.as_ref().map(|c| c as &dyn Connector)).await)
}

#[derive(Serialize)]
struct LibraryData {
    tracks: Vec<LibraryTrack>,
    playlists: Vec<LibraryPlaylist>,
}

#[tauri::command]
fn library(state: State<AppState>) -> CmdResult<LibraryData> {
    let lib = state.lib.lock().unwrap();
    Ok(LibraryData { tracks: lib.tracks().map_err(err)?, playlists: lib.playlists().map_err(err)? })
}

#[tauri::command]
fn playlist_tracks(state: State<AppState>, id: i64) -> CmdResult<Vec<LibraryTrack>> {
    state.lib.lock().unwrap().playlist_tracks(id).map_err(err)
}

fn folders(lib: &Library) -> Vec<String> {
    lib.setting("folders").ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

/// Scan off the IPC thread, then mirror into library. Returns local file count.
async fn rescan(state: &AppState, dirs: Vec<String>) -> CmdResult<usize> {
    let paths: Vec<PathBuf> = dirs.iter().map(PathBuf::from).collect();
    let tracks = tauri::async_runtime::spawn_blocking(move || music_core::local::scan(&paths)).await.map_err(err)?;
    state.lib.lock().unwrap().replace_local(&tracks).map_err(err)
}

#[tauri::command]
fn local_folders(state: State<AppState>) -> Vec<String> {
    folders(&state.lib.lock().unwrap())
}

#[tauri::command]
async fn set_local_folders(state: State<'_, AppState>, folders: Vec<String>) -> CmdResult<usize> {
    // Trust boundary: existing absolute folders only.
    let clean: Vec<String> = folders.into_iter().map(|f| f.trim().to_string()).filter(|f| Path::new(f).is_absolute() && Path::new(f).is_dir()).take(50).collect();
    state.lib.lock().unwrap().set_setting("folders", &serde_json::json!(clean)).map_err(err)?;
    rescan(&state, clean).await
}

#[tauri::command]
async fn rescan_local(state: State<'_, AppState>) -> CmdResult<usize> {
    let dirs = folders(&state.lib.lock().unwrap());
    rescan(&state, dirs).await
}

/// Pasted link → library track. Returns "Artist – Title" for the notice.
#[tauri::command]
async fn add_link(state: State<'_, AppState>, url: String) -> CmdResult<String> {
    // Trust boundary: clipboard text.
    if url.len() > 2048 {
        return Err("Lien trop long".into());
    }
    let t = music_connectors::youtube::track_from_link(url.trim(), music_connectors::youtube::OEMBED).await.map_err(err)?;
    state.lib.lock().unwrap().upsert_track(&t).map_err(err)?;
    Ok(format!("{} – {}", t.artist, t.title))
}

#[tauri::command]
fn edit_playlist(state: State<AppState>, edit: PlaylistEdit) -> CmdResult<Option<i64>> {
    state.lib.lock().unwrap().edit_playlist(edit).map_err(err)
}

#[tauri::command]
fn load_settings(state: State<AppState>) -> CmdResult<Option<serde_json::Value>> {
    state.lib.lock().unwrap().setting("ui").map_err(err)
}

#[tauri::command]
fn save_settings(state: State<AppState>, settings: serde_json::Value) -> CmdResult<()> {
    // Trust boundary: object only, bounded size (custom themes included).
    if !settings.is_object() || settings.to_string().len() > 256 * 1024 {
        return Err("Réglages invalides".into());
    }
    state.lib.lock().unwrap().set_setting("ui", &settings).map_err(err)
}

#[derive(Serialize)]
struct ShieldStatus {
    enabled: bool,
    blocked: u64,
}

#[tauri::command]
fn shield_status(state: State<AppState>) -> ShieldStatus {
    ShieldStatus { enabled: state.shield.enabled.load(Ordering::Relaxed), blocked: state.shield.blocked() }
}

/// Network part switches live; player script part on next launch.
#[tauri::command]
fn set_shield(state: State<AppState>, enabled: bool) {
    state.shield.enabled.store(enabled, Ordering::Relaxed)
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart()
}

#[tauri::command]
fn player(state: State<AppState>, cmd: Command) {
    state.player.send(cmd)
}

#[tauri::command]
fn player_status(state: State<AppState>) -> Status {
    state.player.status()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let handle = app.handle().clone();
            let open: Opener = Arc::new(move |url: &str| handle.opener().open_url(url, None::<&str>).map_err(Into::into));
            let lib = Library::open(dir.join("library.db"))?;
            let shield_on = lib.setting("ui").ok().flatten().and_then(|s| s.get("shield")?.as_bool()).unwrap_or(true);
            // Starts with built-in rules; cached / fresh lists swapped in below without blocking startup.
            let shield = Arc::new(Shield::new("", shield_on));

            let mut window = tauri::WebviewWindowBuilder::from_config(app.handle(), &app.config().app.windows[0])?;
            if shield_on {
                window = window.initialization_script_for_all_frames(music_shield::YOUTUBE_SCRIPT);
            }
            let _window = window.build()?;
            #[cfg(windows)]
            shield::install(&_window, shield.clone())?;

            let lists = dir.join("shield");
            let fresh = shield.clone();
            tauri::async_runtime::spawn(async move {
                let cached = music_shield::cached_lists(&lists);
                if !cached.is_empty() {
                    fresh.reload(&cached);
                }
                if music_shield::lists_stale(&lists)
                    && let Ok(text) = music_shield::download_lists(&lists).await
                {
                    fresh.reload(&text);
                }
            });

            app.manage(AppState { lib: Mutex::new(lib), store: Arc::new(secrets::KeyringStore::new(&app.config().identifier)), open, player: Player::spawn(), shield });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sources_status, connect, disconnect, sync_all, library, playlist_tracks, player, player_status, edit_playlist, add_link, local_folders, set_local_folders, rescan_local, load_settings, save_settings, shield_status, set_shield, restart_app])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_merge_trims_and_keeps_old_values() {
        let old = Credentials { spotify_client_id: Some("OLD".into()), ..Default::default() };
        let new = Credentials { spotify_client_id: Some("   ".into()), youtube_client_id: Some(" Y ".into()), ..Default::default() };
        let m = old.merged_with(new);
        assert_eq!((m.spotify_client_id.as_deref(), m.youtube_client_id.as_deref()), (Some("OLD"), Some("Y")));
    }
}
