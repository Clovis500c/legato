//! Pasted Deezer and Apple Music playlist / album links: the connectors read a name, a cover and the songs (metadata
//! only), then each song gets its YouTube version like a Spotify import, and the ones found go in a new playlist.

use crate::{AppState, CmdResult, err, hosts, with_youtube};
use music_connectors::{deezer, itunes, linklist::LinkList};
use music_core::library::PlaylistEdit;
use music_core::model::{Source, Track};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, State};

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LinkImport {
    /// None: no song was found on YouTube, no playlist made.
    playlist_id: Option<i64>,
    name: String,
    /// Songs read from the link.
    songs: usize,
    /// Of those, the ones found on YouTube (they play in full).
    found: usize,
    /// Songs the service says the list has: more than `songs` when its page showed only the first ones.
    total: usize,
    /// The first songs not found ("Artist – Title"), to show.
    missing: Vec<String>,
}

/// Is it a Deezer link? Else an Apple Music one. Pasted text only picks the service; the hosts are ours.
async fn read(url: &str) -> anyhow::Result<LinkList> {
    let h = hosts::get();
    // By host, not by a good path: a Deezer link with a typo says "Not a Deezer link", not an Apple Music error.
    if deezer::is_deezer(url) {
        deezer::Deezer::with_urls(h.deezer, h.deezer_link).fetch(url).await
    } else {
        itunes::link_list(h.apple_page, h.itunes_lookup, url).await
    }
}

/// One import at a time (the stop flag is shared).
static BUSY: AtomicBool = AtomicBool::new(false);
static STOP: AtomicBool = AtomicBool::new(false);

/// Frees `BUSY` on every way out of the import, errors included.
pub struct Running;

impl Drop for Running {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::Release);
    }
}

/// The one import at a time starts; `import_link_stop` is what ends it.
pub fn begin() -> Result<Running, String> {
    if BUSY.swap(true, Ordering::AcqRel) {
        return Err("an import is already running".into());
    }
    STOP.store(false, Ordering::Relaxed);
    Ok(Running)
}

pub fn stopped() -> bool {
    STOP.load(Ordering::Relaxed)
}

/// Searches running at once, a new one as each ends: quick, still polite (unofficial APIs).
const SEARCHES: usize = 8;

/// One step of a search.
pub struct Searched<'a> {
    pub done: usize,
    /// Of those, the ones with a YouTube version.
    pub found: usize,
    pub song: Option<&'a Track>,
}

/// Each song with its YouTube version when one exists, in order. What the library knows isn't searched: a list imported
/// again, or sharing songs with another, takes seconds. `progress`: after each song. None: stopped.
pub async fn find_on_youtube(app: &tauri::AppHandle, tracks: &[Track], progress: impl Fn(Searched)) -> Result<Option<Vec<Track>>, String> {
    let state = app.state::<AppState>();
    let mut out = tracks.to_vec();
    let playable = |t: &Track| t.ids.contains_key(&Source::Youtube);
    for t in out.iter_mut().filter(|t| !t.ids.contains_key(&Source::Youtube)) {
        // Lock per song: the interface reads the library meanwhile.
        if let Ok(Some(video)) = state.lib().known_youtube(t) {
            t.ids.insert(Source::Youtube, video);
        }
    }
    let mut todo = (0..out.len()).filter(|&i| !playable(&out[i])).collect::<Vec<_>>().into_iter();
    let mut done = out.len() - todo.len();
    let mut found = done;
    progress(Searched { done, found, song: out.iter().rfind(|t| playable(t)) });
    let mut running = tokio::task::JoinSet::new();
    loop {
        if stopped() {
            return Ok(None);
        }
        while running.len() < SEARCHES {
            let Some(i) = todo.next() else { break };
            let (app, song) = (app.clone(), out[i].clone());
            running.spawn(async move { (i, with_youtube(&app.state::<AppState>(), song).await) });
        }
        let Some(ended) = running.join_next().await else { break };
        let (i, song) = ended.map_err(err)?;
        out[i] = song;
        done += 1;
        found += usize::from(playable(&out[i]));
        progress(Searched { done, found, song: Some(&out[i]) });
    }
    Ok((!stopped()).then_some(out))
}

/// Deezer or Apple Music playlist / album link → a playlist of yours, no account. Same flow as a Spotify link.
/// Progress: "import-progress" events `[searched, total]` after each batch of searches. `import_link_stop` ends it with
/// "canceled", nothing made.
#[tauri::command]
pub async fn import_link(app: tauri::AppHandle, state: State<'_, AppState>, url: String) -> CmdResult<LinkImport> {
    // Trust boundary: clipboard / typed text.
    if url.len() > 2048 {
        return Err("Link too long".into());
    }
    let _running = begin()?;
    let list = read(url.trim()).await.map_err(err)?;
    let total = list.tracks.len();
    let progress = |step: Searched| {
        let _ = app.emit_to("main", "import-progress", [step.done, total]);
    };
    let tracks = find_on_youtube(&app, &list.tracks, progress).await?.ok_or("canceled")?;
    let (found, missing): (Vec<_>, Vec<_>) = tracks.into_iter().partition(|t| t.ids.contains_key(&Source::Youtube));
    let missing: Vec<String> = missing.iter().map(|t| format!("{} – {}", t.artist, t.title)).collect();
    let name: String = list.name.trim().chars().take(100).collect();
    let report = |playlist_id, found| LinkImport { playlist_id, name: name.clone(), songs: list.tracks.len(), found, total: list.total, missing: missing.iter().take(20).cloned().collect() };
    if found.is_empty() {
        return Ok(report(None, 0));
    }
    let lib = state.lib();
    let id = lib.edit_playlist(PlaylistEdit::Create { name: name.clone() }).map_err(err)?.ok_or("Playlist not created")?;
    let mut ids = Vec::with_capacity(found.len());
    for t in &found {
        // Asked for by hand: a song removed earlier comes back.
        lib.unremove(t).map_err(err)?;
        ids.push(lib.upsert_track(t).map_err(err)?);
    }
    lib.edit_playlist(PlaylistEdit::Add { id, track_ids: ids }).map_err(err)?;
    Ok(report(Some(id), found.len()))
}

/// The Cancel on the "Importing…" toast.
#[tauri::command]
pub fn import_link_stop() {
    STOP.store(true, Ordering::Relaxed);
}
