//! Spotify without keys: Spotify's own web player (open.spotify.com) in an app window.
//! The user signs in on Spotify's page; audio plays in Spotify's official player (Widevine DRM, available in WebView2).
//! The window gets no capability (remote page, no IPC) and no ad blocking: the shield only hooks the main window.
//! Connect Spotify (user's choice 2026-10-31, against Spotify's User Guidelines: the app says so first): the page's own
//! rows are read by `music_shield::SPOTIFY_SCRIPT`, private playlists and Liked Songs included. No token, no request of
//! ours to Spotify. Answers come on WebView2's message channel, checked by `music_connectors::spotify_page`.

// Windows only for the channel; the rest still builds everywhere.
#![cfg_attr(not(windows), allow(dead_code))]

use crate::{AppState, CmdResult, err, links};
use anyhow::Context;
use music_connectors::linklist::MAX_TRACKS;
use music_connectors::spotify_page::{self, Message};
use music_core::model::{Source, Track};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, Url, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use tokio::time::timeout;

const PLAYER: &str = "https://open.spotify.com/";
/// Spotify's own sign-in page, back to the player after.
const SIGN_IN: &str = "https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F";
const LABEL: &str = "spotify-web";
/// Silence from the page past this: it stopped. A list waits up to 20 s for its first rows.
const QUIET: Duration = Duration::from_secs(40);

/// Where the page's messages go while a job runs.
static INBOX: Mutex<Option<UnboundedSender<Message>>> = Mutex::new(None);

/// Signed in to the web player (sp_dc = Spotify web session cookie). Profile shared with the main window.
/// WebView2: call from async commands or threads only (sync = deadlock).
pub fn signed_in(app: &AppHandle) -> bool {
    let Some(main) = app.get_webview("main") else { return false };
    let Ok(url) = Url::parse(PLAYER) else { return false };
    main.cookies_for_url(url).is_ok_and(|c| c.iter().any(|c| c.name() == "sp_dc" && !c.value().is_empty()))
}

/// Opens (or focuses) the official web player, straight on Spotify's sign-in page when signed out.
/// WebView2: call from async commands or threads only (`signed_in`).
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        return w.set_focus();
    }
    let page = if signed_in(app) { PLAYER } else { SIGN_IN };
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(Url::parse(page).expect("valid url"))).additional_browser_args(&crate::background::browser_args()).title("Spotify").inner_size(1100.0, 760.0).initialization_script(music_shield::SPOTIFY_SCRIPT).build()?;
    #[cfg(windows)]
    if let Some(wv) = app.get_webview(LABEL) {
        crate::ytwatch::on_message(&wv, |source, message| {
            if let Some(m) = spotify_page::parse(source, message)
                && let Some(inbox) = INBOX.lock().unwrap().as_ref()
            {
                let _ = inbox.send(m);
            }
        })?;
    }
    Ok(())
}

/// Starts a job of the page's script (`call`: a fixed name), on `path` of the player. The new page takes a moment and
/// the script runs one job at a time: asked again until it says it started.
async fn start(app: &AppHandle, path: &str, call: &str) -> anyhow::Result<UnboundedReceiver<Message>> {
    let w = app.get_webview_window(LABEL).context("Spotify's window was closed")?;
    let (tx, mut rx) = unbounded_channel();
    *INBOX.lock().unwrap() = Some(tx);
    w.navigate(Url::parse(&format!("{PLAYER}{path}"))?)?;
    // The page being left must not take the call.
    tokio::time::sleep(Duration::from_millis(1500)).await;
    for _ in 0..30 {
        w.eval(format!("window.__legatoSpotify && window.__legatoSpotify.{call}()"))?;
        if let Ok(Some(Message::Started)) = timeout(Duration::from_secs(1), rx.recv()).await {
            return Ok(rx);
        }
    }
    anyhow::bail!("Spotify's page didn't answer")
}

async fn next(rx: &mut UnboundedReceiver<Message>) -> anyhow::Result<Message> {
    match timeout(QUIET, rx.recv()).await {
        Ok(Some(Message::Failed(e))) => anyhow::bail!("Spotify's page: {e}"),
        Ok(Some(m)) => Ok(m),
        _ => anyhow::bail!("Spotify's page stopped answering"),
    }
}

/// The songs of one list, as the page draws them. `read`: songs so far, songs the list says it has.
async fn songs(app: &AppHandle, id: &str, mut read: impl FnMut(usize, usize)) -> anyhow::Result<Vec<Track>> {
    let path = spotify_page::list_path(id).context("Invalid list")?;
    let mut rx = start(app, &path, "read").await?;
    let mut all = Vec::new();
    loop {
        match next(&mut rx).await? {
            Message::Songs { songs, total } => {
                all.extend(songs);
                all.truncate(MAX_TRACKS);
                read(all.len(), total.max(all.len()));
            }
            Message::Done => return Ok(all),
            _ => {}
        }
    }
}

/// A playlist of the signed-in user, as Spotify's column shows it. Songs: when the row says.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SpotifyList {
    id: String,
    name: String,
    cover: Option<String>,
    songs: Option<u32>,
}

/// The playlists in the signed-in user's library. Liked Songs isn't one: the interface adds it.
#[tauri::command]
pub async fn spotify_lists(app: AppHandle) -> CmdResult<Vec<SpotifyList>> {
    async {
        let mut rx = start(&app, "", "lists").await?;
        let mut all = Vec::new();
        loop {
            match next(&mut rx).await? {
                Message::Lists(lists) => all.extend(lists.into_iter().map(|l| SpotifyList { id: l.id, name: l.name, cover: l.cover, songs: l.songs })),
                Message::Done => return anyhow::Ok(all),
                _ => {}
            }
        }
    }
    .await
    .map_err(err)
}

#[derive(Debug, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct SpotifyPick {
    id: String,
    name: String,
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SpotifyLibraryImport {
    /// The first list saved, to open.
    playlist_id: Option<i64>,
    lists: usize,
    songs: usize,
    /// Of those, the ones with a YouTube version (they play in full).
    playable: usize,
    /// Lists that couldn't be read or held no songs.
    failed: Vec<String>,
}

#[derive(Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SpotifyProgress {
    name: String,
    /// This list's place among the picked ones, from 1.
    list: usize,
    lists: usize,
    /// False: reading Spotify's page. True: finding the songs on YouTube.
    matching: bool,
    done: usize,
    total: usize,
}

/// The ticked lists → imported playlists, each song with its YouTube version. Same ids as a Spotify link's import, so a
/// second import updates them. A list that fails is reported, the others go on. `import_link_stop` ends it with
/// "canceled": lists already saved stay.
#[tauri::command]
pub async fn spotify_import(app: AppHandle, state: State<'_, AppState>, picks: Vec<SpotifyPick>) -> CmdResult<SpotifyLibraryImport> {
    // Trust boundary: ids checked by list_path, names bounded.
    if picks.is_empty() || picks.len() > 500 || picks.iter().any(|p| p.name.trim().is_empty() || p.name.chars().count() > 200) {
        return Err("Invalid lists".into());
    }
    let _running = links::begin()?;
    let window = app.get_webview_window(LABEL).ok_or("Spotify's window was closed")?;
    // Chromium stops drawing a window hidden behind others, and the list draws its rows as it goes.
    let _ = window.set_always_on_top(true);
    let lists = picks.len();
    let mut report = SpotifyLibraryImport { playlist_id: None, lists: 0, songs: 0, playable: 0, failed: Vec::new() };
    for (n, pick) in picks.iter().enumerate() {
        if links::stopped() {
            break;
        }
        let tell = |matching, done, total| {
            let _ = app.emit_to("main", "spotify-import", SpotifyProgress { name: pick.name.clone(), list: n + 1, lists, matching, done, total });
        };
        tell(false, 0, 0);
        let read = match songs(&app, &pick.id, |done, total| tell(false, done, total)).await {
            Ok(read) if !read.is_empty() => read,
            Ok(_) => {
                report.failed.push(pick.name.clone());
                continue;
            }
            Err(e) => {
                crate::diag::warn("spotify", "a list couldn't be read", &format!("{e:#}"));
                report.failed.push(pick.name.clone());
                continue;
            }
        };
        let total = read.len();
        let Some(tracks) = links::find_on_youtube(&app, &read, |done| tell(true, done, total)).await? else { break };
        let id = state.lib().save_playlist(Source::Spotify, &pick.id, pick.name.trim(), &tracks).map_err(err)?;
        report.playlist_id.get_or_insert(id);
        report.lists += 1;
        report.songs += total;
        report.playable += tracks.iter().filter(|t| t.ids.contains_key(&Source::Youtube)).count();
    }
    let _ = window.close();
    if links::stopped() {
        return Err("canceled".into());
    }
    Ok(report)
}

/// The dialog is gone: its window goes too, the session stays.
#[tauri::command]
pub async fn spotify_web_close(app: AppHandle) -> CmdResult<()> {
    match app.get_webview_window(LABEL) {
        Some(w) => w.close().map_err(err),
        None => Ok(()),
    }
}
