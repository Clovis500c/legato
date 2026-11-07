//! Pasted Deezer and Apple Music playlist / album links: the connectors read a name, a cover and the songs (metadata
//! only), then each song gets its YouTube version like a Spotify import, and the ones found go in a new playlist.
//! A SoundCloud song link: one song, named the same way (`song_link`).

use crate::spotify_web::{SpotifyLibraryImport, SpotifyProgress, SpotifySong};
use crate::{AppState, CmdResult, err, hosts, youtube_version};
use music_connectors::{deezer, itunes, linklist::LinkList, soundcloud};
use music_core::library::PlaylistEdit;
use music_core::matching::same_track;
use music_core::model::{Source, Track};
use music_core::searchpace::{Line, Pace};
use serde::Serialize;
use std::collections::{BTreeSet, VecDeque};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, State};
use tokio::sync::{mpsc, oneshot};

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

/// A SoundCloud song link, named by its oEmbed, then its YouTube version (one search, two at most). None: not one (a
/// YouTube link, for `add_link`).
pub async fn song_link(state: &AppState, url: &str) -> CmdResult<Option<Track>> {
    if !soundcloud::is_soundcloud(url) {
        return Ok(None);
    }
    let named = soundcloud::song(soundcloud::OEMBED, soundcloud::SHORT, url).await.map_err(err)?;
    // None: Google refused the search. Said like any refusal, never routed around.
    let answer = youtube_version(state, &named).await.ok_or("YouTube: Too Many Requests")?;
    if !has_version(&answer.song) {
        return Err("This song wasn't found on YouTube: nothing to play it from".into());
    }
    Ok(Some(answer.song))
}

/// One import at a time (the stop flag is shared).
static BUSY: AtomicBool = AtomicBool::new(false);
static STOP: AtomicBool = AtomicBool::new(false);

/// An import is searching: nothing else asks YouTube Music meanwhile (Discord's artist pictures).
pub fn importing() -> bool {
    BUSY.load(Ordering::Acquire)
}

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

/// A match an import made that its length doesn't back (`matching::doubtful`): the song with the video picked, and the
/// choice (that video first, then other YouTube results). Event `import-doubt`.
#[derive(Clone, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct ImportDoubt {
    pub song: Track,
    pub candidates: Vec<Track>,
}

/// One step of a search.
pub struct Searched<'a> {
    pub done: usize,
    /// Of those, the ones with a YouTube version.
    pub found: usize,
    pub song: Option<&'a Track>,
    /// YouTube refused: seconds before the searches go on. 0: they're running.
    pub wait_secs: u32,
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
/// again, or sharing songs with another, takes seconds. One search at a time, spaced (`Pace`): a song refused goes back in
/// line. Songs not found lately are left alone. `progress`: after each song. None: stopped.
pub async fn find_on_youtube(app: &tauri::AppHandle, tracks: &[Track], progress: impl Fn(Searched)) -> Result<Option<Found>, String> {
    let state = app.state::<AppState>();
    let mut out = tracks.to_vec();
    fill_known(&state, &mut out);
    let todo = (0..out.len()).filter(|&i| !has_version(&out[i]) && !state.lib().not_found_lately(&out[i]).unwrap_or(false)).collect();
    search(app, out, todo, progress).await
}

/// Where the answer to a song the player wants goes: the song as searched, None when YouTube refused.
type Reply = oneshot::Sender<Option<Track>>;

/// The running search's door for the songs the player wants now (`find_now`). None: no import is searching.
static WANTED: Mutex<Option<mpsc::UnboundedSender<(Track, Reply)>>> = Mutex::new(None);

/// Shuts that door on every way out of a search.
struct Door;

impl Drop for Door {
    fn drop(&mut self) {
        *WANTED.lock().unwrap() = None;
    }
}

/// A list of an import there at once (Against Liner 13): saved with the versions the library knows, then its unknown
/// songs searched, each answer written to the library as it comes. None: stopped (the list stays).
pub async fn save_then_find(app: &tauri::AppHandle, read: &[Track], save: impl FnOnce(&[Track]) -> anyhow::Result<i64>, progress: impl Fn(Searched)) -> Result<Option<(i64, Found)>, String> {
    let state = app.state::<AppState>();
    let mut known = read.to_vec();
    fill_known(&state, &mut known);
    let id = save(&known).map_err(err)?;
    let step = |step: Searched| {
        if let Some(song) = step.song {
            note_search(&state, song);
        }
        progress(step);
    };
    Ok(find_on_youtube(app, &known, step).await?.map(|found| (id, found)))
}

/// `out[todo]` searched, whatever was said of them before. A song the player wants meanwhile goes first (Against Liner
/// 13): the same pace, so no quicker, and no second search of it later.
async fn search(app: &tauri::AppHandle, mut out: Vec<Track>, todo: Vec<usize>, progress: impl Fn(Searched)) -> Result<Option<Found>, String> {
    let mut done = out.len() - todo.len();
    let mut found = out.iter().filter(|t| has_version(t)).count();
    progress(Searched { done, found, song: out.iter().rfind(|t| has_version(t)), wait_secs: 0 });
    let mut line = Line::new(&out, todo);
    let mut pace = Pace::default();
    let mut running = tokio::task::JoinSet::new();
    let (door, mut wanted) = mpsc::unbounded_channel();
    *WANTED.lock().unwrap() = Some(door);
    let _door = Door;
    // The player's asks: songs of this line by place, others (one search each, before the line) in order.
    let mut owed: Vec<(usize, Reply)> = Vec::new();
    let mut asked: VecDeque<(Track, Reply)> = VecDeque::new();
    let mut asking: Option<Reply> = None;
    let mut searching = None;
    loop {
        if stopped() {
            return Ok(None);
        }
        let now = Instant::now();
        if pace.gave_up(now) {
            break;
        }
        while let Ok((song, reply)) = wanted.try_recv() {
            let said = match out.iter().position(|t| same_track(t, &song)) {
                Some(i) if line.is_settled(i) => Some(out[i].clone()),
                // Never around a refusal: not now.
                _ if !pace.wait_left(now).is_zero() => None,
                Some(i) if searching == Some(i) || line.first(i) => {
                    owed.push((i, reply));
                    continue;
                }
                _ => {
                    asked.push_back((song, reply));
                    continue;
                }
            };
            let _ = reply.send(said);
        }
        if running.is_empty() && pace.ready(now) {
            let next = match asked.pop_front() {
                Some((song, reply)) => Some((None, song, Some(reply))),
                None => line.pop().map(|i| (Some(i), out[i].clone(), None)),
            };
            if let Some((i, song, reply)) = next {
                pace.started(now);
                (searching, asking) = (i, reply);
                let app = app.clone();
                running.spawn(async move { (i, youtube_version(&app.state::<AppState>(), &song).await) });
            }
        }
        let Some(ended) = running.join_next().await else {
            if line.left() == 0 && asked.is_empty() {
                break;
            }
            tokio::time::sleep(WAITING).await;
            continue;
        };
        searching = None;
        let (i, answer) = ended.map_err(err)?;
        let wait_secs = |pace: &Pace| pace.wait_left(Instant::now()).as_secs_f32().ceil() as u32;
        let Some(answer) = answer else {
            pace.refused(Instant::now());
            if let Some(i) = i {
                line.again(i);
            }
            // The player waits for none of them: the import goes on after the wait.
            for reply in asking.take().into_iter().chain(owed.drain(..).map(|(_, r)| r)).chain(asked.drain(..).map(|(_, r)| r)) {
                let _ = reply.send(None);
            }
            progress(Searched { done, found, song: None, wait_secs: wait_secs(&pace) });
            continue;
        };
        pace.answered(Instant::now());
        // A doubtful match: the import screen offers it to check (Against Liner 9), the song as the import has it.
        if i.is_some() && !answer.doubt.is_empty() {
            let _ = app.emit("import-doubt", ImportDoubt { song: answer.song.clone(), candidates: answer.doubt });
        }
        if let Some(reply) = asking.take() {
            let _ = reply.send(Some(answer.song.clone()));
        }
        let own = i.filter(|&i| line.settle(i)).map(|i| (i, answer.song));
        let others = line.also_found(&out, &answer.seen);
        for (at, song) in own.into_iter().chain(others) {
            out[at] = song;
            done += 1;
            found += usize::from(has_version(&out[at]));
            for (_, reply) in owed.extract_if(.., |(j, _)| *j == at) {
                let _ = reply.send(Some(out[at].clone()));
            }
            progress(Searched { done, found, song: Some(&out[at]), wait_secs: wait_secs(&pace) });
        }
    }
    if pace.refusals > 0 {
        crate::diag::warn("import", "YouTube refused searches", &format!("{} refused, {done} answered", pace.refusals));
    }
    // Gave up on YouTube's refusals: so does the player.
    for reply in owed.into_iter().map(|(_, r)| r).chain(asked.into_iter().map(|(_, r)| r)) {
        let _ = reply.send(None);
    }
    Ok((!stopped()).then_some(Found { tracks: out, unsearched: line.left() + running.len() }))
}

/// A song of the library with no way to play yet, wanted now by the player (Against Liner 13): its YouTube version looked
/// up first, at the imports' pace. The running import searches it next; else one search of its own (the rooms' pace).
/// Never around a refusal. True: found, the library has it; false: not found, marked so.
#[tauri::command]
pub async fn find_now(app: tauri::AppHandle, state: State<'_, AppState>, track_id: i64) -> CmdResult<bool> {
    let Some(mut song) = state.lib().track(track_id).map_err(err)?.map(|t| t.track) else { return Ok(false) };
    if has_version(&song) {
        return Ok(true);
    }
    if state.lib().not_found_lately(&song).unwrap_or(false) {
        return Ok(false);
    }
    let (tx, rx) = oneshot::channel();
    let sent = WANTED.lock().unwrap().as_ref().is_some_and(|door| door.send((song.clone(), tx)).is_ok());
    let answer = match if sent { rx.await.ok() } else { None } {
        Some(answer) => answer,
        // No import searching, or it ended meanwhile (done, or canceled): a search of its own.
        None => alone(&app, &song).await,
    };
    let answer = answer.ok_or("YouTube: Too Many Requests")?;
    // On this song's own row: the import's copy may carry other ids.
    if let Some(video) = answer.ids.get(&Source::Youtube) {
        song.ids.insert(Source::Youtube, video.clone());
    }
    note_search(&state, &song);
    Ok(has_version(&song))
}

/// One search outside an import, paced with the rooms' (one at a time, spaced). None: refused, or YouTube's wait under
/// way.
async fn alone(app: &tauri::AppHandle, song: &Track) -> Option<Track> {
    let rooms = app.state::<crate::rooms::Rooms>();
    let mut pace = rooms.pace.lock().await;
    while !pace.ready(Instant::now()) {
        if !pace.wait_left(Instant::now()).is_zero() {
            return None;
        }
        tokio::time::sleep(WAITING).await;
    }
    pace.started(Instant::now());
    let answer = youtube_version(&app.state::<AppState>(), song).await;
    if answer.is_some() { pace.answered(Instant::now()) } else { pace.refused(Instant::now()) }
    answer.map(|a| a.song)
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
        let progress = SpotifyProgress { name: String::new(), list: 1, lists: 1, matching: true, done: step.done, total: to_search, all_done: step.done, all_total: to_search, playable: step.found, searched: step.done, to_search, wait_secs: step.wait_secs, song: step.song.map(SpotifySong::from) };
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
