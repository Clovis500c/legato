mod secrets;
#[cfg(windows)]
mod shield;

use music_connectors::oauth::Opener;
use music_connectors::spotify::Spotify;
use music_connectors::youtube::YouTube;
use music_core::library::{Library, LibraryPlaylist, LibraryTrack, PlaylistEdit};
use music_core::matching::{merge_tracks, same_track};
use music_core::model::{Connector, SecretStore, Source, Track};
use music_core::sync::{SyncReport, sync};
use music_player::{Command, Player, Status};
use music_shield::Shield;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
    /// YouTube search results this session: same query costs no quota twice.
    yt_cache: Mutex<HashMap<String, Vec<Track>>>,
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
            Source::Local | Source::Apple => None,
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
    let c = state.connector(source).ok_or("Missing credentials")?;
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
        return Err("Link too long".into());
    }
    let t = music_connectors::youtube::track_from_link(url.trim(), music_connectors::youtube::OEMBED).await.map_err(err)?;
    state.lib.lock().unwrap().upsert_track(&t).map_err(err)?;
    Ok(format!("{} – {}", t.artist, t.title))
}

/// search.list has its own bucket: 100 calls per day.
const YT_SEARCHES_PER_DAY: u32 = 100;

// shortcut: UTC day; YouTube resets quotas at midnight Pacific. Fine for a guard.
fn today() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() / 86_400)
}

/// YouTube searches used today (persisted).
fn yt_used(lib: &Library) -> u32 {
    lib.setting("yt_search").ok().flatten().filter(|v| v["day"].as_u64() == Some(today())).and_then(|v| v["used"].as_u64()).unwrap_or(0) as u32
}

/// YouTube search with session cache and daily budget. None = not connected or budget spent.
async fn yt_search(state: &AppState, query: &str) -> Option<Result<Vec<Track>, String>> {
    let key = query.to_lowercase();
    if let Some(hit) = state.yt_cache.lock().unwrap().get(&key) {
        return Some(Ok(hit.clone()));
    }
    let yt = state.youtube().filter(|y| y.is_connected())?;
    let used = yt_used(&state.lib.lock().unwrap());
    if used >= YT_SEARCHES_PER_DAY {
        return None;
    }
    let res = yt.search(query).await.map_err(err);
    state.lib.lock().unwrap().set_setting("yt_search", &serde_json::json!({ "day": today(), "used": used + 1 })).ok();
    if let Ok(found) = &res {
        let mut cache = state.yt_cache.lock().unwrap();
        if cache.len() > 200 {
            cache.clear();
        }
        cache.insert(key, found.clone());
    }
    Some(res)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchHit {
    #[serde(flatten)]
    track: Track,
    /// Library row when already added.
    library_id: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResults {
    hits: Vec<SearchHit>,
    youtube_searches_left: u32,
    errors: Vec<String>,
}

/// Trust boundary: ISO 3166 store code from UI locale.
fn store(country: &str) -> String {
    if country.len() == 2 && country.chars().all(|c| c.is_ascii_alphabetic()) { country.to_uppercase() } else { "US".into() }
}

/// Apple catalog + YouTube, merged (same recording = one hit with both ids).
#[tauri::command]
async fn search_catalogs(state: State<'_, AppState>, query: String, country: String) -> CmdResult<SearchResults> {
    // Trust boundary: free text from UI.
    let query = query.trim().to_string();
    if query.is_empty() || query.chars().count() > 200 {
        return Err("Search: 1 to 200 characters".into());
    }
    let country = store(&country);
    let apple = tauri::async_runtime::spawn({
        let q = query.clone();
        async move { music_connectors::itunes::search(music_connectors::itunes::API, &q, &country).await }
    });
    let mut errors = Vec::new();
    let youtube = match yt_search(&state, &query).await {
        Some(Ok(found)) => found,
        Some(Err(e)) => {
            errors.push(format!("YouTube: {e}"));
            Vec::new()
        }
        None => Vec::new(),
    };
    let apple = match apple.await.map_err(err)? {
        Ok(found) => found,
        Err(e) => {
            errors.push(format!("Apple Music: {}", err(e)));
            Vec::new()
        }
    };
    let mut merged: Vec<Track> = Vec::new();
    for t in youtube.into_iter().chain(apple) {
        match merged.iter_mut().find(|m| same_track(m, &t)) {
            Some(m) => *m = merge_tracks(m, &t),
            None => merged.push(t),
        }
    }
    let lib = state.lib.lock().unwrap();
    let hits = merged.into_iter().map(|track| SearchHit { library_id: lib.find(&track).ok().flatten(), track }).collect();
    Ok(SearchResults { hits, youtube_searches_left: YT_SEARCHES_PER_DAY.saturating_sub(yt_used(&lib)), errors })
}

/// Add search hit. No YouTube id yet: try to find one (1 search) so it becomes playable.
#[tauri::command]
async fn add_track(state: State<'_, AppState>, track: Track) -> CmdResult<i64> {
    // Trust boundary: catalog ids only, bounded text.
    let ok_text = |s: &str| !s.trim().is_empty() && s.chars().count() <= 300;
    if !ok_text(&track.title) || !ok_text(&track.artist) || track.ids.is_empty() || track.ids.iter().any(|(s, id)| *s == Source::Local || id.is_empty() || id.len() > 64) {
        return Err("Invalid title".into());
    }
    let mut track = track;
    if !track.ids.contains_key(&Source::Youtube)
        && let Some(Ok(found)) = yt_search(&state, &format!("{} {}", track.artist, track.title)).await
        && let Some(hit) = music_core::matching::best_match(&track, &found)
    {
        track = merge_tracks(&track, hit);
    }
    state.lib.lock().unwrap().upsert_track(&track).map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FindReport {
    /// Tracks that got a YouTube version.
    found: usize,
    /// Tracks still without full playback (budget spent or no match).
    missing: usize,
    youtube_searches_left: u32,
}

/// "Find versions": YouTube match for tracks with no full source (Apple / Spotify only). 1 search each, cached, daily budget.
#[tauri::command]
async fn find_versions(state: State<'_, AppState>, ids: Vec<i64>) -> CmdResult<FindReport> {
    let todo: Vec<Track> = {
        let lib = state.lib.lock().unwrap();
        let tracks = lib.tracks().map_err(err)?;
        tracks.into_iter().filter(|t| ids.contains(&t.id) && !t.track.ids.contains_key(&Source::Youtube) && !t.track.ids.contains_key(&Source::Local)).map(|t| t.track).collect()
    };
    let mut found = 0;
    for t in &todo {
        let Some(res) = yt_search(&state, &format!("{} {}", t.artist, t.title)).await else { break };
        let candidates = res?;
        if let Some(hit) = music_core::matching::best_match(t, &candidates) {
            state.lib.lock().unwrap().upsert_track(&merge_tracks(t, hit)).map_err(err)?;
            found += 1;
        }
    }
    let left = YT_SEARCHES_PER_DAY.saturating_sub(yt_used(&state.lib.lock().unwrap()));
    Ok(FindReport { found, missing: todo.len() - found, youtube_searches_left: left })
}

/// Apple 30 s preview into the local engine. Returns store page (shown as "Listen on Apple Music").
#[tauri::command]
async fn play_preview(state: State<'_, AppState>, id: String, country: String) -> CmdResult<String> {
    let p = music_connectors::itunes::preview(music_connectors::itunes::LOOKUP, &id, &store(&country)).await.map_err(err)?;
    let bytes = music_connectors::itunes::preview_audio(&p).await.map_err(err)?;
    state.player.send(Command::PlayMemory { label: format!("apple:{id}").into(), bytes: bytes.into() });
    Ok(p.page)
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
        return Err("Invalid settings".into());
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

            app.manage(AppState { lib: Mutex::new(lib), store: Arc::new(secrets::KeyringStore::new(&app.config().identifier)), open, player: Player::spawn(), shield, yt_cache: Mutex::default() });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sources_status, connect, disconnect, sync_all, library, playlist_tracks, player, player_status, edit_playlist, add_link, search_catalogs, add_track, find_versions, play_preview, local_folders, set_local_folders, rescan_local, load_settings, save_settings, shield_status, set_shield, restart_app])
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
