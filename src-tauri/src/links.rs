//! Pasted Deezer and Apple Music playlist / album links: the connectors read a name, a cover and the songs (metadata
//! only), then each song gets its YouTube version like a Spotify import, and the ones found go in a new playlist.

use crate::spotify_web::{SpotifyLibraryImport, SpotifyProgress, SpotifySong};
use crate::{AppState, CmdResult, err, hosts, youtube_version};
use music_connectors::{deezer, itunes, linklist::LinkList};
use music_core::library::PlaylistEdit;
use music_core::model::{Source, Track};
use music_core::searchpace::Pace;
use serde::Serialize;
use std::collections::{BTreeSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
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

/// Checks for Cancel while YouTube makes the import wait.
const WAITING: Duration = Duration::from_millis(250);

/// One step of a search.
pub struct Searched<'a> {
    pub done: usize,
    /// Of those, the ones with a YouTube version.
    pub found: usize,
    pub song: Option<&'a Track>,
    /// YouTube refused: waiting before going on.
    pub waiting: bool,
}

/// The songs, and how many of them YouTube's refusals left unsearched (none found: not the same as none to find).
pub struct Found {
    pub tracks: Vec<Track>,
    pub unsearched: usize,
}

pub fn has_version(t: &Track) -> bool {
    t.ids.contains_key(&Source::Youtube)
}

/// What a search said of a song already in the library: its version, or none for now.
pub fn note_search(state: &AppState, song: &Track) {
    let lib = state.lib();
    let _ = if has_version(song) { lib.add_version(song) } else { lib.mark_not_found(song) };
}

/// Fills in the versions the library knows. Lock per song: the interface reads the library meanwhile.
pub fn fill_known(state: &AppState, tracks: &mut [Track]) {
    for t in tracks.iter_mut().filter(|t| !t.ids.contains_key(&Source::Youtube)) {
        if let Ok(Some(video)) = state.lib().known_youtube(t) {
            t.ids.insert(Source::Youtube, video);
        }
    }
}

/// Each song with its YouTube version when one exists, in order. What the library knows isn't searched: a list imported
/// again, or sharing songs with another, takes seconds. As fast as YouTube allows (`Pace`): a song refused goes back in
/// line. Songs not found lately are left alone. `progress`: after each song. None: stopped.
pub async fn find_on_youtube(app: &tauri::AppHandle, tracks: &[Track], progress: impl Fn(Searched)) -> Result<Option<Found>, String> {
    let state = app.state::<AppState>();
    let mut out = tracks.to_vec();
    fill_known(&state, &mut out);
    let todo = (0..out.len()).filter(|&i| !has_version(&out[i]) && !state.lib().not_found_lately(&out[i]).unwrap_or(false)).collect();
    search(app, out, todo, progress).await
}

/// `out[todo]` searched, whatever was said of them before.
async fn search(app: &tauri::AppHandle, mut out: Vec<Track>, mut todo: VecDeque<usize>, progress: impl Fn(Searched)) -> Result<Option<Found>, String> {
    let mut done = out.len() - todo.len();
    let mut found = out.iter().filter(|t| has_version(t)).count();
    progress(Searched { done, found, song: out.iter().rfind(|t| has_version(t)), waiting: false });
    let mut pace = Pace::default();
    let mut running = tokio::task::JoinSet::new();
    loop {
        if stopped() {
            return Ok(None);
        }
        let now = Instant::now();
        if pace.gave_up(now) {
            break;
        }
        while running.len() < pace.width(now) {
            let Some(i) = todo.pop_front() else { break };
            let (app, song) = (app.clone(), out[i].clone());
            running.spawn(async move { (i, youtube_version(&app.state::<AppState>(), &song).await) });
        }
        let Some(ended) = running.join_next().await else {
            if todo.is_empty() {
                break;
            }
            tokio::time::sleep(WAITING).await;
            continue;
        };
        let (i, song) = ended.map_err(err)?;
        match song {
            Some(song) => {
                pace.answered(Instant::now());
                out[i] = song;
                done += 1;
                found += usize::from(has_version(&out[i]));
                progress(Searched { done, found, song: Some(&out[i]), waiting: false });
            }
            None => {
                pace.refused(Instant::now());
                todo.push_back(i);
                progress(Searched { done, found, song: None, waiting: true });
            }
        }
    }
    if pace.refusals > 0 {
        crate::diag::warn("import", "YouTube refused searches", &format!("{} refused, {done} answered", pace.refusals));
    }
    Ok((!stopped()).then_some(Found { tracks: out, unsearched: todo.len() + running.len() }))
}

/// The songs not found, to look at.
#[tauri::command]
pub async fn not_found(state: State<'_, AppState>) -> CmdResult<Vec<i64>> {
    state.lib().not_found().map_err(err)
}

/// The songs not found, looked up again now: the import's screen, its pace. `import_link_stop` ends it with "canceled".
#[tauri::command]
pub async fn not_found_search(app: tauri::AppHandle, state: State<'_, AppState>) -> CmdResult<SpotifyLibraryImport> {
    let _running = begin()?;
    let tracks: Vec<Track> = {
        let lib = state.lib();
        let ids: BTreeSet<i64> = lib.not_found().map_err(err)?.into_iter().collect();
        lib.tracks().map_err(err)?.into_iter().filter(|t| ids.contains(&t.id)).map(|t| t.track).collect()
    };
    let to_search = tracks.len();
    let step = |step: Searched| {
        if let Some(song) = step.song {
            note_search(&state, song);
        }
        let progress = SpotifyProgress { name: String::new(), list: 1, lists: 1, matching: true, done: step.done, total: to_search, all_done: step.done, all_total: to_search, playable: step.found, searched: step.done, to_search, waiting: step.waiting, song: step.song.map(SpotifySong::from) };
        let _ = app.emit_to("main", "spotify-import", progress);
    };
    let Some(found) = search(&app, tracks, (0..to_search).collect(), step).await? else { return Err("canceled".into()) };
    Ok(SpotifyLibraryImport { playlist_id: None, lists: 0, songs: to_search, playable: found.tracks.iter().filter(|t| has_version(t)).count(), failed: Vec::new(), unsearched: found.unsearched })
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
    let tracks = find_on_youtube(&app, &list.tracks, progress).await?.ok_or("canceled")?.tracks;
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
