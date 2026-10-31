//! Spotify's lists through Exportify (user's choice 2026-10-31): any account, nothing read from Spotify's page. Its own
//! page in an app window (no IPC), its buttons pressed by `music_shield::EXPORTIFY_SCRIPT`, the user's only step is consent
//! on Spotify's page, the first time. The file it makes is caught here, read by `music_core::spotify_export` and deleted.

use crate::spotify_web::{SpotifyLibraryImport, SpotifyList, SpotifyPick, SpotifyProgress};
use crate::{AppState, CmdResult, err, links};
use music_core::model::Source;
use music_core::spotify_export::{self, ExportedList};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Emitter, Manager, State, Url, WebviewUrl, WebviewWindowBuilder};

const PAGE: &str = "https://exportify.app/";
const LABEL: &str = "exportify";

/// The file's lists, from reading it until the import or the dialog's end.
static HELD: Mutex<Vec<ExportedList>> = Mutex::new(Vec::new());
/// Where the download goes.
static SAVING: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Exportify's file arrived: its lists, or why not.
#[derive(Clone, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct SpotifyExport {
    lists: Vec<SpotifyList>,
    error: Option<String>,
}

/// Read and held; what the interface shows of it.
fn hold(path: &Path) -> anyhow::Result<Vec<SpotifyList>> {
    let lists = spotify_export::read(path)?;
    let shown = lists.iter().map(|l| SpotifyList { id: l.id.clone(), name: l.name.clone(), cover: l.cover().map(str::to_string), songs: Some(l.tracks.len() as u32) }).collect();
    *HELD.lock().unwrap() = lists;
    Ok(shown)
}

/// Exportify's file, built in its page: nothing else leaves that window.
fn on_download(wv: tauri::Webview, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, destination } => {
            let Ok(dir) = wv.app_handle().path().app_cache_dir().map(|d| d.join("exportify")) else { return false };
            let Some(name) = destination.file_name().map(PathBuf::from) else { return false };
            if !url.as_str().starts_with("blob:https://exportify.app/") || std::fs::create_dir_all(&dir).is_err() {
                return false;
            }
            *destination = dir.join(name);
            *SAVING.lock().unwrap() = Some(destination.clone());
            true
        }
        DownloadEvent::Finished { success, .. } => {
            let path = SAVING.lock().unwrap().take();
            let app = wv.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let Some(path) = path.filter(|_| success) else { return };
                let read = path.clone();
                let got = tauri::async_runtime::spawn_blocking(move || hold(&read)).await;
                let _ = std::fs::remove_file(path);
                let report = match got {
                    Ok(Ok(lists)) => SpotifyExport { lists, error: None },
                    Ok(Err(e)) => SpotifyExport { lists: Vec::new(), error: Some(format!("{e:#}")) },
                    Err(e) => SpotifyExport { lists: Vec::new(), error: Some(e.to_string()) },
                };
                let _ = app.emit_to("main", "spotify-export", report);
                if let Some(w) = app.get_webview_window(LABEL) {
                    let _ = w.close();
                }
            });
            true
        }
        _ => true,
    }
}

/// Opens (or focuses) Exportify's page. The file comes back as `spotify-export`.
#[tauri::command]
pub async fn spotify_export_open(app: AppHandle) -> CmdResult<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        return w.set_focus().map_err(err);
    }
    let page = Url::parse(PAGE).map_err(err)?;
    WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(page)).additional_browser_args(&crate::background::browser_args()).title("Exportify").inner_size(1000.0, 720.0).initialization_script(music_shield::EXPORTIFY_SCRIPT).on_download(on_download).build().map_err(err)?;
    Ok(())
}

/// The dialog is gone: its window and the lists go too.
#[tauri::command]
pub async fn spotify_export_close(app: AppHandle) -> CmdResult<()> {
    HELD.lock().unwrap().clear();
    match app.get_webview_window(LABEL) {
        Some(w) => w.close().map_err(err),
        None => Ok(()),
    }
}

/// The ticked lists → imported playlists, each song with its YouTube version. The same list imported again replaces its
/// copy. `import_link_stop` ends it with "canceled": lists already saved stay.
#[tauri::command]
pub async fn spotify_export_import(app: AppHandle, state: State<'_, AppState>, picks: Vec<SpotifyPick>) -> CmdResult<SpotifyLibraryImport> {
    let _running = links::begin()?;
    let held = std::mem::take(&mut *HELD.lock().unwrap());
    let picked: Vec<(ExportedList, String)> = picks.into_iter().filter_map(|p| Some((held.iter().find(|l| l.id == p.id)?.clone(), p.name))).collect();
    if picked.is_empty() {
        return Err("Invalid lists".into());
    }
    let lists = picked.len();
    let mut report = SpotifyLibraryImport { playlist_id: None, lists: 0, songs: 0, playable: 0, failed: Vec::new() };
    for (n, (list, name)) in picked.iter().enumerate() {
        // Trust boundary: the interface's name, bounded.
        let name = name.trim();
        let name = if name.is_empty() || name.chars().count() > 200 { list.name.as_str() } else { name };
        let total = list.tracks.len();
        let tell = |done| {
            let _ = app.emit_to("main", "spotify-import", SpotifyProgress { name: name.to_string(), list: n + 1, lists, matching: true, done, total });
        };
        let Some(tracks) = links::find_on_youtube(&app, &list.tracks, tell).await? else { break };
        let id = crate::spotify_web::save(&state, &list.id, name, &tracks).map_err(err)?;
        report.playlist_id.get_or_insert(id);
        report.lists += 1;
        report.songs += total;
        report.playable += tracks.iter().filter(|t| t.ids.contains_key(&Source::Youtube)).count();
    }
    if links::stopped() {
        return Err("canceled".into());
    }
    Ok(report)
}
