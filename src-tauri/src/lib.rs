mod secrets;

use music_connectors::oauth::Opener;
use music_connectors::spotify::Spotify;
use music_connectors::youtube::YouTube;
use music_core::library::{Library, LibraryPlaylist, LibraryTrack};
use music_core::model::{Connector, SecretStore, Source};
use music_core::sync::{SyncReport, sync};
use serde::{Deserialize, Serialize};
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let handle = app.handle().clone();
            let open: Opener = Arc::new(move |url: &str| handle.opener().open_url(url, None::<&str>).map_err(Into::into));
            app.manage(AppState {
                lib: Mutex::new(Library::open(dir.join("library.db"))?),
                store: Arc::new(secrets::KeyringStore::new(&app.config().identifier)),
                open,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sources_status, connect, disconnect, sync_all, library, playlist_tracks])
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
