mod spotify_cmd;
mod webview_watch;
mod listening;
mod versions;
mod catalog_search;
mod library_cmd;
mod sources;
mod bookmarks;
mod pictures;
mod storage;
mod ytm_accounts;
mod ytm_browse;
mod library_edits;
mod sharing;
mod lyrics_cmd;
mod alarm;
mod apple_web;
mod art;
mod autostart;
mod background;
mod backup;
mod deferred;
mod detector;
mod devices;
mod diag;
mod lastfm;
mod listenbrainz;
mod discord;
mod cast;
mod tempo;
#[cfg_attr(not(desktop), allow(dead_code))]
mod discord_login;
mod discover;
mod editor;
mod folders;
mod health;
mod picked;
#[cfg(desktop)]
mod pip;
#[cfg(target_os = "android")]
#[path = "mobile/picked.rs"]
mod picked_jni;
mod remote;
mod rooms;
mod hosts;
#[cfg(target_os = "android")]
#[path = "mobile/keystore.rs"]
mod keystore;
#[cfg_attr(mobile, path = "mobile/hotkeys.rs")]
mod hotkeys;
mod identity;
mod jumplist;
mod lang;
mod libfile;
mod lmix;
mod links;
mod media;
mod mixer;
#[cfg(desktop)]
mod plugins;
mod plex;
mod prepare;
mod protocol;
mod outputs;
mod podcast;
mod radio;
mod secrets;
mod servers;
#[cfg(windows)]
mod shield;
mod sponsor;
mod viz;
mod speech;
mod syncmode;
mod push;
mod rename;
mod songlist;
mod tags;
mod spotify_export;
mod spotify_paste;
mod spotify_web;
mod thumbbar;
mod themes;
#[cfg_attr(mobile, path = "mobile/tray.rs")]
mod tray;
mod unplug;
#[cfg_attr(mobile, path = "mobile/update.rs")]
mod update;
mod window_bg;
#[cfg_attr(mobile, path = "mobile/window_place.rs")]
mod window_place;
mod ytm;
mod ytwatch;

use anyhow::Context;
use music_connectors::lrclib::Lrclib;
use music_connectors::oauth::Opener;
use music_connectors::spotify::Spotify;
use music_connectors::ytmusic::{Account, Artist, Home, ListRef, YouTubeMusic, YtLyrics, valid_mood};
use music_connectors::ytweb::YouTubeWeb;
use music_core::cache::{Memo, Stats, Ttl};
use music_core::history::{Play, Pref};
use music_core::lyrics::{self, Lyrics};
use music_core::library::{Changes, Library, LibraryPlaylist, LibraryTrack, PlaylistEdit};
use music_core::matching::merge_tracks;
use music_core::musicness::Musicness;
use music_core::search::{self, Hit};
use music_core::model::{Connector, SecretStore, Source, Track};
use music_core::share::{self, Item, Shared};
use catalog_search::{store, today, video_search, yt_search};
use library_cmd::{folders, loose_files, rescan};
use library_edits::AddReport;
use listening::unix_now;
use sources::SourceStatus;
use versions::{playable_hit, with_youtube, youtube_version};
use sharing::NearbyState;
use ytm_accounts::{NOT_SENT, ytm_key};
use spotify_web::{SpotifyLibraryImport, SpotifyProgress, SpotifySong};
use music_core::sync::{self as service_sync, DIRECTIONS, Direction, SyncReport, sync};
use music_player::{Command, Player, Status};
use music_shield::Shield;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Response;
use tauri::{Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

/// Errors cross IPC as plain strings (full anyhow chain).
type CmdResult<T> = Result<T, String>;

fn err(e: impl Into<anyhow::Error>) -> String {
    format!("{:#}", e.into())
}

/// Google refused the session as signed out: its cookies went stale (ytm::refresh).
fn signed_out(e: &anyhow::Error) -> bool {
    e.to_string().starts_with(music_connectors::ytmusic::SIGNED_OUT)
}

/// A YouTube Music call with the picked accounts. Refused as signed out: session refreshed, then once more.
async fn with_ytm<T, F, Fut>(state: &AppState, f: F) -> anyhow::Result<T>
where
    F: Fn(Vec<YouTubeMusic>) -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<T>>,
{
    match f(state.ytm_all()).await {
        Err(e) if signed_out(&e) && ytm::refresh(&state.app).await => f(state.ytm_all()).await,
        r => r,
    }
}

/// Spotify app key (Spotify has no keyless sign-in). Stored in OS keychain.
#[derive(Debug, Default, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
struct Credentials {
    #[ts(optional)]
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
    /// The library. A command that panicked while holding it (poisoned lock) must not lock every later one out: its
    /// transaction rolled back when dropped, the connection is still sound.
    fn lib(&self) -> std::sync::MutexGuard<'_, Library> {
        self.lib.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn credentials(&self) -> Credentials {
        self.store.load("credentials").unwrap_or_default()
    }

    fn spotify(&self) -> Option<Spotify> {
        let id = self.credentials().spotify_client_id?;
        Some(Spotify::new(&id, self.store.clone(), self.open.clone()))
    }

    /// Accounts picked in Settings › Accounts (empty = main account only).
    fn ytm_picked(&self) -> Vec<Account> {
        self.lib().setting("ytm_accounts").ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
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

    /// Connect Spotify is a pull: the account's direction has to allow it.
    fn spotify_takes(&self) -> CmdResult<()> {
        if self.direction("spotify").pulls() { Ok(()) } else { Err("Spotify: sync direction is Off (Settings › Accounts)".into()) }
    }

    /// Account's sync direction (Settings › Accounts). Keys: "spotify", "youtube:<account key>".
    fn direction(&self, key: &str) -> Direction {
        service_sync::direction(self.lib().setting(DIRECTIONS).ok().flatten().as_ref(), key)
    }

    /// Picked YouTube Music accounts that take changes made here, or why none does.
    fn ytm_senders(&self) -> CmdResult<Vec<YouTubeMusic>> {
        let all = self.ytm_all();
        if all.is_empty() {
            return Err("Sign in to YouTube Music first (Settings › Accounts)".into());
        }
        let send: Vec<_> = all.into_iter().filter(|y| self.direction(&ytm_key(y)).pushes()).collect();
        if send.is_empty() {
            return Err(NOT_SENT.into());
        }
        Ok(send)
    }

    /// First picked account: search, export.
    fn ytm(&self) -> Option<YouTubeMusic> {
        self.ytm_all().into_iter().next()
    }

    /// Searches and public pages: the first picked account, else YouTube Music's public catalog (signed out).
    fn ytm_or_public(&self) -> YouTubeMusic {
        self.ytm().unwrap_or_else(public_ytm)
    }

    fn connector(&self, source: Source) -> Option<Box<dyn Connector>> {
        match source {
            Source::Spotify => self.spotify().map(|c| Box::new(c) as _),
            Source::Youtube | Source::Local | Source::Apple | Source::Server => None,
        }
    }
}

/// YouTube Music signed out: public catalog, artist pages. The host comes from `hosts` (the smoke test's mock).
fn public_ytm() -> YouTubeMusic {
    YouTubeMusic::anonymous_with_api(hosts::get().ytmusic)
}

/// Answers kept until the data under them changes (music_core::cache): library reads stamped with the library
/// version, history reads with the history version, network answers for a while.
struct Caches {
    library: Memo<(), u64>,
    playlist: Memo<i64, u64>,
    stats: Memo<(), u64>,
    /// Key: UTC offset. Stamp: library and history versions, day (seed), local hour (time-of-day mix).
    mixes: Memo<i64, (u64, u64, u64, i64)>,
    youtube: Ttl<Vec<Track>>,
    /// Normal YouTube searches: tracks with their music classification.
    videos: Ttl<Vec<(Track, Musicness)>>,
    apple: Ttl<Vec<Track>>,
    /// Sign-in state: keychain and WebView2 cookies, read on every refresh otherwise.
    status: Ttl<Vec<(Source, SourceStatus)>>,
    /// YouTube Music home shelves, and the songs of the playlists / radios opened from them.
    home: Ttl<Home>,
    lists: Ttl<Vec<Track>>,
    /// Mixes' discoveries: radios of their leading songs, asked a few times a day.
    radios: Ttl<Vec<Track>>,
    artists: Ttl<Option<Artist>>,
    /// Album pages from the Apple catalog (None = not in the store): change rarely.
    albums: Ttl<Option<music_connectors::itunes::Album>>,
    /// Video → may it play in an embed (oEmbed).
    embeds: Ttl<bool>,
}

impl Default for Caches {
    fn default() -> Self {
        Self {
            library: Memo::new(1),
            playlist: Memo::new(32),
            stats: Memo::new(1),
            mixes: Memo::new(4),
            youtube: Ttl::new(Duration::from_secs(30 * 60), 300),
            videos: Ttl::new(Duration::from_secs(30 * 60), 100),
            apple: Ttl::new(Duration::from_secs(30 * 60), 100),
            status: Ttl::new(Duration::from_secs(30), 1),
            home: Ttl::new(Duration::from_secs(15 * 60), 12),
            lists: Ttl::new(Duration::from_secs(15 * 60), 30),
            radios: Ttl::new(Duration::from_secs(12 * 3600), 16),
            artists: Ttl::new(Duration::from_secs(30 * 60), 32),
            albums: Ttl::new(Duration::from_secs(24 * 3600), 64),
            embeds: Ttl::new(Duration::from_secs(24 * 3600), 2000),
        }
    }
}

/// Cached JSON straight to the UI: no second serialization.
fn json(answer: Arc<str>) -> Response {
    Response::new(answer.to_string())
}

#[tauri::command]
async fn edit_playlist(state: State<'_, AppState>, edit: PlaylistEdit) -> CmdResult<Option<i64>> {
    state.lib().edit_playlist(edit).map_err(err)
}

#[tauri::command]
async fn load_settings(state: State<'_, AppState>) -> CmdResult<Option<serde_json::Value>> {
    state.lib().setting("ui").map_err(err)
}

#[tauri::command]
async fn save_settings(#[cfg_attr(mobile, allow(unused_variables))] app: tauri::AppHandle, state: State<'_, AppState>, settings: serde_json::Value) -> CmdResult<()> {
    // Trust boundary: object only, bounded size (custom themes included).
    if !settings.is_object() || settings.to_string().len() > 256 * 1024 {
        return Err("Invalid settings".into());
    }
    #[cfg(desktop)]
    let channel = update::Channel::from_ui(state.lib().setting("ui").map_err(err)?.as_ref());
    // Stamped key by key: Sync Mode merges settings by their newest change.
    state.lib().save_ui_settings(&settings, music_core::library::now_ms()).map_err(err)?;
    // Update channel picked: the updater looks at the new one now (saved first, it reads the setting).
    #[cfg(desktop)]
    if update::Channel::from_ui(Some(&settings)) != channel
        && let Some(updater) = app.try_state::<update::Updater>()
    {
        updater.switched(&app);
    }
    Ok(())
}

/// Plays of the last days (since = unix s, two weeks at most): Home's Your week.
#[tauri::command]
async fn recent_plays(state: State<'_, AppState>, since: i64) -> CmdResult<Vec<Play>> {
    state.lib().plays_since(since.max(unix_now() - 15 * 86_400)).map_err(err)
}

/// Every play since `since` (unix s, 0 = all of it), oldest first: the Stats page.
#[tauri::command]
async fn play_history(state: State<'_, AppState>, since: i64) -> CmdResult<Vec<Play>> {
    state.lib().plays_since(since.max(0)).map_err(err)
}

/// Track id → [listens, last start (unix s), rating in half stars]: Most played / Recently played / rating sorts.
#[tauri::command]
async fn play_stats(state: State<'_, AppState>) -> CmdResult<Response> {
    let lib = state.lib();
    let answer = state.cache.stats.get_or((), lib.versions.history(), || serde_json::to_string(&lib.play_stats().map_err(err)?).map_err(err))?;
    Ok(json(answer))
}

/// Settings › About: version, last update, what the updater is doing.
#[tauri::command]
fn update_status(updater: State<update::Updater>) -> update::Status {
    updater.status()
}

/// Check now (Settings › About). Runs in the background; progress comes as `update` events. The phone checks first and
/// downloads on the next ask (mobile data).
#[tauri::command]
fn update_check(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move { app.state::<update::Updater>().check(&app, true).await });
}

/// Install the downloaded update: the app closes and starts again (UI asks when nothing plays, or the user does).
#[cfg(desktop)]
#[tauri::command]
fn update_install(app: tauri::AppHandle, updater: State<update::Updater>) -> CmdResult<()> {
    updater.install(&app)
}

/// The phone: the downloaded APK to Android's installer, which asks the user (writes the library first: async).
#[cfg(mobile)]
#[tauri::command]
async fn update_install(app: tauri::AppHandle) -> CmdResult<()> {
    app.state::<update::Updater>().install(&app)
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
struct CacheStats {
    library: Stats,
    playlists: Stats,
    mixes: Stats,
    stats: Stats,
    images: Stats,
}

/// Settings › About: third-party notices shipped with the app (bundle.resources, docs/licenses.md), in the default
/// browser. Fixed path: nothing from the UI.
#[tauri::command]
fn open_licenses(app: tauri::AppHandle) -> CmdResult<()> {
    let path = app.path().resolve("third-party-licenses.html", tauri::path::BaseDirectory::Resource).map_err(err)?;
    if !path.is_file() {
        return Err(format!("{} missing", path.display()));
    }
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(err)
}

/// Voice search: one phrase through Windows' speech recognition (speech.rs); words so far come as "speech" events.
#[tauri::command]
async fn voice_listen(app: tauri::AppHandle) -> CmdResult<speech::Heard> {
    tauri::async_runtime::spawn_blocking(move || speech::listen(&app)).await.map_err(err)
}

#[tauri::command]
fn voice_stop() {
    speech::stop()
}

/// Interface language (Settings › Language): the tray menu and taskbar buttons follow it.
#[tauri::command]
fn set_ui_language(state: State<AppState>, lang: String) -> CmdResult<()> {
    if lang::set(&lang) {
        if let Some(tray) = &state.tray {
            tray.relabel().map_err(err)?;
        }
        thumbbar::refresh();
    }
    Ok(())
}

/// Windows settings pages the app points to when one of them blocks a feature. Fixed list.
#[tauri::command]
fn open_windows_settings(app: tauri::AppHandle, page: String) -> CmdResult<()> {
    let uri = match page.as_str() {
        "speech" => "ms-settings:privacy-speech",
        "microphone" => "ms-settings:privacy-microphone",
        _ => return Err(format!("unknown settings page {page}")),
    };
    app.opener().open_url(uri, None::<&str>).map_err(err)
}

/// Last playback (queue as track ids, position): picked up at launch if Settings › Advanced says so.
#[tauri::command]
async fn load_session(state: State<'_, AppState>) -> CmdResult<Option<serde_json::Value>> {
    state.lib().setting("session").map_err(err)
}

#[tauri::command]
async fn save_session(state: State<'_, AppState>, session: serde_json::Value) -> CmdResult<()> {
    // Trust boundary: object only, bounded (10,000 ids fit).
    if !session.is_object() || session.to_string().len() > 512 * 1024 {
        return Err("Invalid session".into());
    }
    state.lib().set_setting("session", &session).map_err(err)
}

#[derive(Serialize, ts_rs::TS)]
#[ts(export)]
struct ShieldStatus {
    enabled: bool,
    blocked: u64,
}

/// Hosts talked to today (Settings › Privacy). `utc_offset`: local time's from UTC, seconds.
#[tauri::command]
async fn net_today(utc_offset: i64) -> Vec<music_core::netlog::Contact> {
    music_core::netlog::today(utc_offset)
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

#[derive(Serialize, ts_rs::TS)]
#[ts(export)]
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
    crate::diag::closing();
    window_place::save(&app);
    app.restart()
}

/// Opens at sign-in. None off Windows (setting hidden).
#[tauri::command]
fn autostart() -> Option<bool> {
    autostart::get()
}

#[tauri::command]
fn set_autostart(on: bool) -> CmdResult<()> {
    autostart::set(on).map_err(err)
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

/// The artist's picture for Discord's small image, square: the artist page's own (`ytm_artist`'s cache). Nobody waits
/// for it, so YouTube Music is asked only for a song it plays (`ask`), never during an import, once a minute at most,
/// not for 15 minutes after a refusal (the owner's choice, 2026-11-06). None: not known, or not now.
#[tauri::command]
async fn discord_artist_art(state: State<'_, AppState>, name: String, ask: bool) -> CmdResult<Option<String>> {
    let name = name.trim().to_string();
    if name.is_empty() || name.chars().count() > 200 {
        return Err("Invalid artist".into());
    }
    let key = name.to_lowercase();
    let page = match state.cache.artists.get(&key) {
        Some(hit) => hit,
        None => {
            if !ask || links::importing() || !discord::LOOKS.lock().unwrap().take(std::time::Instant::now()) {
                return Ok(None);
            }
            match public_ytm().artist(&name).await {
                Ok(page) => state.cache.artists.put(&key, page),
                Err(e) => {
                    if music_connectors::refused(&err(e)) {
                        discord::LOOKS.lock().unwrap().refused(std::time::Instant::now());
                    }
                    return Ok(None);
                }
            }
        }
    };
    Ok(page.as_ref().as_ref().and_then(|a| a.art.as_deref()).map(music_connectors::discord::square))
}

/// An artist's picture for the big title (the owner's choice 2026-11-11): the artist page's own kept picture, else
/// YouTube Music asked once for a song it plays (`ask`), one artist at a time, never during an import, nothing for
/// 15 minutes after a refusal, a miss not asked again for 6 hours. Square art URL; None: not known, or not now.
#[tauri::command]
async fn artist_picture(state: State<'_, AppState>, name: String, ask: bool) -> CmdResult<Option<String>> {
    static ONE_AT_A_TIME: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    static LOOKED: std::sync::LazyLock<Mutex<music_core::searchpace::Looked>> = std::sync::LazyLock::new(Default::default);
    let name = name.trim().to_string();
    if name.is_empty() || name.chars().count() > 200 {
        return Err("Invalid artist".into());
    }
    let key = name.to_lowercase();
    let art = |page: &Option<music_connectors::ytmusic::Artist>| page.as_ref().and_then(|a| a.art.as_deref()).map(music_connectors::discord::square);
    if let Some(hit) = state.cache.artists.get(&key) {
        return Ok(art(&hit));
    }
    if !ask || links::importing() {
        return Ok(None);
    }
    let _turn = ONE_AT_A_TIME.lock().await;
    // Another call may have found it while this one waited.
    if let Some(hit) = state.cache.artists.get(&key) {
        return Ok(art(&hit));
    }
    if !LOOKED.lock().unwrap().may_ask(&key, std::time::Instant::now()) {
        return Ok(None);
    }
    match public_ytm().artist(&name).await {
        Ok(page) => Ok(art(&state.cache.artists.put(&key, page))),
        Err(e) => {
            let now = std::time::Instant::now();
            if music_connectors::refused(&err(e)) { LOOKED.lock().unwrap().refused(now) } else { LOOKED.lock().unwrap().missed(&key, now) }
            Ok(None)
        }
    }
}

/// A new player is about to start (songs overlapping): window hidden, page held `visible` until the music moves.
#[tauri::command]
fn hold_page(app: tauri::AppHandle) {
    background::hold(&app);
}

/// Tray and Windows media panel. Same track as last call: play state and timeline only (cover not fetched again).
/// Cover: local file's own (track_id), else `art` URL through the cache.
#[tauri::command]
async fn media_update(app: tauri::AppHandle, state: State<'_, AppState>, now: Option<media::NowPlaying>, track_id: Option<i64>, art: Option<String>) -> CmdResult<()> {
    remote::set_now(now.as_ref(), track_id, art.as_deref());
    let playing = now.as_ref().is_some_and(|n| n.playing);
    background::set_playing(playing);
    background::played(&app, playing, now.as_ref().map_or(0, |n| n.position_ms));
    thumbbar::set_playing(playing);
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
                    cover = art::remote(&state.app, url, None).await;
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

/// Global shortcuts from Settings › Shortcuts. Returns the actions the OS refused.
#[tauri::command]
fn set_global_shortcuts(app: tauri::AppHandle, list: Vec<hotkeys::Entry>) -> Vec<String> {
    hotkeys::set(&app, &list)
}

/// Blocked embed (101 / 150): the video from YouTube's watch page, over the video slot.
#[tauri::command]
async fn ytwatch_open(state: State<'_, AppState>, video: String, start: f64, rect: Option<ytwatch::Rect>) -> CmdResult<()> {
    ytwatch::open(&state.app, &video, start, rect, state.shield.clone()).map_err(err)
}

/// None = hidden (cover mode), still playing.
#[tauri::command]
async fn ytwatch_place(state: State<'_, AppState>, rect: Option<ytwatch::Rect>) -> CmdResult<()> {
    ytwatch::place(&state.app, rect).map_err(err)
}

#[tauri::command]
async fn ytwatch_cmd(state: State<'_, AppState>, cmd: ytwatch::Cmd) -> CmdResult<()> {
    ytwatch::command(&state.app, cmd).map_err(err)
}

#[tauri::command]
async fn ytwatch_close(state: State<'_, AppState>) -> CmdResult<()> {
    ytwatch::close(&state.app).map_err(err)
}

/// Live processing of what the native engine plays (local files, previews): Adaptive Sound, and later the Live Editor.
#[tauri::command]
fn player_live(state: State<AppState>, settings: music_player::LiveSettings) {
    state.player.set_live(settings);
}

/// What the native engine plays, as heard (meters, cover animation).
#[tauri::command]
fn player_levels(state: State<AppState>) -> music_player::Levels {
    state.player.levels()
}

#[tauri::command]
fn player(state: State<AppState>, cmd: Command) {
    state.player.send(cmd)
}

#[tauri::command]
fn player_status(state: State<AppState>) -> Status {
    state.player.status()
}

/// Error box before any window exists (startup), then the app quits. Kept in the diagnostics log too (when it runs yet).
fn stop_with(text: &str) -> ! {
    diag::error("startup", "stopped before the window opened", text);
    diag::flush();
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
        use windows::core::HSTRING;
        // SAFETY: plain modal box, no owner window, strings live through the call.
        unsafe {
            MessageBoxW(None, &HSTRING::from(text), &HSTRING::from("Legato"), MB_OK | MB_ICONERROR);
        }
    }
    std::process::exit(1);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    // First: who runs decides what may touch the PC outside the app's own folders (identity.rs).
    identity::init(&context.config().identifier);
    // Started from a Jump List entry: kept until the interface asks.
    #[cfg(desktop)]
    jumplist::note(&std::env::args().collect::<Vec<_>>());
    // Before anything opens the app's folders (window place, WebView2, library): Music App's move to Legato's name.
    if let Err(e) = rename::migrate(&context.config().identifier) {
        stop_with(&format!("Legato can't move your library and settings to its new folder ({e}). Close Music App if it still runs, then start Legato again."));
    }
    let builder = tauri::Builder::default();
    // First: a second launch shows this one (from the tray too) instead of starting again. Desktop only, like updates,
    // the window's saved place and global keys.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, argv, _| {
            background::show(app);
            // From the Jump List: the interface takes it (jumplist.rs).
            if jumplist::note(&argv) {
                let _ = app.emit_to("main", "jump", ());
            }
            // From the `legato://` link type (the share page's Open in Legato): the interface takes it.
            if protocol::note(&argv) {
                let _ = app.emit_to("main", "link", ());
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(window_place::plugin())
        .plugin(hotkeys::plugin());
    // The phone's camera reads a pairing QR code (Settings › Sync Mode › Add a device).
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // A reload of the interface forgets its channels: the visualizer's worker stops with it (viz.rs).
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && payload.event() == tauri::webview::PageLoadEvent::Started {
                viz::stop();
            }
        })
        .register_asynchronous_uri_scheme_protocol("art", |ctx, req, responder| {
            // Third-party pages the app opens (YouTube, Exportify, Google's sign-in) never read local covers or the user's pictures.
            if !art::ours(ctx.webview_label()) {
                return responder.respond(art::refused());
            }
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move { responder.respond(art::respond(app, req).await) });
        })
        .setup(|app| {
            autostart::follow();
            protocol::register();
            protocol::note(&std::env::args().collect::<Vec<_>>());
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            // Before anything that can fail: later steps log, and a panic from here on lands in the diagnostics log.
            diag::init(&dir, &app.package_info().version.to_string());
            let handle = app.handle().clone();
            let open: Opener = Arc::new(move |url: &str| handle.opener().open_url(url, None::<&str>).map_err(Into::into));
            let lib = match Library::open(dir.join("library.db")) {
                Ok(lib) => lib,
                // Newer app's library: say so and stop, never write into it.
                Err(e) if e.is::<music_core::library::NewerLibrary>() => stop_with(&e.to_string()),
                // Damaged file (the copy before a migration fails too): say where it is rather than vanish.
                Err(e) => stop_with(&format!("Legato can't open its library ({e:#}).\n\nThe file is {}; copies made before updates and each day sit next to it (library-before-v*.db, library-daily.db).", dir.join("library.db").display())),
            };
            // Daily copy of the library, off the startup path (best effort: a full disk mustn't stop the app).
            let db_path = dir.join("library.db");
            std::thread::spawn(move || {
                let _ = music_core::library::keep_daily_copy(&db_path);
            });
            let ui = lib.setting("ui").ok().flatten();
            let shield_on = ui.as_ref().and_then(|s| s.get("shield")?.as_bool()).unwrap_or(true);
            // Starts with built-in rules; cached / fresh lists swapped in below without blocking startup.
            let shield = Arc::new(Shield::new("", shield_on));

            let mut window = tauri::WebviewWindowBuilder::from_config(app.handle(), &app.config().app.windows[0])?.additional_browser_args(&background::browser_args());
            if let Some((r, g, b)) = window_bg::parse(&window_bg::resolve(ui.as_ref(), window_bg::system_dark())) {
                window = window.background_color(tauri::window::Color(r, g, b, 255));
            }
            if shield_on {
                window = window.initialization_script_for_all_frames(music_shield::YOUTUBE_SCRIPT);
            }
            window = window.initialization_script_for_all_frames(music_shield::BARE_SCRIPT);
            window = window.initialization_script_for_all_frames(music_shield::REFUSED_SCRIPT);
            window = window.initialization_script_for_all_frames(music_shield::LIVE_SCRIPT);
            let window = window.build()?;
            // Close = back to the tray (setting closeToTray, on by default); Quit in the tray menu really quits.
            let handle = app.handle().clone();
            window.on_window_event(move |e| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                    if background::quitting() {
                        return;
                    }
                    api.prevent_close();
                    let to_tray = handle.try_state::<AppState>().and_then(|s| s.lib().setting("ui").ok().flatten()).and_then(|u| u.get("closeToTray")?.as_bool()).unwrap_or(true);
                    if to_tray { background::hide(&handle) } else { background::quit(&handle) }
                }
            });
            background::spawn_sleeper(app.handle().clone());
            // The alarm rings from the tray too.
            alarm::spawn(app.handle().clone());
            // Volume mixer: YouTube's WebView2 sound listed as Legato.
            #[cfg(windows)]
            mixer::spawn();
            // Headphones unplugged, Bluetooth off: the interface pauses.
            #[cfg(windows)]
            unplug::spawn(app.handle().clone());
            #[cfg(windows)]
            shield::install(window.as_ref(), shield.clone())?;
            // A WebView2 process that dies: logged, and a dead renderer's page loaded again.
            #[cfg(windows)]
            let _ = webview_watch::install(window.as_ref());
            #[cfg(windows)]
            shield::browser_keys_off(window.as_ref())?;
            let media = media::Media::install(&window).ok();
            // Previous / Play / Next under the taskbar thumbnail.
            let _ = thumbbar::install(&window);
            let tray = tray::Tray::install(app.handle()).ok();
            // Created hidden: shown once back where it was closed. Updated from the tray: stays there.
            #[cfg(mobile)]
            window.show()?;
            #[cfg(desktop)]
            if update::back_to_tray(&lib, &app.package_info().version.to_string()) {
                background::hide_until_playing(app.handle());
            } else {
                window_place::restore(&window).or_else(|_| window.show())?;
            }

            let lists = dir.join("shield");
            let fresh = shield.clone();
            tauri::async_runtime::spawn(async move {
                let cached = music_shield::cached_lists(&lists);
                if !cached.is_empty() {
                    fresh.reload(&cached);
                }
                if music_shield::lists_stale(&lists) {
                    // Not through the connectors' client: noted here (Settings › Privacy).
                    for (_, url) in music_shield::LISTS {
                        music_core::netlog::note_url(url, music_core::netlog::Via::App, false);
                    }
                    if let Ok(text) = music_shield::download_lists(&lists).await {
                        fresh.reload(&text);
                    }
                }
            });

            // Google session kept fresh like a browser that visits YouTube now and then: soon after launch, then twice a day.
            let google = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(90)).await;
                loop {
                    ytm::refresh(&google).await;
                    tokio::time::sleep(Duration::from_secs(12 * 3600)).await;
                }
            });

            app.manage(AppState { app: app.handle().clone(), lib: Mutex::new(lib), store: secrets::store(&app.config().identifier, &dir), open, player: Player::spawn(), shield, art: music_connectors::art::ArtCache::new(dir.join("art"), 500 << 20), cache: Caches::default(), nearby: Arc::new(Mutex::new(NearbyState::Idle)), nearby_task: Mutex::default(), media, media_last: Mutex::default(), tray, discord: discord::Discord::spawn() });
            // The output device picked in the player menu.
            outputs::apply(&app.state::<AppState>());
            // Reads the library's settings: after AppState.
            app.manage(update::Updater::new(app.handle()));
            app.manage(syncmode::SyncMode::default());
            app.manage(devices::Devices::default());
            app.manage(rooms::Rooms::default());
            app.manage(lastfm::Pending::default());
            app.manage(listenbrainz::Pending::default());
            // Keychain read off the main thread; the engine learns the way to server songs.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                servers::start(&handle);
                radio::start(&handle);
            });
            #[cfg(desktop)]
            app.manage(plugins::Plugins::default());
            let dirs = folders(&app.state::<AppState>().lib());
            folders::watch(app.handle(), &dirs);
            // Plugins, update and Sync Mode rounds: when the UI says ready, or after a few seconds.
            deferred::arm(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![deferred::app_ready, sources::sources_status, sources::connect, sources::disconnect, sources::sync_all, library_cmd::library, library_cmd::library_changes, library_cmd::playlist_tracks, player, player_status, edit_playlist, library_cmd::add_link, catalog_search::search_catalogs, catalog_search::search_suggestions, versions::add_track, versions::pick_version, versions::backfill_art, versions::find_versions, versions::play_preview, sharing::share_playlist, sharing::song_code, sharing::share_preview, sharing::share_song, sharing::share_read_image, sharing::share_import, sharing::nearby_send, sharing::nearby_status, sharing::nearby_stop, sharing::nearby_receive, listening::record_play, recent_plays, play_history, listening::mixes, library_edits::set_track_pref, listening::block_find, listening::artist_path, library_edits::set_rating, library_edits::set_music, library_edits::set_explicit, library_edits::clear_history, library_edits::export_youtube, spotify_cmd::spotify_player, spotify_cmd::spotify_playback, spotify_cmd::ytm_sign_in, ytm_accounts::ytm_sign_out, spotify_cmd::spotify_web_open, spotify_cmd::spotify_web_status, spotify_cmd::import_spotify_link, links::import_link, links::import_link_stop, links::not_found, links::not_found_search, links::find_now, spotify_web::spotify_lists, spotify_web::spotify_import, spotify_web::spotify_web_close, spotify_export::spotify_export_open, spotify_export::spotify_export_close, spotify_export::spotify_export_file, spotify_export::spotify_export_import, spotify_paste::import_spotify_tracks, apple_web::apple_web_open, apple_web::apple_web_status, apple_web::apple_lists, apple_web::apple_import, apple_web::apple_web_close, ytm_accounts::ytm_accounts, ytm_accounts::set_ytm_accounts, ytm_accounts::sync_directions, ytm_accounts::set_sync_direction, library_cmd::local_folders, library_cmd::set_local_folders, library_cmd::rescan_local, folders::add_dropped, health::library_health, load_settings, save_settings, shield_status, set_shield, net_today, system_accent, restart_app, autostart, set_autostart, hold_page, media_update, remote::remote_start, remote::remote_stop, remote::remote_queue, remote::overlay_start, remote::overlay_stop, remote::overlay_bars, load_session, save_session, library_edits::add_to_youtube, pictures::save_cover, pictures::export_cover, pictures::save_picture, versions::alternative_videos, versions::embed_refused, play_stats, storage::cache_stats, storage::art_cache_size, storage::set_art_cache_cap, storage::clear_art_cache, storage::storage, storage::clear_storage, open_licenses, update_status, update_check, update_install, ytm_browse::ytm_home, ytm_browse::ytm_list, ytm_browse::ytm_artist, ytm_browse::album_info, discord_presence, discord_off, discord_status, discord_artist_art, #[cfg(desktop)] discord_login::discord_login_status, #[cfg(desktop)] discord_login::discord_login_connect, #[cfg(desktop)] discord_login::discord_login_disconnect, artist_picture, discover::new_releases, discover::artist_links, discover::song_credits, discover::artist_bio, library_edits::remove_from_playlist, library_edits::remove_from_library, library_edits::merge_duplicates, versions::resolve_track, set_global_shortcuts, player_live, editor::player_effects, player_levels, viz::viz_start, viz::viz_page, viz::viz_stop, viz::viz_stats, prepare::local_prepare, prepare::local_waveform, sponsor::sponsor_segments, editor::export_edit, editor::export_stop, editor::edits, editor::save_edit, editor::delete_edit, editor::activate_edit, editor::edit_draft, editor::save_edit_draft, voice_listen, voice_stop, open_windows_settings, detector::detector_status, detector::set_detector_token, detector::detect_song, detector::detect_stop, lastfm::lastfm_status, lastfm::lastfm_connect, lastfm::lastfm_disconnect, lastfm::lastfm_now_playing, lastfm::lastfm_scrobble, lastfm::lastfm_discoveries, listenbrainz::listenbrainz_status, listenbrainz::listenbrainz_connect, listenbrainz::listenbrainz_disconnect, listenbrainz::listenbrainz_now_playing, listenbrainz::listenbrainz_submit, servers::server_status, servers::server_exposure, servers::server_sign_in, servers::server_sign_out, servers::server_sync, servers::server_star, servers::server_scrobble, servers::server_playlist_add, servers::server_playlist_remove, plex::plex_sign_in, plex::plex_wait, plex::plex_cancel, plex::plex_pick, lyrics_cmd::lyrics, lyrics_cmd::translate_lyrics, lyrics_cmd::lyrics_choices, lyrics_cmd::lyrics_pick, lyrics_cmd::search_lyrics, alarm::set_alarm, bookmarks::add_bookmark, bookmarks::bookmarks, bookmarks::delete_bookmark, jumplist::jump_pending, protocol::link_pending, lmix::lmix_read, lmix::lmix_write, lmix::lmix_link, lmix::lmix_from_link, radio::radio_search, radio::radio_suggest, radio::radio_kept, radio::radio_keep, podcast::podcast_feed, podcast::podcast_kept, tempo::tempo_scan, cast::cast_scan, cast::cast_play, cast::cast_control, outputs::output_devices, outputs::set_output_device, podcast::podcast_keep, podcast::podcast_import, podcast::podcast_export, jumplist::set_jump_list, set_ui_language, ytwatch_open, ytwatch_place, ytwatch_cmd, ytwatch_close, syncmode::sync_status, syncmode::sync_probe, syncmode::sync_setup, syncmode::sync_stop, syncmode::sync_now, syncmode::sync_dismiss, syncmode::sync_pickup, devices::devices_status, devices::devices_network, devices::devices_auto, devices::device_offer, devices::device_offer_stop, devices::device_pair, devices::device_sync, devices::device_forget, rooms::room_status, rooms::room_start, rooms::room_end, rooms::room_host_now, rooms::room_host_next, rooms::room_react, rooms::rooms_nearby, rooms::room_join, rooms::room_leave, rooms::room_resolve, #[cfg(desktop)] plugins::plugins_list, #[cfg(desktop)] plugins::plugin_inspect, #[cfg(desktop)] plugins::plugin_install, #[cfg(desktop)] plugins::plugin_set, #[cfg(desktop)] plugins::plugin_uninstall, #[cfg(desktop)] plugins::plugin_reply, #[cfg(desktop)] plugins::plugin_event, #[cfg(desktop)] plugins::plugin_input, #[cfg(desktop)] plugins::plugin_frame, #[cfg(desktop)] plugins::plugin_log, themes::save_background, themes::forget_background, themes::export_theme, themes::import_theme, themes::read_preset, themes::write_preset, tags::edit_tags, tags::read_tags, tags::track_chapters, tags::youtube_chapters, tags::write_lyrics, tags::song_releases, songlist::import_song_list, songlist::export_playlist_file, backup::library_backup, backup::library_restore, libfile::library_file_lists, libfile::library_file_import, picked::picked_in, picked::picked_temp, picked::picked_out, #[cfg(desktop)] pip::pip, diag::diag_log, diag::diag_report])
        .run(context)
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::versions::checked_hit;

    /// CLAUDE.md: a sync command runs on the window's thread, so one that locks the library freezes the app (a sync
    /// holding it, a slow disk). Every command file scanned: a `.lib()` only in an `async fn` command.
    #[test]
    fn no_sync_command_locks_the_library() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut sync = Vec::new();
        for entry in std::fs::read_dir(&dir).unwrap().flatten() {
            let path = entry.path();
            let Ok(text) = std::fs::read_to_string(&path) else { continue };
            for cmd in text.split("#[tauri::command]").skip(1) {
                let body = cmd.split("
}
").next().unwrap_or(cmd);
                let head = body.lines().find(|l| l.contains("fn ")).unwrap_or_default();
                if !head.contains("async fn") && body.contains(".lib()") {
                    sync.push(format!("{}: {}", path.file_name().unwrap().to_string_lossy(), head.trim()));
                }
            }
        }
        assert!(sync.is_empty(), "sync commands locking the library: {sync:?}");
    }

    /// Nov 2026: `app.state::<AppState>()` before `manage` panics at launch (the e2e walk never saw a first screen).
    #[test]
    fn setup_reads_app_state_only_after_managing_it() {
        let src = include_str!("lib.rs");
        let run = &src[src.find("pub fn run()").unwrap()..];
        let managed = run.find("app.manage(AppState {").unwrap();
        assert!(!run[..managed].contains(".state::<AppState>()"), "AppState read in setup before app.manage(AppState)");
    }

    #[test]
    fn credentials_merge_trims_and_keeps_old_values() {
        let old = Credentials { spotify_client_id: Some("OLD".into()) };
        let new = Credentials { spotify_client_id: Some("   ".into()) };
        let m = old.merged_with(new);
        assert_eq!(m.spotify_client_id.as_deref(), Some("OLD"));
        assert_eq!(m.merged_with(Credentials { spotify_client_id: Some(" NEW ".into()) }).spotify_client_id.as_deref(), Some("NEW"));
    }

    #[test]
    fn hits_without_a_catalog_id_pass_to_the_youtube_lookup() {
        let named = Track { title: "Parallel World".into(), artist: "Smv".into(), ..Default::default() };
        assert!(checked_hit(named.clone()).is_ok(), "Music Detector hit, no Apple / Spotify link");
        assert!(checked_hit(Track { title: " ".into(), ..named.clone() }).is_err());
        let local = Track { ids: [(Source::Local, "C:/x.mp3".to_string())].into(), ..named };
        assert!(checked_hit(local).is_err(), "a file path never comes from a search hit");
    }
}
