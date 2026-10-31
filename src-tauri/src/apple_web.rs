//! Connect Apple Music (user's choice 2026-10-31, against Apple's terms: the app says so first): Apple's own web player
//! (music.apple.com) in an app window, the user signs in on Apple's page, then `music_shield::APPLE_SCRIPT` reads the
//! playlists and songs it draws. No token, no request of ours to Apple, no developer account. Answers come on WebView2's
//! message channel, checked by `music_connectors::apple_page`; songs then go through the same import as Spotify's.

// Windows only for the channel; the rest still builds everywhere.
#![cfg_attr(not(windows), allow(dead_code))]

use crate::spotify_web::{SpotifyLibraryImport, SpotifyList, SpotifyPick, SpotifyProgress, SpotifySong};
use crate::{AppState, CmdResult, err, links};
use anyhow::Context;
use music_connectors::apple_page::{self, Message};
use music_connectors::linklist::MAX_TRACKS;
use music_core::model::{Source, Track};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, Url, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use tokio::time::timeout;

const PLAYER: &str = "https://music.apple.com/";
/// Apple's own sign-in sheet over the player.
const SIGN_IN: &str = "https://music.apple.com/login";
const LABEL: &str = "apple-music";
/// Silence from the page past this: it stopped. A list waits up to 20 s for its first rows.
const QUIET: Duration = Duration::from_secs(40);

/// Where the page's messages go while a job runs.
static INBOX: Mutex<Option<UnboundedSender<Message>>> = Mutex::new(None);

/// Signed in to the web player (media-user-token = Apple Music web session cookie). Profile shared with the main window.
/// WebView2: call from async commands or threads only (sync = deadlock).
pub fn signed_in(app: &AppHandle) -> bool {
    let Some(main) = app.get_webview("main") else { return false };
    let Ok(url) = Url::parse(PLAYER) else { return false };
    main.cookies_for_url(url).is_ok_and(|c| c.iter().any(|c| c.name() == "media-user-token" && !c.value().is_empty()))
}

/// Opens (or focuses) Apple's web player, straight on its sign-in sheet when signed out.
/// WebView2: call from async commands or threads only (`signed_in`).
fn open(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        return w.set_focus();
    }
    let page = if signed_in(app) { PLAYER } else { SIGN_IN };
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(Url::parse(page).expect("valid url"))).additional_browser_args(&crate::background::browser_args()).title("Apple Music").inner_size(1100.0, 760.0).initialization_script(music_shield::APPLE_SCRIPT).build()?;
    #[cfg(windows)]
    if let Some(wv) = app.get_webview(LABEL) {
        crate::ytwatch::on_message(&wv, |source, message| {
            if let Some(m) = apple_page::parse(source, message)
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
    let w = app.get_webview_window(LABEL).context("Apple Music's window was closed")?;
    let (tx, mut rx) = unbounded_channel();
    *INBOX.lock().unwrap() = Some(tx);
    w.navigate(Url::parse(&format!("{PLAYER}{path}"))?)?;
    // The page being left must not take the call.
    tokio::time::sleep(Duration::from_millis(1500)).await;
    for _ in 0..30 {
        w.eval(format!("window.__legatoApple && window.__legatoApple.{call}()"))?;
        if let Ok(Some(Message::Started)) = timeout(Duration::from_secs(1), rx.recv()).await {
            return Ok(rx);
        }
    }
    anyhow::bail!("Apple Music's page didn't answer")
}

async fn next(rx: &mut UnboundedReceiver<Message>) -> anyhow::Result<Message> {
    match timeout(QUIET, rx.recv()).await {
        Ok(Some(Message::Failed(e))) => anyhow::bail!("Apple Music's page: {e}"),
        Ok(Some(m)) => Ok(m),
        _ => anyhow::bail!("Apple Music's page stopped answering"),
    }
}

/// The songs of one playlist, as the page draws them. `read`: songs so far, songs the list says it has.
async fn songs(app: &AppHandle, id: &str, mut read: impl FnMut(usize, usize)) -> anyhow::Result<Vec<Track>> {
    let path = apple_page::list_path(id).context("Invalid list")?;
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

#[tauri::command]
pub async fn apple_web_open(app: AppHandle) -> CmdResult<()> {
    open(&app).map_err(err)
}

#[tauri::command]
pub async fn apple_web_status(app: AppHandle) -> bool {
    signed_in(&app)
}

/// The playlists in the signed-in user's library (Favorite Songs is one).
#[tauri::command]
pub async fn apple_lists(app: AppHandle) -> CmdResult<Vec<SpotifyList>> {
    async {
        let mut rx = start(&app, apple_page::LISTS_PATH, "lists").await?;
        let mut all = Vec::new();
        loop {
            match next(&mut rx).await? {
                Message::Lists(lists) => all.extend(lists.into_iter().map(|l| SpotifyList { id: l.id, name: l.name, cover: l.cover, songs: None })),
                Message::Done => return anyhow::Ok(all),
                _ => {}
            }
        }
    }
    .await
    .map_err(err)
}

/// The ticked playlists → imported playlists, each song with its YouTube version; a second import updates them. A list
/// that fails is reported, the others go on. `import_link_stop` ends it with "canceled": lists already saved stay.
#[tauri::command]
pub async fn apple_import(app: AppHandle, state: State<'_, AppState>, picks: Vec<SpotifyPick>) -> CmdResult<SpotifyLibraryImport> {
    // Trust boundary: ids checked by list_path, names bounded.
    if picks.is_empty() || picks.len() > 500 || picks.iter().any(|p| p.name.trim().is_empty() || p.name.chars().count() > 200) {
        return Err("Invalid lists".into());
    }
    let _running = links::begin()?;
    let window = app.get_webview_window(LABEL).ok_or("Apple Music's window was closed")?;
    // Chromium stops drawing a window hidden behind others, and the list draws its rows as it goes.
    let _ = window.set_always_on_top(true);
    let lists = picks.len();
    let mut report = SpotifyLibraryImport { playlist_id: None, lists: 0, songs: 0, playable: 0, failed: Vec::new(), unsearched: 0 };
    for (n, pick) in picks.iter().enumerate() {
        if links::stopped() {
            break;
        }
        let before = report.playable;
        let tell = |matching, done, total, playable, wait_secs, song: Option<&Track>| {
            let _ = app.emit_to("main", "spotify-import", SpotifyProgress { name: pick.name.clone(), list: n + 1, lists, matching, done, total, all_done: 0, all_total: 0, playable, searched: 0, to_search: 0, wait_secs, song: song.map(SpotifySong::from) });
        };
        tell(false, 0, 0, before, 0, None);
        let read = match songs(&app, &pick.id, |done, total| tell(false, done, total, before, 0, None)).await {
            Ok(read) if !read.is_empty() => read,
            Ok(_) => {
                report.failed.push(pick.name.clone());
                continue;
            }
            Err(e) => {
                crate::diag::warn("apple", "a list couldn't be read", &format!("{e:#}"));
                report.failed.push(pick.name.clone());
                continue;
            }
        };
        let total = read.len();
        let Some(links::Found { tracks, unsearched }) = links::find_on_youtube(&app, &read, |step| tell(true, step.done, total, before + step.found, step.wait_secs, step.song)).await? else { break };
        let id = state.lib().save_playlist(Source::Apple, &pick.id, pick.name.trim(), &tracks).map_err(err)?;
        report.unsearched += unsearched;
        // Saved only now, so remembered only now. YouTube's refusals left some unsearched: can't tell which.
        if unsearched == 0 {
            for song in tracks.iter().filter(|t| !links::has_version(t) && !state.lib().not_found_lately(t).unwrap_or(true)) {
                links::note_search(&state, song);
            }
        }
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
pub async fn apple_web_close(app: AppHandle) -> CmdResult<()> {
    match app.get_webview_window(LABEL) {
        Some(w) => w.close().map_err(err),
        None => Ok(()),
    }
}
