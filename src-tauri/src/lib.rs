mod art;
mod discord;
mod media;
mod secrets;
#[cfg(windows)]
mod shield;
mod spotify_web;
mod tray;
mod update;
mod window_bg;
mod window_place;
mod ytm;

use music_connectors::oauth::Opener;
use music_connectors::spotify::Spotify;
use music_connectors::ytmusic::{Account, ListRef, Shelf, YouTubeMusic};
use music_core::cache::{Memo, Stats, Ttl};
use music_core::history::{Play, Pref};
use music_core::library::{Library, LibraryPlaylist, LibraryTrack, PlaylistEdit};
use music_core::matching::{merge_tracks, same_track};
use music_core::model::{Connector, SecretStore, Source, Track};
use music_core::share::{self, Item, Shared};
use music_core::sync::{SyncReport, sync};
use music_player::{Command, Player, Status};
use music_shield::Shield;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Response;
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;

/// Errors cross IPC as plain strings (full anyhow chain).
type CmdResult<T> = Result<T, String>;

fn err(e: impl Into<anyhow::Error>) -> String {
    format!("{:#}", e.into())
}

/// Spotify app key (Spotify has no keyless sign-in). Stored in OS keychain.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Credentials {
    spotify_client_id: Option<String>,
}

impl Credentials {
    /// Trust boundary: trim, drop blanks, keep known fields only.
    fn merged_with(mut self, new: Credentials) -> Self {
        let clean = |v: Option<String>| v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        self.spotify_client_id = clean(new.spotify_client_id).or(self.spotify_client_id);
        self
    }
}

struct AppState {
    app: tauri::AppHandle,
    lib: Mutex<Library>,
    store: Arc<dyn SecretStore>,
    open: Opener,
    player: Player,
    shield: Arc<Shield>,
    /// Cover art / avatar cache behind the `art` URI scheme.
    art: music_connectors::art::ArtCache,
    /// Answers kept until the data under them changes.
    cache: Caches,
    /// Current nearby offer, polled by the UI.
    nearby: Arc<Mutex<NearbyState>>,
    nearby_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    /// Windows media panel and keys. None if the OS refused it.
    media: Option<media::Media>,
    /// Track last shown there (title, artist, id).
    media_last: Mutex<Option<String>>,
    /// Notification area icon. None if it couldn't be created.
    tray: Option<tray::Tray>,
    /// Discord Rich Presence add-on (idle until turned on).
    discord: discord::Discord,
}

impl AppState {
    fn credentials(&self) -> Credentials {
        self.store.load("credentials").unwrap_or_default()
    }

    fn spotify(&self) -> Option<Spotify> {
        let id = self.credentials().spotify_client_id?;
        Some(Spotify::new(&id, self.store.clone(), self.open.clone()))
    }

    /// Accounts picked in Settings › Accounts (empty = main account only).
    fn ytm_picked(&self) -> Vec<Account> {
        self.lib.lock().unwrap().setting("ytm_accounts").ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
    }

    /// YouTube Music, one connector per picked account. Empty = signed out. Async callers only (WebView2 cookies).
    fn ytm_all(&self) -> Vec<YouTubeMusic> {
        let Some(cookie) = ytm::session(&self.app) else { return Vec::new() };
        let picked = self.ytm_picked();
        if picked.is_empty() {
            return YouTubeMusic::new(&cookie).into_iter().collect();
        }
        picked.iter().filter_map(|a| YouTubeMusic::new(&cookie).ok().map(|y| y.as_account(a))).collect()
    }

    /// First picked account: search, export.
    fn ytm(&self) -> Option<YouTubeMusic> {
        self.ytm_all().into_iter().next()
    }

    fn connector(&self, source: Source) -> Option<Box<dyn Connector>> {
        match source {
            Source::Spotify => self.spotify().map(|c| Box::new(c) as _),
            Source::Youtube | Source::Local | Source::Apple => None,
        }
    }
}

/// Answers kept until the data under them changes (music_core::cache): library reads stamped with the library
/// version, history reads with the history version, network answers for a while.
struct Caches {
    library: Memo<(), u64>,
    playlist: Memo<i64, u64>,
    orders: Memo<(), u64>,
    stats: Memo<(), u64>,
    /// Key: UTC offset. Stamp: library and history versions, day (seed), local hour (time-of-day mix).
    mixes: Memo<i64, (u64, u64, u64, i64)>,
    youtube: Ttl<Vec<Track>>,
    apple: Ttl<Vec<Track>>,
    /// Sign-in state: keychain and WebView2 cookies, read on every refresh otherwise.
    status: Ttl<Vec<(Source, SourceStatus)>>,
    /// YouTube Music home shelves, and the songs of the playlists / radios opened from them.
    home: Ttl<Vec<Shelf>>,
    lists: Ttl<Vec<Track>>,
}

impl Default for Caches {
    fn default() -> Self {
        Self {
            library: Memo::new(1),
            playlist: Memo::new(32),
            orders: Memo::new(1),
            stats: Memo::new(1),
            mixes: Memo::new(4),
            youtube: Ttl::new(Duration::from_secs(30 * 60), 300),
            apple: Ttl::new(Duration::from_secs(30 * 60), 100),
            status: Ttl::new(Duration::from_secs(30), 1),
            home: Ttl::new(Duration::from_secs(15 * 60), 1),
            lists: Ttl::new(Duration::from_secs(15 * 60), 30),
        }
    }
}

/// Cached JSON straight to the UI: no second serialization.
fn json(answer: Arc<str>) -> Response {
    Response::new(answer.to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SourceStatus {
    configured: bool,
    connected: bool,
}

#[tauri::command]
async fn sources_status(state: State<'_, AppState>) -> CmdResult<Vec<(Source, SourceStatus)>> {
    if let Some(known) = state.cache.status.get("") {
        return Ok((*known).clone());
    }
    let spotify = state.spotify();
    let youtube = ytm::session(&state.app).is_some();
    let status = vec![
        (Source::Spotify, SourceStatus { configured: spotify.is_some(), connected: spotify.is_some_and(|c| c.is_connected()) }),
        (Source::Youtube, SourceStatus { configured: youtube, connected: youtube }),
    ];
    Ok((*state.cache.status.put("", status)).clone())
}

#[tauri::command]
async fn connect(state: State<'_, AppState>, source: Source, credentials: Credentials) -> CmdResult<()> {
    let merged = state.credentials().merged_with(credentials);
    state.store.save("credentials", &merged).map_err(err)?;
    state.cache.status.clear();
    let c = state.connector(source).ok_or("Missing credentials")?;
    c.connect().await.map_err(err)
}

#[tauri::command]
fn disconnect(state: State<AppState>, source: Source) -> CmdResult<()> {
    state.cache.status.clear();
    state.connector(source).map_or(Ok(()), |c| c.disconnect()).map_err(err)
}

#[tauri::command]
async fn sync_all(state: State<'_, AppState>) -> CmdResult<SyncReport> {
    let (spotify, youtube) = (state.spotify(), state.ytm_all());
    let mut all: Vec<&dyn Connector> = Vec::new();
    all.extend(spotify.as_ref().map(|c| c as &dyn Connector));
    all.extend(youtube.iter().map(|c| c as &dyn Connector));
    Ok(sync(&state.lib, &all, spotify.as_ref().map(|c| c as &dyn Connector)).await)
}

#[derive(Serialize)]
struct LibraryData {
    tracks: Vec<LibraryTrack>,
    playlists: Vec<LibraryPlaylist>,
}

#[tauri::command]
fn library(state: State<AppState>) -> CmdResult<Response> {
    // Lock held while computing: no write can slip between the version read and the answer.
    let lib = state.lib.lock().unwrap();
    let answer = state.cache.library.get_or((), lib.versions.library(), || serde_json::to_string(&LibraryData { tracks: lib.tracks().map_err(err)?, playlists: lib.playlists().map_err(err)? }).map_err(err))?;
    Ok(json(answer))
}

#[tauri::command]
fn playlist_tracks(state: State<AppState>, id: i64) -> CmdResult<Response> {
    let lib = state.lib.lock().unwrap();
    let answer = state.cache.playlist.get_or(id, lib.versions.library(), || serde_json::to_string(&lib.playlist_tracks(id).map_err(err)?).map_err(err))?;
    Ok(json(answer))
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

/// UTC day number (mix seed).
fn today() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() / 86_400)
}

/// YouTube Music song search, cached for the session. None = signed out.
async fn yt_search(state: &AppState, query: &str) -> Option<Result<Vec<Track>, String>> {
    let key = query.trim().to_lowercase();
    if let Some(hit) = state.cache.youtube.get(&key) {
        return Some(Ok((*hit).clone()));
    }
    let yt = state.ytm()?;
    let res = yt.search_songs(query).await.map_err(err);
    if let Ok(found) = &res {
        state.cache.youtube.put(&key, found.clone());
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
    let apple_key = format!("{country}:{}", query.to_lowercase());
    let known = state.cache.apple.get(&apple_key);
    let apple = tauri::async_runtime::spawn({
        let q = query.clone();
        async move {
            match known {
                Some(hit) => Ok((*hit).clone()),
                None => music_connectors::itunes::search(music_connectors::itunes::API, &q, &country).await,
            }
        }
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
        Ok(found) => {
            state.cache.apple.put(&apple_key, found.clone());
            found
        }
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
    Ok(SearchResults { hits, errors })
}

/// No YouTube id yet: try to find one (1 search) so the track plays in full.
async fn with_youtube(state: &AppState, track: Track) -> Track {
    if !track.ids.contains_key(&Source::Youtube)
        && let Some(Ok(found)) = yt_search(state, &format!("{} {}", track.artist, track.title)).await
        && let Some(hit) = music_core::matching::best_match(&track, &found)
    {
        return merge_tracks(&track, hit);
    }
    track
}

/// Add search hit, with its YouTube version when one exists.
#[tauri::command]
async fn add_track(state: State<'_, AppState>, track: Track) -> CmdResult<i64> {
    // Trust boundary: catalog ids only, bounded text.
    let ok_text = |s: &str| !s.trim().is_empty() && s.chars().count() <= 300;
    if !ok_text(&track.title) || !ok_text(&track.artist) || track.ids.is_empty() || track.ids.iter().any(|(s, id)| *s == Source::Local || id.is_empty() || id.len() > 64) {
        return Err("Invalid title".into());
    }
    let track = Track { art: track.art.filter(|a| a.len() <= 500 && a.starts_with("https://")), ..track };
    let track = with_youtube(&state, track).await;
    state.lib.lock().unwrap().upsert_track(&track).map_err(err)
}

/// Apple tracks with no real cover: one batched lookup. Returns tracks given a cover.
#[tauri::command]
async fn backfill_art(state: State<'_, AppState>, country: String) -> CmdResult<usize> {
    use music_connectors::itunes;
    let ids: Vec<u64> = {
        let tracks = state.lib.lock().unwrap().tracks().map_err(err)?;
        tracks.into_iter().filter(|t| t.track.art.as_deref().is_none_or(music_core::model::video_frame)).filter_map(|t| t.track.ids.get(&Source::Apple)?.parse().ok()).collect()
    };
    if ids.is_empty() {
        return Ok(0);
    }
    let found: Vec<Track> = itunes::lookup(itunes::LOOKUP, &ids, &store(&country)).await.map_err(err)?.into_iter().filter(|t| t.art.is_some()).collect();
    let lib = state.lib.lock().unwrap();
    for t in &found {
        lib.upsert_track(t).map_err(err)?;
    }
    Ok(found.len())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FindReport {
    /// Tracks that got a YouTube version.
    found: usize,
    /// Tracks still without full playback (no match).
    missing: usize,
}

/// Searches per "Find versions" run: polite to YouTube Music.
const FIND_MAX: usize = 150;

/// "Find versions": YouTube match for tracks with no full source (Apple / Spotify only). 1 search each, cached.
#[tauri::command]
async fn find_versions(state: State<'_, AppState>, ids: Vec<i64>) -> CmdResult<FindReport> {
    let todo: Vec<Track> = {
        let lib = state.lib.lock().unwrap();
        let tracks = lib.tracks().map_err(err)?;
        tracks.into_iter().filter(|t| ids.contains(&t.id) && !t.track.ids.contains_key(&Source::Youtube) && !t.track.ids.contains_key(&Source::Local)).map(|t| t.track).take(FIND_MAX).collect()
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
    Ok(FindReport { found, missing: todo.len() - found })
}

/// Video whose owner turned embedding off (error 101 / 150): other uploads of the same song, best first, at most 5.
/// Never the blocked ones (`exclude`). Empty = nothing else plays it.
#[tauri::command]
async fn alternative_videos(state: State<'_, AppState>, track_id: i64, exclude: Vec<String>) -> CmdResult<Vec<String>> {
    let t = state.lib.lock().unwrap().tracks().map_err(err)?.into_iter().find(|t| t.id == track_id).ok_or("Track not found")?.track;
    let yt = state.ytm().ok_or("Sign in to YouTube Music first (Settings › Accounts)")?;
    let mut out: Vec<String> = Vec::new();
    // Official song first, then uploads of it.
    let songs = yt.search_songs(&format!("{} {}", t.artist, t.title)).await.unwrap_or_default();
    let videos = yt.search_videos(&t.title).await.unwrap_or_default();
    for c in songs.iter().chain(&videos) {
        let Some(v) = c.ids.get(&Source::Youtube) else { continue };
        if !exclude.contains(v) && !out.contains(v) && music_core::matching::same_song_upload(&t, c) {
            out.push(v.clone());
        }
    }
    out.truncate(5);
    Ok(out)
}

/// Apple 30 s preview into the local engine. Returns store page (shown as "Listen on Apple Music").
#[tauri::command]
async fn play_preview(state: State<'_, AppState>, id: String, country: String) -> CmdResult<String> {
    let p = music_connectors::itunes::preview(music_connectors::itunes::LOOKUP, &id, &store(&country)).await.map_err(err)?;
    let bytes = music_connectors::itunes::preview_audio(&p).await.map_err(err)?;
    state.player.send(Command::PlayMemory { label: format!("apple:{id}").into(), bytes: bytes.into() });
    Ok(p.page)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShareCode {
    /// `musicapp://playlist/…`, for messages.
    link: String,
    /// QR modules: size, row-major "0"/"1". None = too big for a QR code.
    qr: Option<(usize, String)>,
    tracks: usize,
    bytes: usize,
}

fn shared_playlist(lib: &Library, id: i64) -> CmdResult<Shared> {
    let name = lib.playlists().map_err(err)?.into_iter().find(|p| p.id == id).ok_or("Playlist not found")?.name;
    let items = lib.playlist_tracks(id).map_err(err)?.iter().map(|t| Item::from_track(&t.track)).collect();
    Ok(Shared { name, items })
}

#[tauri::command]
fn share_playlist(state: State<AppState>, id: i64) -> CmdResult<ShareCode> {
    let shared = shared_playlist(&state.lib.lock().unwrap(), id)?;
    let qr = share::qr_modules(&share::to_qr_text(&shared)).map(|(size, dark)| (size, dark.iter().map(|&d| if d { '1' } else { '0' }).collect()));
    Ok(ShareCode { link: share::to_link(&shared), qr, tracks: shared.items.len(), bytes: share::encode(&shared).len() })
}

#[derive(Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
enum NearbyState {
    Idle,
    Waiting { code: String },
    Sent,
    Failed { error: String },
}

/// Offer a playlist on the local network. Returns the 6-digit code to read out.
#[tauri::command]
fn nearby_send(state: State<AppState>, id: i64) -> CmdResult<String> {
    let payload = share::encode(&shared_playlist(&state.lib.lock().unwrap(), id)?);
    let code = music_connectors::nearby::new_code();
    nearby_stop(state.clone());
    *state.nearby.lock().unwrap() = NearbyState::Waiting { code: code.clone() };
    let (status, c) = (state.nearby.clone(), code.clone());
    let task = tauri::async_runtime::spawn(async move {
        let done = music_connectors::nearby::serve(&c, &payload).await;
        *status.lock().unwrap() = match done {
            Ok(()) => NearbyState::Sent,
            Err(e) => NearbyState::Failed { error: err(e) },
        };
    });
    *state.nearby_task.lock().unwrap() = Some(task);
    Ok(code)
}

#[tauri::command]
fn nearby_status(state: State<AppState>) -> NearbyState {
    state.nearby.lock().unwrap().clone()
}

/// Withdraws the offer (mDNS announce and listener dropped with the task).
#[tauri::command]
fn nearby_stop(state: State<AppState>) {
    if let Some(task) = state.nearby_task.lock().unwrap().take() {
        task.abort();
    }
    *state.nearby.lock().unwrap() = NearbyState::Idle;
}

/// 6-digit code → share link for the import dialog.
#[tauri::command]
async fn nearby_receive(code: String) -> CmdResult<String> {
    let code: String = code.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = music_connectors::nearby::receive(&code).await.map_err(err)?;
    Ok(share::to_link(&share::decode(&bytes).map_err(err)?))
}

/// Library probe for a shared entry: by id, or by title + artist.
fn probe(item: &Item) -> Track {
    match item {
        Item::Youtube(id) => Track { ids: [(Source::Youtube, id.clone())].into(), ..Default::default() },
        Item::Apple(n) => Track { ids: [(Source::Apple, n.to_string())].into(), ..Default::default() },
        Item::Text { artist, title } => Track { artist: artist.clone(), title: title.clone(), ..Default::default() },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SharePreview {
    name: String,
    tracks: usize,
    /// Already in this library.
    known: usize,
}

#[tauri::command]
fn share_preview(state: State<AppState>, code: String) -> CmdResult<SharePreview> {
    let shared = share::parse(&code).map_err(err)?;
    let lib = state.lib.lock().unwrap();
    let known = shared.items.iter().map(|i| lib.find(&probe(i))).collect::<anyhow::Result<Vec<_>>>().map_err(err)?.iter().flatten().count();
    Ok(SharePreview { name: shared.name, tracks: shared.items.len(), known })
}

/// QR code from a dropped screenshot or photo → share text.
#[tauri::command]
async fn share_read_image(path: String) -> CmdResult<String> {
    // Trust boundary: absolute PNG / JPEG path from drop event.
    let p = PathBuf::from(&path);
    let ok = p.is_absolute() && p.extension().and_then(|e| e.to_str()).is_some_and(|e| ["png", "jpg", "jpeg"].contains(&e.to_lowercase().as_str()));
    if !ok {
        return Err("PNG or JPEG image expected".into());
    }
    tauri::async_runtime::spawn_blocking(move || share::read_qr(&p)).await.map_err(err)?.map_err(err)
}

/// Artist + title only (Spotify / local on sender side): Apple catalog, then YouTube within budget.
async fn resolve_text(state: &AppState, artist: &str, title: &str, country: &str) -> Option<Track> {
    let want = Track { artist: artist.into(), title: title.into(), ..Default::default() };
    let query = format!("{artist} {title}");
    if let Ok(hits) = music_connectors::itunes::search(music_connectors::itunes::API, &query, country).await
        && let Some(t) = music_core::matching::best_match(&want, &hits)
    {
        return Some(t.clone());
    }
    let hits = yt_search(state, &query).await?.ok()?;
    music_core::matching::best_match(&want, &hits).cloned()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportReport {
    playlist_id: i64,
    added: usize,
    missing: usize,
}

/// Shared playlist → new custom playlist. Known tracks reused, others looked up (YouTube oEmbed, Apple lookup, catalog search).
#[tauri::command]
async fn share_import(state: State<'_, AppState>, code: String, country: String) -> CmdResult<ImportReport> {
    use music_connectors::{itunes, youtube};
    let shared = share::parse(&code).map_err(err)?;
    let country = store(&country);
    let mut ids: Vec<Option<i64>> = {
        let lib = state.lib.lock().unwrap();
        shared.items.iter().map(|i| lib.find(&probe(i))).collect::<anyhow::Result<_>>().map_err(err)?
    };

    // Apple: one batched lookup.
    let apple: Vec<u64> = shared.items.iter().zip(&ids).filter_map(|(item, id)| if let (Item::Apple(n), None) = (item, id) { Some(*n) } else { None }).collect();
    let apple_found = if apple.is_empty() { Vec::new() } else { itunes::lookup(itunes::LOOKUP, &apple, &country).await.unwrap_or_default() };
    // YouTube: keyless oEmbed per video, 8 at a time.
    let yt: Vec<(usize, String)> = shared.items.iter().zip(&ids).enumerate().filter_map(|(i, (item, id))| if let (Item::Youtube(v), None) = (item, id) { Some((i, v.clone())) } else { None }).collect();
    let mut yt_found: HashMap<usize, Track> = HashMap::new();
    for chunk in yt.chunks(8) {
        let jobs: Vec<_> = chunk.iter().cloned().map(|(i, v)| tauri::async_runtime::spawn(async move { (i, youtube::track_from_link(&format!("https://youtu.be/{v}"), youtube::OEMBED).await) })).collect();
        for job in jobs {
            if let Ok((i, Ok(t))) = job.await {
                yt_found.insert(i, t);
            }
        }
    }

    for (i, item) in shared.items.iter().enumerate() {
        if ids[i].is_some() {
            continue;
        }
        let track = match item {
            Item::Youtube(_) => yt_found.remove(&i),
            Item::Apple(n) => apple_found.iter().find(|t| t.ids.get(&Source::Apple) == Some(&n.to_string())).cloned(),
            Item::Text { artist, title } => resolve_text(&state, artist, title, &country).await,
        };
        if let Some(t) = track {
            ids[i] = Some(state.lib.lock().unwrap().upsert_track(&t).map_err(err)?);
        }
    }

    let found: Vec<i64> = ids.iter().flatten().copied().collect();
    let name = if shared.name.trim().is_empty() { "Shared playlist".to_string() } else { shared.name };
    let lib = state.lib.lock().unwrap();
    let playlist_id = lib.edit_playlist(PlaylistEdit::Create { name }).map_err(err)?.ok_or("Playlist not created")?;
    lib.edit_playlist(PlaylistEdit::Add { id: playlist_id, track_ids: found.clone() }).map_err(err)?;
    Ok(ImportReport { playlist_id, added: found.len(), missing: ids.len() - found.len() })
}

fn unix_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

#[tauri::command]
fn record_play(state: State<AppState>, play: Play) -> CmdResult<()> {
    // Trust boundary: plausible times only (no future plays skewing scores).
    let now = unix_now();
    if !(0..=now + 60).contains(&play.started_at) || play.listened_ms > 24 * 3600 * 1000 {
        return Err("Invalid play".into());
    }
    state.lib.lock().unwrap().record_play(&play).map_err(err)
}

/// Mixes for today. `utc_offset` = local minus UTC, seconds (from the UI clock).
#[tauri::command]
fn mixes(state: State<AppState>, utc_offset: i64) -> CmdResult<Response> {
    let utc_offset = utc_offset.clamp(-14 * 3600, 14 * 3600);
    let now = unix_now();
    let lib = state.lib.lock().unwrap();
    // Same data, same day, same hour: same mixes.
    let stamp = (lib.versions.library(), lib.versions.history(), today(), (now + utc_offset).div_euclid(3600));
    let answer = state.cache.mixes.get_or(utc_offset, stamp, || {
        let (tracks, plays, playlists, saved, prefs) = (lib.tracks().map_err(err)?, lib.plays().map_err(err)?, lib.custom_playlists().map_err(err)?, lib.saved_playlists().map_err(err)?, lib.prefs().map_err(err)?);
        let input = music_core::mixes::Input { tracks: &tracks, plays: &plays, playlists: &playlists, saved: &saved, prefs: &prefs, now, utc_offset, seed: today() };
        serde_json::to_string(&music_core::mixes::mixes(&input)).map_err(err)
    })?;
    Ok(json(answer))
}

/// None clears it.
#[tauri::command]
fn set_track_pref(state: State<AppState>, track_id: i64, pref: Option<Pref>) -> CmdResult<()> {
    state.lib.lock().unwrap().set_pref(track_id, pref).map_err(err)
}

#[tauri::command]
fn clear_history(state: State<AppState>) -> CmdResult<()> {
    state.lib.lock().unwrap().clear_history().map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportReport {
    url: String,
    added: usize,
    /// Already in the YouTube playlist (earlier export).
    already: usize,
    /// Tracks with no YouTube version (Find full versions can fix that).
    no_youtube: usize,
}

/// Playlist → private YouTube playlist. Same playlist exported again = same YouTube playlist, only missing videos added.
#[tauri::command]
async fn export_youtube(state: State<'_, AppState>, id: i64) -> CmdResult<ExportReport> {
    let yt = state.ytm().ok_or("Sign in to YouTube Music first (Settings › Accounts)")?;
    let key = format!("ytm_export_{id}");
    let (name, videos, no_youtube, existing) = {
        let lib = state.lib.lock().unwrap();
        let p = lib.playlists().map_err(err)?.into_iter().find(|p| p.id == id).ok_or("Playlist not found")?;
        if p.source == Source::Youtube && !p.custom {
            return Err("Already a YouTube playlist".into());
        }
        let tracks = lib.playlist_tracks(id).map_err(err)?;
        let mut seen = HashSet::new();
        let videos: Vec<String> = tracks.iter().filter_map(|t| t.track.ids.get(&Source::Youtube).cloned()).filter(|v| seen.insert(v.clone())).collect();
        let no_youtube = tracks.iter().filter(|t| !t.track.ids.contains_key(&Source::Youtube)).count();
        (p.name, videos, no_youtube, lib.setting(&key).ok().flatten().and_then(|v| v.as_str().map(String::from)))
    };
    let url = |remote: &str| format!("https://music.youtube.com/playlist?list={remote}");
    // Exported before: add what's missing. Playlist deleted on YouTube (or any error): make a new one.
    if let Some(remote) = existing
        && let Ok(have) = yt.playlist_videos(&remote).await
    {
        let have: HashSet<String> = have.into_iter().collect();
        let todo: Vec<String> = videos.iter().filter(|v| !have.contains(*v)).cloned().collect();
        if yt.add_videos(&remote, &todo).await.is_ok() {
            return Ok(ExportReport { url: url(&remote), added: todo.len(), already: videos.len() - todo.len(), no_youtube });
        }
    }
    let remote = yt.create_playlist(&name, &videos).await.map_err(err)?;
    state.lib.lock().unwrap().set_setting(&key, &serde_json::json!(remote)).map_err(err)?;
    Ok(ExportReport { url: url(&remote), added: videos.len(), already: 0, no_youtube })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AddReport {
    added: usize,
    /// Already in the playlist (YouTube refuses duplicates).
    already: usize,
    /// No YouTube version: can't go into a YouTube playlist.
    no_youtube: usize,
    /// YouTube's reason for the ones it refused, when others went in.
    refused: Option<String>,
}

/// Add to an imported YouTube Music playlist: on YouTube first (owner account accepts, others refuse), then the mirror.
/// Liked Music = like the songs with that account.
#[tauri::command]
async fn add_to_youtube(state: State<'_, AppState>, id: i64, track_ids: Vec<i64>) -> CmdResult<AddReport> {
    let (playlist, videos, there) = {
        let lib = state.lib.lock().unwrap();
        let p = lib.playlists().map_err(err)?.into_iter().find(|p| p.id == id).ok_or("Playlist not found")?;
        if p.source != Source::Youtube || p.custom {
            return Err("Not a YouTube Music playlist".into());
        }
        let tracks = lib.tracks().map_err(err)?;
        let videos: Vec<(i64, String)> = track_ids.iter().filter_map(|t| tracks.iter().find(|x| x.id == *t).and_then(|x| x.track.ids.get(&Source::Youtube).map(|v| (*t, v.clone())))).collect();
        let there: HashSet<String> = lib.playlist_tracks(id).map_err(err)?.into_iter().filter_map(|t| t.track.ids.get(&Source::Youtube).cloned()).collect();
        (p, videos, there)
    };
    let no_youtube = track_ids.len() - videos.len();
    // Already in the mirror: YouTube would refuse them anyway.
    let mut seen = HashSet::new();
    let (videos, dup): (Vec<_>, Vec<_>) = videos.into_iter().filter(|(_, v)| seen.insert(v.clone())).partition(|(_, v)| !there.contains(v));
    let mut report = AddReport { added: 0, already: dup.len(), no_youtube, refused: None };
    if videos.is_empty() {
        return Ok(report);
    }
    let ids: Vec<String> = videos.iter().map(|(_, v)| v.clone()).collect();
    let accounts = state.ytm_all();
    if accounts.is_empty() {
        return Err("Sign in to YouTube Music first (Settings › Accounts)".into());
    }
    let taken: HashSet<String> = if let Some(key) = playlist.source_id.strip_prefix("LM") {
        let key = key.strip_prefix('~').unwrap_or("0");
        let yt = accounts.into_iter().find(|y| y.account_key() == key).ok_or("That Google account isn't synced any more")?;
        yt.like(&ids).await.map_err(err)?;
        ids.iter().cloned().collect()
    } else {
        // Playlist id carries no account: try each, the owner takes it.
        let remote = playlist.source_id.split('~').next().unwrap_or(&playlist.source_id).to_string();
        let mut last = None;
        let mut done = None;
        for yt in accounts {
            match yt.add_videos(&remote, &ids).await {
                Ok(r) => {
                    done = Some(r);
                    break;
                }
                Err(e) => last = Some(err(e)),
            }
        }
        let Some(r) = done else {
            let why = last.unwrap_or_else(|| "YouTube Music refused".into());
            // YouTube said why: show that. Bare status: likely not the user's playlist.
            return Err(if why.starts_with("YouTube Music: ") { why } else { format!("{why}. Only playlists you own on YouTube Music can take new songs.") });
        };
        report.already += r.already.len();
        report.refused = r.refused;
        r.added.into_iter().collect()
    };
    let added: Vec<i64> = videos.iter().filter(|(_, v)| taken.contains(v)).map(|(t, _)| *t).collect();
    state.lib.lock().unwrap().append_to_imported(id, &added).map_err(err)?;
    report.added = added.len();
    Ok(report)
}

fn spotify_on(state: &AppState) -> CmdResult<Spotify> {
    state.spotify().filter(|s| s.is_connected()).ok_or_else(|| "Connect Spotify first (Settings › Sources)".into())
}

/// Spotify Connect remote: the user's own Spotify app plays.
#[tauri::command]
async fn spotify_player(state: State<'_, AppState>, cmd: music_connectors::spotify::PlayerCommand) -> CmdResult<()> {
    spotify_on(&state)?.command(cmd).await.map_err(err)
}

#[tauri::command]
async fn spotify_playback(state: State<'_, AppState>) -> CmdResult<Option<music_connectors::spotify::Playback>> {
    spotify_on(&state)?.playback().await.map_err(err)
}

/// Google sign-in window for YouTube Music (no keys). add = sign in one more Google account.
#[tauri::command]
async fn ytm_sign_in(app: tauri::AppHandle, add: bool) -> CmdResult<()> {
    ytm::open(&app, add).map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpotifyImport {
    playlist_id: i64,
    name: String,
    tracks: usize,
    /// Tracks with a YouTube version (they play in full).
    playable: usize,
}

/// Public Spotify playlist or album link → imported playlist, no account. Each track gets its YouTube version (playback).
#[tauri::command]
async fn import_spotify_link(state: State<'_, AppState>, url: String) -> CmdResult<SpotifyImport> {
    use music_connectors::spotify_embed;
    // Trust boundary: clipboard / typed text.
    if url.len() > 2048 {
        return Err("Link too long".into());
    }
    let list = spotify_embed::fetch(spotify_embed::EMBED, url.trim()).await.map_err(err)?;
    // Signed out of YouTube Music: tracks come in without a playable version.
    let yt = state.ytm().map(Arc::new);
    let mut tracks = Vec::with_capacity(list.tracks.len());
    // 6 searches at a time: quick, still polite.
    for chunk in list.tracks.chunks(6) {
        let jobs: Vec<_> = chunk
            .iter()
            .cloned()
            .map(|t| {
                let yt = yt.clone();
                tauri::async_runtime::spawn(async move {
                    let Some(yt) = yt else { return t };
                    match yt.search_songs(&format!("{} {}", t.artist, t.title)).await {
                        Ok(found) => music_core::matching::best_match(&t, &found).map_or_else(|| t.clone(), |hit| merge_tracks(&t, hit)),
                        Err(_) => t,
                    }
                })
            })
            .collect();
        for job in jobs {
            tracks.push(job.await.map_err(err)?);
        }
    }
    let playable = tracks.iter().filter(|t| t.ids.contains_key(&Source::Youtube)).count();
    // Same id as a keyed Spotify sync, so both update one playlist. Albums get their own prefix.
    let source_id = if list.kind == "album" { format!("album:{}", list.id) } else { list.id.clone() };
    let playlist_id = state.lib.lock().unwrap().save_playlist(Source::Spotify, &source_id, &list.name, &tracks).map_err(err)?;
    Ok(SpotifyImport { playlist_id, name: list.name, tracks: tracks.len(), playable })
}

/// Spotify's official web player in an app window (prototype, no keys).
#[tauri::command]
async fn spotify_web_open(app: tauri::AppHandle) -> CmdResult<()> {
    spotify_web::open(&app).map_err(err)
}

#[tauri::command]
async fn spotify_web_status(app: tauri::AppHandle) -> bool {
    spotify_web::signed_in(&app)
}

/// YouTube Music's home shelves (its recommendations for the first picked account). Empty when signed out.
#[tauri::command]
async fn ytm_home(state: State<'_, AppState>) -> CmdResult<Vec<Shelf>> {
    if let Some(hit) = state.cache.home.get("") {
        return Ok((*hit).clone());
    }
    let Some(yt) = state.ytm() else { return Ok(Vec::new()) };
    let shelves = yt.home().await.map_err(err)?;
    Ok((*state.cache.home.put("", shelves)).clone())
}

/// Songs of a home card's playlist, album or radio: played without importing it.
#[tauri::command]
async fn ytm_list(state: State<'_, AppState>, list: ListRef) -> CmdResult<Vec<Track>> {
    // Trust boundary: ids go into YouTube requests.
    if !list.valid() {
        return Err("Invalid list".into());
    }
    let key = list.key();
    if let Some(hit) = state.cache.lists.get(&key) {
        return Ok((*hit).clone());
    }
    let yt = state.ytm().ok_or("Sign in to YouTube Music first (Settings › Accounts)")?;
    let tracks = yt.list_tracks(&list).await.map_err(err)?;
    Ok((*state.cache.lists.put(&key, tracks)).clone())
}

/// Signs every Google account out of the app; library kept.
#[tauri::command]
async fn ytm_sign_out(state: State<'_, AppState>) -> CmdResult<()> {
    ytm::sign_out(&state.app).map_err(err)?;
    state.cache.youtube.clear();
    state.cache.home.clear();
    state.cache.status.clear();
    state.lib.lock().unwrap().set_setting("ytm_accounts", &serde_json::json!([])).map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct YtmAccounts {
    signed_in: bool,
    /// Every Google account and channel in the session.
    accounts: Vec<Account>,
    /// Keys of accounts synced into the library.
    picked: Vec<String>,
}

#[tauri::command]
async fn ytm_accounts(state: State<'_, AppState>) -> CmdResult<YtmAccounts> {
    let Some(cookie) = ytm::session(&state.app) else { return Ok(YtmAccounts { signed_in: false, accounts: Vec::new(), picked: Vec::new() }) };
    let accounts = YouTubeMusic::new(&cookie).map_err(err)?.accounts().await.map_err(err)?;
    let picked = state.ytm_picked();
    let picked = if picked.is_empty() { vec!["0".to_string()] } else { picked.iter().map(Account::key).collect() };
    Ok(YtmAccounts { signed_in: true, accounts, picked })
}

/// Accounts to sync (first one also gets exports).
#[tauri::command]
fn set_ytm_accounts(state: State<AppState>, accounts: Vec<Account>) -> CmdResult<()> {
    // Trust boundary: values end up in request headers.
    let ok = accounts.len() <= 20 && accounts.iter().all(|a| a.authuser < 10 && a.name.chars().count() <= 200 && a.page_id.as_ref().is_none_or(|p| p.len() <= 40 && p.bytes().all(|b| b.is_ascii_digit())) && a.photo.as_ref().is_none_or(|p| p.len() <= 500));
    if !ok {
        return Err("Invalid accounts".into());
    }
    state.cache.youtube.clear();
    state.cache.home.clear();
    state.lib.lock().unwrap().set_setting("ytm_accounts", &serde_json::json!(accounts)).map_err(err)
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

/// Track id → [listens, last start (unix s)]: Most played / Recently played sorts.
#[tauri::command]
fn play_stats(state: State<AppState>) -> CmdResult<Response> {
    let lib = state.lib.lock().unwrap();
    let answer = state.cache.stats.get_or((), lib.versions.history(), || serde_json::to_string(&lib.play_stats().map_err(err)?).map_err(err))?;
    Ok(json(answer))
}

/// Track ids of every playlist in order: covers (first song, grid of 4) are picked from them.
#[tauri::command]
fn playlist_orders(state: State<AppState>) -> CmdResult<Response> {
    let lib = state.lib.lock().unwrap();
    let answer = state.cache.orders.get_or((), lib.versions.library(), || serde_json::to_string(&lib.playlist_orders().map_err(err)?).map_err(err))?;
    Ok(json(answer))
}

/// Settings › About: version, last update, what the updater is doing.
#[tauri::command]
fn update_status(updater: State<update::Updater>) -> update::Status {
    updater.status()
}

/// Check now (Settings › About). Runs in the background; progress comes as `update` events.
#[tauri::command]
fn update_check(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move { app.state::<update::Updater>().check(&app).await });
}

/// Install the downloaded update: the app closes and starts again (UI asks when nothing plays, or the user does).
#[tauri::command]
fn update_install(app: tauri::AppHandle, updater: State<update::Updater>) -> CmdResult<()> {
    updater.install(&app)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheStats {
    library: Stats,
    playlists: Stats,
    mixes: Stats,
    stats: Stats,
    images: Stats,
}

/// Settings › About: how much the caches answer.
#[tauri::command]
fn cache_stats(state: State<AppState>) -> CacheStats {
    let c = &state.cache;
    CacheStats { library: c.library.stats(), playlists: c.playlist.stats(), mixes: c.mixes.stats(), stats: c.stats.stats(), images: state.art.stats() }
}

/// Cover saved where the user picked (save dialog). source = art scheme path (local/<id>, cover/<name> or a URL),
/// crop = what the big cover shows (video bars cut). Returns the file written (extension may change, see cover::export).
#[tauri::command]
async fn export_cover(app: tauri::AppHandle, source: String, crop: Option<music_core::cover::Crop>, path: String) -> CmdResult<String> {
    let path = std::path::PathBuf::from(path);
    music_core::cover::wanted(&path).map_err(err)?;
    let (bytes, _) = art::image(&app, &source).await.ok_or("Cover not available")?;
    let out = tauri::async_runtime::spawn_blocking(move || music_core::cover::export(&bytes, crop, &path)).await.map_err(err)?.map_err(err)?;
    Ok(out.to_string_lossy().into_owned())
}

/// Image picked for a playlist cover: copied into the app's covers folder. Returns its name (art scheme `cover/<name>`).
#[tauri::command]
fn save_cover(app: tauri::AppHandle, playlist_id: i64, path: String) -> CmdResult<String> {
    let bytes = std::fs::read(&path).map_err(err)?;
    if bytes.len() > 10 << 20 {
        return Err("Image too big (10 MB max)".into());
    }
    let ext = match bytes.as_slice() {
        [0x89, b'P', b'N', b'G', ..] => "png",
        [0xFF, 0xD8, 0xFF, ..] => "jpg",
        [b'G', b'I', b'F', ..] => "gif",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "webp",
        _ => return Err("Not a PNG, JPEG, WebP or GIF image".into()),
    };
    let dir = art::covers_dir(&app).ok_or("No app data folder")?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    // Older picks for this playlist: gone.
    let prefix = format!("pl-{playlist_id}-");
    for e in std::fs::read_dir(&dir).map_err(err)?.flatten() {
        if e.file_name().to_string_lossy().starts_with(&prefix) {
            let _ = std::fs::remove_file(e.path());
        }
    }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(err)?.as_millis();
    let name = format!("{prefix}{stamp}.{ext}");
    std::fs::write(dir.join(&name), bytes).map_err(err)?;
    Ok(name)
}

/// Last playback (queue as track ids, position): picked up at launch if Settings › Advanced says so.
#[tauri::command]
fn load_session(state: State<AppState>) -> CmdResult<Option<serde_json::Value>> {
    state.lib.lock().unwrap().setting("session").map_err(err)
}

#[tauri::command]
fn save_session(state: State<AppState>, session: serde_json::Value) -> CmdResult<()> {
    // Trust boundary: object only, bounded (10,000 ids fit).
    if !session.is_object() || session.to_string().len() > 512 * 1024 {
        return Err("Invalid session".into());
    }
    state.lib.lock().unwrap().set_setting("session", &session).map_err(err)
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

#[derive(Serialize)]
struct SystemAccent {
    /// For light themes (Windows AccentDark1, as WinUI uses it).
    light: String,
    /// For dark themes (AccentLight2).
    dark: String,
}

/// Windows accent color. None off Windows or on error (theme accent used).
#[tauri::command]
fn system_accent() -> Option<SystemAccent> {
    #[cfg(windows)]
    {
        use windows::UI::ViewManagement::{UIColorType, UISettings};
        let ui = UISettings::new().ok()?;
        let hex = |t| ui.GetColorValue(t).ok().map(|c| format!("#{:02X}{:02X}{:02X}", c.R, c.G, c.B));
        Some(SystemAccent { light: hex(UIColorType::AccentDark1)?, dark: hex(UIColorType::AccentLight2)? })
    }
    #[cfg(not(windows))]
    None
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    window_place::save(&app);
    app.restart()
}

/// Discord Rich Presence add-on: track to show (None = nothing, e.g. paused), under the user's Discord application.
#[tauri::command]
fn discord_presence(state: State<'_, AppState>, client_id: String, presence: Option<music_connectors::discord::Presence>) {
    state.discord.send(discord::Update::Set { client_id, presence });
}

/// Add-on turned off: connection closed, Discord clears the activity.
#[tauri::command]
fn discord_off(state: State<'_, AppState>) {
    state.discord.send(discord::Update::Off);
}

#[tauri::command]
fn discord_status(state: State<'_, AppState>) -> discord::Status {
    state.discord.status()
}

/// Tray and Windows media panel. Same track as last call: play state and timeline only (cover not fetched again).
/// Cover: local file's own (track_id), else `art` URL through the cache.
#[tauri::command]
async fn media_update(state: State<'_, AppState>, now: Option<media::NowPlaying>, track_id: Option<i64>, art: Option<String>) -> CmdResult<()> {
    if let Some(tray) = &state.tray {
        tray.update(now.as_ref()).map_err(err)?;
    }
    let Some(media) = &state.media else { return Ok(()) };
    let key = now.as_ref().map(|n| format!("{track_id:?}\n{}\n{}", n.title, n.artist));
    let same = { std::mem::replace(&mut *state.media_last.lock().unwrap(), key.clone()) == key };
    match &now {
        Some(n) if same => media.set_state(n).map_err(err),
        _ => {
            let mut cover = None;
            if now.is_some() {
                if let Some(id) = track_id {
                    cover = art::local(&state.app, id).await;
                }
                if cover.is_none()
                    && let Some(url) = &art
                {
                    cover = art::remote(&state.app, url).await;
                }
            }
            // Track changed while cover loaded: newer call wins.
            if *state.media_last.lock().unwrap() != key {
                return Ok(());
            }
            media.update(now.as_ref(), cover.as_ref().map(|(b, _)| b.as_slice())).map_err(err)
        }
    }
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(window_place::plugin())
        .register_asynchronous_uri_scheme_protocol("art", |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move { responder.respond(art::respond(app, req).await) });
        })
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let handle = app.handle().clone();
            let open: Opener = Arc::new(move |url: &str| handle.opener().open_url(url, None::<&str>).map_err(Into::into));
            let lib = Library::open(dir.join("library.db"))?;
            let ui = lib.setting("ui").ok().flatten();
            let shield_on = ui.as_ref().and_then(|s| s.get("shield")?.as_bool()).unwrap_or(true);
            // Starts with built-in rules; cached / fresh lists swapped in below without blocking startup.
            let shield = Arc::new(Shield::new("", shield_on));

            let mut window = tauri::WebviewWindowBuilder::from_config(app.handle(), &app.config().app.windows[0])?;
            if let Some((r, g, b)) = window_bg::parse(&window_bg::resolve(ui.as_ref(), window_bg::system_dark())) {
                window = window.background_color(tauri::window::Color(r, g, b, 255));
            }
            if shield_on {
                window = window.initialization_script_for_all_frames(music_shield::YOUTUBE_SCRIPT);
            }
            window = window.initialization_script_for_all_frames(music_shield::BARE_SCRIPT);
            let window = window.build()?;
            #[cfg(windows)]
            shield::install(&window, shield.clone())?;
            let media = media::Media::install(&window).ok();
            let tray = tray::Tray::install(app.handle()).ok();
            // Created hidden: shown once back where it was closed.
            window_place::restore(&window).or_else(|_| window.show())?;

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

            app.manage(AppState { app: app.handle().clone(), lib: Mutex::new(lib), store: Arc::new(secrets::KeyringStore::new(&app.config().identifier)), open, player: Player::spawn(), shield, art: music_connectors::art::ArtCache::new(dir.join("art"), 300 << 20), cache: Caches::default(), nearby: Arc::new(Mutex::new(NearbyState::Idle)), nearby_task: Mutex::default(), media, media_last: Mutex::default(), tray, discord: discord::Discord::spawn() });
            // Reads the library's settings: after AppState.
            app.manage(update::Updater::new(app.handle()));
            update::spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sources_status, connect, disconnect, sync_all, library, playlist_tracks, player, player_status, edit_playlist, add_link, search_catalogs, add_track, backfill_art, find_versions, play_preview, share_playlist, share_preview, share_read_image, share_import, nearby_send, nearby_status, nearby_stop, nearby_receive, record_play, mixes, set_track_pref, clear_history, export_youtube, spotify_player, spotify_playback, ytm_sign_in, ytm_sign_out, spotify_web_open, spotify_web_status, import_spotify_link, ytm_accounts, set_ytm_accounts, local_folders, set_local_folders, rescan_local, load_settings, save_settings, shield_status, set_shield, system_accent, restart_app, media_update, load_session, save_session, add_to_youtube, playlist_orders, save_cover, export_cover, alternative_videos, play_stats, cache_stats, update_status, update_check, update_install, ytm_home, ytm_list, discord_presence, discord_off, discord_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_merge_trims_and_keeps_old_values() {
        let old = Credentials { spotify_client_id: Some("OLD".into()) };
        let new = Credentials { spotify_client_id: Some("   ".into()) };
        let m = old.merged_with(new);
        assert_eq!(m.spotify_client_id.as_deref(), Some("OLD"));
        assert_eq!(m.merged_with(Credentials { spotify_client_id: Some(" NEW ".into()) }).spotify_client_id.as_deref(), Some("NEW"));
    }
}
