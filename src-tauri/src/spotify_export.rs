//! Spotify's lists through Exportify (user's choice 2026-10-31): any account, nothing read from Spotify's page. Its own
//! page in an app window (no IPC), its buttons pressed by `music_shield::EXPORTIFY_SCRIPT`, the user's only step is consent
//! on Spotify's page, the first time. The file it makes is caught here, read by `music_core::spotify_export` and deleted.
//! A third party's site: watched, so it failing ends in words, not a window left waiting (`Watch`).

use crate::spotify_web::{SpotifyLibraryImport, SpotifyList, SpotifyPick, SpotifyProgress, SpotifySong};
use crate::{AppState, CmdResult, err, links};
use music_core::model::Source;
use music_core::spotify_export::{self, ExportTrouble, ExportedList, Next, Signal, Watch};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Emitter, Manager, State, Url, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::mpsc::error::TryRecvError;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};

const PAGE: &str = "https://exportify.app/";
const LABEL: &str = "exportify";
const STEP: Duration = Duration::from_secs(1);

/// The file's lists, from reading it until the import or the dialog's end.
static HELD: Mutex<Vec<ExportedList>> = Mutex::new(Vec::new());
/// Where the download goes.
static SAVING: Mutex<Option<PathBuf>> = Mutex::new(None);
/// The page's signals. A new window replaces it, which ends the last one's watch.
static SIGNALS: Mutex<Option<UnboundedSender<Signal>>> = Mutex::new(None);

/// Exportify's window ended: its lists, or why not.
#[derive(Clone, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct SpotifyExport {
    lists: Vec<SpotifyList>,
    trouble: Option<ExportTrouble>,
}

/// The window's end, its window gone.
fn report(app: &AppHandle, lists: Vec<SpotifyList>, trouble: Option<ExportTrouble>) {
    // Said once: ends the watch.
    *SIGNALS.lock().unwrap() = None;
    let _ = app.emit_to("main", "spotify-export", SpotifyExport { lists, trouble });
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
}

/// Until the window closes: no page, a page without its buttons, a reading gone silent, a refusal.
#[cfg_attr(not(windows), allow(dead_code))]
async fn watch(app: AppHandle, mut signals: UnboundedReceiver<Signal>) {
    let mut watch = Watch::default();
    let mut clock = tokio::time::interval(STEP);
    loop {
        clock.tick().await;
        let mut trouble = None;
        loop {
            match signals.try_recv() {
                Ok(s) => trouble = trouble.or(watch.heard(s)),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return,
            }
        }
        let Some(w) = app.get_webview_window(LABEL) else { return report(&app, Vec::new(), Some(ExportTrouble::Closed)) };
        let url = w.url().map(String::from).unwrap_or_default();
        let next = trouble.map_or_else(|| watch.tick(STEP, &url), Next::Stop);
        match next {
            Next::Wait => {}
            Next::BringBack => {
                if let Ok(page) = Url::parse(PAGE) {
                    let _ = w.navigate(page);
                }
            }
            Next::Stop(t) => {
                crate::diag::warn("spotify", "Exportify's window gave up", &format!("{t:?}"));
                return report(&app, Vec::new(), Some(t));
            }
        }
    }
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
                let Some(path) = path else { return };
                let read = path.clone();
                let got = tauri::async_runtime::spawn_blocking(move || if success { hold(&read) } else { anyhow::bail!("download failed") }).await;
                let _ = std::fs::remove_file(path);
                match got.map_err(anyhow::Error::from).and_then(|r| r) {
                    Ok(lists) => report(&app, lists, None),
                    Err(e) => {
                        crate::diag::warn("spotify", "Exportify's file couldn't be read", &format!("{e:#}"));
                        report(&app, Vec::new(), Some(ExportTrouble::BadFile));
                    }
                }
            });
            true
        }
        _ => true,
    }
}

/// Opens (or focuses) Exportify's page. The file comes back as `spotify-export`.
#[tauri::command]
pub async fn spotify_export_open(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    state.spotify_takes()?;
    if let Some(w) = app.get_webview_window(LABEL) {
        return w.set_focus().map_err(err);
    }
    let page = Url::parse(PAGE).map_err(err)?;
    WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(page)).additional_browser_args(&crate::background::browser_args()).title("Exportify").inner_size(1000.0, 720.0).initialization_script(music_shield::EXPORTIFY_SCRIPT).on_download(on_download).build().map_err(err)?;
    // No channel, no signals: elsewhere nothing to tell a silent page from a working one.
    #[cfg(windows)]
    if let Some(wv) = app.get_webview(LABEL) {
        let (tx, rx) = unbounded_channel();
        *SIGNALS.lock().unwrap() = Some(tx);
        crate::ytwatch::on_message(&wv, |source, message| {
            if let Some(s) = spotify_export::signal(source, message)
                && let Some(signals) = SIGNALS.lock().unwrap().as_ref()
            {
                let _ = signals.send(s);
            }
        })
        .map_err(err)?;
        tauri::async_runtime::spawn(watch(app.clone(), rx));
    }
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

/// The ticked lists → imported playlists. Every list first, in seconds, with the versions the library knows: the library
/// has them whatever the searches take. Then one search of each unknown song, its version joining the lists as it's found.
/// The same list imported again replaces its copy. `import_link_stop` ends it with "canceled": the lists stay, an import
/// later looks up what's left.
#[tauri::command]
pub async fn spotify_export_import(app: AppHandle, state: State<'_, AppState>, picks: Vec<SpotifyPick>) -> CmdResult<SpotifyLibraryImport> {
    let _running = links::begin()?;
    let held = std::mem::take(&mut *HELD.lock().unwrap());
    let mut picked: Vec<(ExportedList, String)> = picks.into_iter().filter_map(|p| Some((held.iter().find(|l| l.id == p.id)?.clone(), p.name))).collect();
    if picked.is_empty() {
        return Err("Invalid lists".into());
    }
    let has_version = links::has_version;
    let mut seen = BTreeSet::new();
    let mut missing = Vec::new();
    for (list, _) in &mut picked {
        links::fill_known(&state, &mut list.tracks);
        missing.extend(list.tracks.iter().filter(|t| !has_version(t) && !state.lib().not_found_lately(t).unwrap_or(false) && seen.insert(t.ids.get(&Source::Spotify).cloned())).cloned());
    }
    let lists = picked.len();
    let to_search = missing.len();
    let all_total: usize = picked.iter().map(|(l, _)| l.tracks.len()).sum();
    let mut report = SpotifyLibraryImport { playlist_id: None, lists: 0, songs: 0, playable: 0, failed: Vec::new(), unsearched: 0 };
    let tell = |progress: SpotifyProgress| {
        let _ = app.emit_to("main", "spotify-import", progress);
    };
    for (n, (list, name)) in picked.iter().enumerate() {
        if links::stopped() {
            return Err("canceled".into());
        }
        // Trust boundary: the interface's name, bounded.
        let name = name.trim();
        let name = if name.is_empty() || name.chars().count() > 200 { list.name.as_str() } else { name };
        let id = crate::spotify_web::save(&state, &list.id, name, &list.tracks).map_err(err)?;
        report.playlist_id.get_or_insert(id);
        report.lists += 1;
        report.songs += list.tracks.len();
        report.playable += list.tracks.iter().filter(|t| has_version(t)).count();
        let song = list.tracks.iter().rfind(|t| has_version(t)).map(SpotifySong::from);
        tell(SpotifyProgress { name: name.to_string(), list: n + 1, lists, matching: false, done: list.tracks.len(), total: list.tracks.len(), all_done: report.playable, all_total, playable: report.playable, searched: 0, to_search, waiting: false, song });
    }
    let known = report.playable;
    let step = |step: links::Searched| {
        if let Some(song) = step.song {
            links::note_search(&state, song);
        }
        tell(SpotifyProgress { name: String::new(), list: lists, lists, matching: true, done: step.done, total: to_search, all_done: all_total - to_search + step.done, all_total, playable: known + step.found, searched: step.done, to_search, waiting: step.waiting, song: step.song.map(SpotifySong::from) });
    };
    let Some(found) = links::find_on_youtube(&app, &missing, step).await? else { return Err("canceled".into()) };
    let versions: BTreeSet<_> = found.tracks.iter().filter(|t| has_version(t)).filter_map(|t| t.ids.get(&Source::Spotify)).collect();
    report.playable = picked.iter().flat_map(|(l, _)| &l.tracks).filter(|t| has_version(t) || t.ids.get(&Source::Spotify).is_some_and(|id| versions.contains(id))).count();
    report.unsearched = found.unsearched;
    Ok(report)
}
