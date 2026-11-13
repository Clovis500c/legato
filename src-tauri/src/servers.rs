//! Your music server (Settings › Accounts): Subsonic-compatible servers, Jellyfin and Plex (`music_connectors::servers`
//! `Conn`; Plex's sign-in in `plex.rs`). The account (password or token) in the keychain only; its songs, playlists and
//! likes in the library (`Source::Server`); its covers through the `art` scheme (the server's cover path allowed at
//! sign-in, auth added by Rust); its songs played by the native engine over HTTP (`music_player::http`): the engine
//! only knows `server:<key>:<item>`, `Fetch` below builds each request with fresh auth.

use crate::{AddReport, AppState, CmdResult, err, push};
use music_connectors::servers::{self as conns, Conn};
use music_connectors::subsonic::Subsonic;
use music_connectors::pin;
use music_core::library::LibraryPlaylist;
use music_core::model::{Source, Track};
use music_core::server::{self, Account, Exposure, Kind};
use music_player::http::{Fetch as PlayerFetch, PREFIX, Remote, Reply};
use music_player::{Command, Gain};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{self, Read};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError, RwLock};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

/// Keychain entry: every signed-in server.
const KEY: &str = "servers";
/// Library setting: each server's last sync (no secret: songs, when, what failed).
const SYNCED: &str = "server_syncs";
/// An automatic sync (with the others, `sync_all`) reads a server again after this long; "Sync now" any time.
const AGAIN_MS: i64 = 30 * 60_000;
/// A song's bytes stop coming for this long: the read fails (the player retries, then says so).
const CHUNK_WAIT: Duration = Duration::from_secs(20);

/// Signed-in accounts, read once from the keychain (each range request needs one).
static ACCOUNTS: RwLock<Vec<Account>> = RwLock::new(Vec::new());

fn accounts() -> Vec<Account> {
    ACCOUNTS.read().unwrap().clone()
}

fn account(key: &str) -> Option<Account> {
    ACCOUNTS.read().unwrap().iter().find(|a| a.key() == key).cloned()
}

/// The keychain and this process learn the new list; covers of these servers allowed.
fn save(state: &AppState, list: Vec<Account>) -> anyhow::Result<()> {
    if list.is_empty() {
        state.store.set(KEY, None)?;
    } else {
        state.store.save(KEY, &list)?;
    }
    // A base no account uses any more (signed out): its covers no longer
    // get a token.
    let kept: Vec<String> = list.iter().map(|a| Conn::from_account(a).cover_base()).collect();
    for a in ACCOUNTS.read().unwrap().iter() {
        let base = Conn::from_account(a).cover_base();
        if !kept.contains(&base) {
            music_connectors::art::forget_server(&base);
        }
    }
    for a in &list {
        allow_art(a);
    }
    *ACCOUNTS.write().unwrap() = list;
    Ok(())
}

fn allow_art(a: &Account) {
    let conn = Conn::from_account(a);
    // Its covers' URLs start with the connector's base (written as `Url` writes it), not the address as typed.
    let base = conn.cover_base();
    music_connectors::art::allow_server(&base, Arc::new(move |url: &str| conn.sign_cover(url)));
}

/// At launch: accounts from the keychain, their covers allowed, the engine given the way to their songs.
pub fn start(app: &AppHandle) {
    let state = app.state::<AppState>();
    let list: Vec<Account> = state.store.load(KEY).unwrap_or_default();
    for a in &list {
        allow_art(a);
    }
    *ACCOUNTS.write().unwrap() = list;
    state.player.send(music_player::Command::Remote { fetch: Remote(Arc::new(Fetch)) });
}

/// Sync Mode (sealed snapshots only): the accounts to carry.
pub fn sealed() -> Vec<Account> {
    accounts()
}

/// Sync Mode: another PC's servers fill what's missing here (never replace). Checked like a sign-in's words.
pub fn take(state: &AppState, from: &[Account]) -> anyhow::Result<()> {
    let mut list = accounts();
    let mut changed = false;
    for a in from.iter().take(8) {
        let Ok(address) = server::normalize(&a.address) else { continue };
        let plex = |all: &[String]| if a.kind == Kind::Plex { all.iter().filter_map(|c| server::normalize(c).ok()).filter(|c| conns::usable(c)).collect() } else { Vec::new() };
        let got = Account { address, connections: plex(&a.connections), relays: plex(&a.relays), ..a.clone() };
        // Same server as one here once both are written alike (key of the address as kept).
        if !got.complete() || !conns::usable(&got.address) || list.iter().any(|b| b.key() == got.key()) {
            continue;
        }
        list.push(got);
        changed = true;
    }
    if changed { save(state, list) } else { Ok(()) }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Synced {
    songs: usize,
    playlists: usize,
    at: i64,
    /// The last sync's failure, in words.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn syncs(state: &AppState) -> BTreeMap<String, Synced> {
    state.lib().setting(SYNCED).ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

fn set_synced(state: &AppState, key: &str, s: Option<Synced>) {
    let mut all = syncs(state);
    match s {
        Some(s) => all.insert(key.to_string(), s),
        None => all.remove(key),
    };
    if let Ok(v) = serde_json::to_value(all) {
        let _ = state.lib().set_setting(SYNCED, &v);
    }
}

/// One signed-in server, for Settings › Accounts. Never the password.
#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ServerStatus {
    key: String,
    kind: Kind,
    address: String,
    user: String,
    /// The server's own name (Jellyfin, Plex).
    name: Option<String>,
    exposure: Exposure,
    /// Plex: reached through Plex's relay only.
    relay: bool,
    /// Songs from it in the library at the last sync.
    songs: Option<u32>,
    playlists: Option<u32>,
    /// Last sync, unix ms.
    synced_at: Option<f64>,
    error: Option<String>,
}

fn status_of(a: &Account, s: Option<&Synced>) -> ServerStatus {
    ServerStatus {
        key: a.key(),
        kind: a.kind,
        address: a.address.clone(),
        user: a.user.clone(),
        name: Some(a.name.clone()).filter(|n| !n.is_empty()),
        exposure: server::exposure(&a.address),
        relay: a.via_relay(),
        songs: s.map(|s| s.songs as u32),
        playlists: s.map(|s| s.playlists as u32),
        synced_at: s.map(|s| s.at as f64).filter(|t| *t > 0.0),
        error: s.and_then(|s| s.error.clone()),
    }
}

/// A server song's own lyrics (OpenSubsonic's timed ones, else plain; Jellyfin's) and the name shown under them. None
/// when it has none, or the server is out of reach (4 s): the online sources come next.
pub async fn lyrics(id: &str, artist: &str, title: &str) -> Option<(music_core::lyrics::Record, String)> {
    let (a, item) = item(id).ok()?;
    let found = tokio::time::timeout(Duration::from_secs(4), Conn::from_account(&a).lyrics(&item, artist, title)).await.ok()?.ok()??;
    let name = match &a.kind {
        _ if !a.name.is_empty() => a.name.clone(),
        Kind::Subsonic => "Subsonic".into(),
        Kind::Jellyfin => "Jellyfin".into(),
        Kind::Plex => "Plex".into(),
    };
    Some((found, name))
}

#[tauri::command]
pub async fn server_status(state: State<'_, AppState>) -> CmdResult<Vec<ServerStatus>> {
    let all = syncs(&state);
    Ok(accounts().iter().map(|a| status_of(a, all.get(&a.key()))).collect())
}

/// An address as typed, before signing in: how it would be reached (the row's warning shows as you type).
#[tauri::command]
pub async fn server_exposure(address: String) -> CmdResult<Option<Exposure>> {
    Ok(server::normalize(&address).ok().map(|b| server::exposure(&b)))
}

/// Sign in: the server answers and takes the user and password (Subsonic: `ping`; Jellyfin: its token back, the
/// password not kept), then the account is kept. Plex signs in on its own page (`plex.rs`). The first sync is the
/// interface's next call (it shows its progress).
#[tauri::command]
pub async fn server_sign_in(state: State<'_, AppState>, kind: Kind, address: String, user: String, password: String, plain: bool, pin: Option<String>) -> CmdResult<ServerStatus> {
    // Trust boundary: typed text.
    let address = server::normalize(&address).map_err(String::from)?;
    let user = user.trim().to_string();
    if user.is_empty() || user.len() > 200 || password.is_empty() || password.len() > 500 {
        return Err("Type your server's user and password".into());
    }
    // The certificate the user checked (its fingerprint shown after the first try): this sign-in goes through it.
    let trusted = pin.filter(|p| p.len() <= 200 && !p.is_empty());
    if let Some(p) = &trusted {
        pin::set(&address, Some(p));
    }
    let signed = match kind {
        Kind::Subsonic => {
            // The password as it is (hex-encoded): after the interface's warning, https only.
            let a = Account { kind, address: address.clone(), user, password, plain_password: plain, ..Default::default() };
            Subsonic::from_account(&a).ping().await.map(|_| a)
        }
        Kind::Jellyfin => music_connectors::jellyfin::sign_in(&address, &user, &password).await,
        Kind::Plex => return Err("Plex signs in on its own page: Sign in with Plex".into()),
    };
    let account = match signed {
        Ok(a) => Account { pin: if pin::pinned(&address) { trusted.unwrap_or_default() } else { String::new() }, ..a },
        Err(e) => {
            pin::set(&address, None);
            // Refused by the system's TLS: its fingerprint, for the user to check against the server's own.
            if trusted.is_none()
                && e.to_string().starts_with(UNTRUSTED)
                && address.starts_with("https://")
                && let Some(fp) = pin::probe(&address).await
            {
                return Err(format!("{UNTRUSTED}. Its SHA-256 fingerprint: {fp}"));
            }
            return Err(err(e));
        }
    };
    add(&state, account)
}

/// `music_connectors::servers::reach`'s words for a certificate the system refused.
const UNTRUSTED: &str = "Your music server's certificate isn't trusted";

/// A checked account joins the keychain's list (the same server account replaced).
pub fn add(state: &AppState, account: Account) -> CmdResult<ServerStatus> {
    let mut list = accounts();
    list.retain(|a| a.key() != account.key());
    list.push(account.clone());
    save(state, list).map_err(err)?;
    Ok(status_of(&account, None))
}

/// Sign out: the account leaves the keychain, its songs and playlists leave the library (songs also on other sources
/// stay, without it).
#[tauri::command]
pub async fn server_sign_out(state: State<'_, AppState>, key: String) -> CmdResult<()> {
    // Jellyfin's token ended on the server too (a server that's off doesn't hold the sign-out).
    if let Some(a) = account(&key) {
        if !a.pin.is_empty() {
            pin::set(&a.address, None);
        }
        let _ = tokio::time::timeout(Duration::from_secs(10), Conn::from_account(&a).sign_out()).await;
    }
    let mut list = accounts();
    list.retain(|a| a.key() != key);
    save(&state, list).map_err(err)?;
    set_synced(&state, &key, None);
    let app = state.app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let lib = state.lib();
        lib.drop_server_playlists(&key, &[])?;
        lib.replace_server(&key, &[], true).map(|_| ())
    })
    .await
    .map_err(err)?
    .map_err(err)
}

/// What a sync brought.
#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ServerSync {
    songs: u32,
    playlists: u32,
    /// Albums and playlists the server failed to give (skipped; a playlist kept as it was).
    skipped: u32,
}

/// Account key for Settings › Accounts › Sync's direction.
fn direction_key(key: &str) -> String {
    format!("server:{key}")
}

/// One server read whole: its songs, playlists and likes into the library, in a few writes off the async threads.
async fn sync_one(state: &AppState, a: &Account) -> anyhow::Result<ServerSync> {
    // Plex on its relay (nothing else answered last time): its direct addresses first, back home or port opened.
    let back = if a.kind == Kind::Plex && a.via_relay() { direct(state, a).await } else { None };
    let a = back.as_ref().unwrap_or(a);
    match read(state, a).await {
        // Plex: its address changed (another network, a new port): the others it gave are tried, the one that answers kept.
        Err(e) if a.kind == Kind::Plex && format!("{e:#}").starts_with("Your music server doesn't answer") => match moved(state, a).await {
            Some(b) => read(state, &b).await,
            None => Err(e),
        },
        r => r,
    }
}

/// A Plex server at another of its addresses: the account saved with it. None: none answers (or signed out meanwhile).
async fn moved(state: &AppState, a: &Account) -> Option<Account> {
    let all: Vec<String> = a.connections.iter().chain(&a.relays).filter(|c| **c != a.address).cloned().collect();
    moved_to(state, a, &all).await
}

/// A Plex server on its relay, now answering at a direct address: the account saved with it.
async fn direct(state: &AppState, a: &Account) -> Option<Account> {
    moved_to(state, a, &a.connections).await
}

async fn moved_to(state: &AppState, a: &Account, all: &[String]) -> Option<Account> {
    let address = music_connectors::plex::pick(all, &a.token, &a.device, &a.server_id).await.ok()?;
    let b = Account { address, ..a.clone() };
    let mut list = accounts();
    let at = list.iter().position(|x| x.key() == a.key())?;
    list[at] = b.clone();
    save(state, list).ok()?;
    Some(b)
}

async fn read(state: &AppState, a: &Account) -> anyhow::Result<ServerSync> {
    let key = a.key();
    let sub = Conn::from_account(a);
    let got = sub.library().await?;
    let (songs, albums_failed, liked) = (got.songs, got.failed, got.liked);
    let mut skipped = albums_failed;
    let mut lists: Vec<(String, String, Vec<Track>)> = Vec::new();
    // Every playlist the server lists stays, one that failed to come too (kept as it was, not dropped).
    let mut keep: Vec<String> = Vec::new();
    for p in sub.playlists().await? {
        let id = server::item_id(&key, &p.id);
        keep.push(id.clone());
        match sub.playlist(&p.id).await {
            Ok(tracks) => lists.push((id, p.name, tracks)),
            Err(e) if conns::refused(&e) => return Err(e),
            Err(_) => skipped += 1,
        }
    }
    let app = state.app.clone();
    let key2 = key.clone();
    let (n, playlists) = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<(usize, usize)> {
        let state = app.state::<AppState>();
        let lib = state.lib();
        // Signed out while it read (the sign-out cleans under this same lock, after the keychain): nothing written back.
        anyhow::ensure!(account(&key2).is_some(), "Your music server isn't signed in");
        // Some albums didn't come: their songs aren't gone, nothing dropped this time.
        let n = lib.replace_server(&key2, &songs, albums_failed == 0)?;
        for (id, name, tracks) in &lists {
            lib.save_playlist(Source::Server, id, name, tracks)?;
        }
        lib.drop_server_playlists(&key2, &keep)?;
        if !liked.is_empty() {
            lib.add_likes(&liked)?;
        }
        Ok((n, keep.len()))
    })
    .await??;
    if account(&key).is_some() {
        set_synced(state, &key, Some(Synced { songs: n, playlists, at: music_core::library::now_ms(), error: None }));
    }
    Ok(ServerSync { songs: n as u32, playlists: playlists as u32, skipped: skipped as u32 })
}

/// "Sync now" (and the first sync after a sign-in).
#[tauri::command]
pub async fn server_sync(state: State<'_, AppState>, key: String) -> CmdResult<ServerSync> {
    let a = account(&key).ok_or("Your music server isn't signed in")?;
    if !state.direction(&direction_key(&key)).pulls() {
        return Err("Music server: sync direction is Off (Settings › Accounts)".into());
    }
    match sync_one(&state, &a).await {
        Ok(s) => Ok(s),
        Err(e) if account(&key).is_none() => Err(err(e)),
        Err(e) => {
            let mut s = syncs(&state).remove(&key).unwrap_or_default();
            s.error = Some(format!("{e:#}"));
            set_synced(&state, &key, Some(s));
            Err(err(e))
        }
    }
}

/// With every other service's sync (`sync_all`): servers not read for `AGAIN_MS`. Failures go to the report.
pub async fn sync_due(state: &AppState) -> (usize, Vec<String>) {
    let (mut playlists, mut errors) = (0, Vec::new());
    let done = syncs(state);
    let now = music_core::library::now_ms();
    for a in accounts() {
        let key = a.key();
        if !state.direction(&direction_key(&key)).pulls() || done.get(&key).is_some_and(|s| now - s.at < AGAIN_MS) {
            continue;
        }
        match sync_one(state, &a).await {
            Ok(s) => playlists += s.playlists as usize,
            // Its own words name it already; a bare network error gets the name in front.
            Err(e) => errors.push(match format!("{e:#}") {
                t if t.starts_with("Your music server") || t.starts_with("That address") || t.starts_with("Plex") => t,
                t => format!("Music server: {t}"),
            }),
        }
    }
    (playlists, errors)
}

/// Server and item of a library id, signed in.
fn item(id: &str) -> CmdResult<(Account, String)> {
    let (key, item) = server::split_item(id).ok_or("Not a server song")?;
    Ok((account(key).ok_or("Your music server isn't signed in")?, item.to_string()))
}

/// Like here = star there (unlike = unstar), when the account takes changes.
#[tauri::command]
pub async fn server_star(state: State<'_, AppState>, id: String, on: bool) -> CmdResult<()> {
    let (a, item) = item(&id)?;
    if !state.direction(&direction_key(&a.key())).pushes() {
        return Ok(());
    }
    Conn::from_account(&a).like(&item, on).await.map_err(err)
}

/// A play back to the server: now playing at the start (no position), at the end the position heard and whether it
/// counts (past half the song or 4 minutes: the interface checks Last.fm's rule), when the account takes changes.
/// Failures dropped (a play isn't worth an error box).
#[tauri::command]
pub async fn server_scrobble(state: State<'_, AppState>, id: String, started_at_ms: f64, submission: bool, position_ms: Option<f64>) -> CmdResult<()> {
    let Ok((a, item)) = item(&id) else { return Ok(()) };
    if !state.direction(&direction_key(&a.key())).pushes() {
        return Ok(());
    }
    let at = position_ms.filter(|p| p.is_finite() && *p >= 0.0).map(|p| p as u64);
    let _ = Conn::from_account(&a).played(&item, started_at_ms as i64, submission, at).await;
    Ok(())
}

const NOT_SENT: &str = "Changes made here aren't sent to this music server (Settings › Accounts › Sync)";

/// A playlist of a signed-in server that takes edits (Subsonic kinds, direction sending): its row, its account, its
/// id there. Err in words before anything changes.
fn sent_playlist(state: &AppState, id: i64) -> CmdResult<(LibraryPlaylist, Account, String)> {
    let p = state.lib().playlists().map_err(err)?.into_iter().find(|p| p.id == id && p.source == Source::Server && !p.custom).ok_or("Not a music server's playlist")?;
    let (a, remote) = item(&p.source_id)?;
    if a.kind != Kind::Subsonic {
        return Err(conns::READ_ONLY.into());
    }
    if !state.direction(&direction_key(&a.key())).pushes() {
        return Err(NOT_SENT.into());
    }
    Ok((p, a, remote))
}

/// A song's id on the server `key`, when it is one of its songs.
fn on_server(lib: &music_core::library::Library, track_id: i64, key: &str) -> Option<String> {
    lib.source_ids(track_id, Source::Server).ok()?.iter().find_map(|s| server::split_item(s).filter(|(k, _)| *k == key).map(|(_, i)| i.to_string()))
}

/// Add to a playlist of your Subsonic server: here at once, then on the server in the background (`push.rs`), taken
/// back out here if it refuses. That server's songs only; one already in the playlist isn't added twice.
#[tauri::command]
pub async fn server_playlist_add(state: State<'_, AppState>, id: i64, track_ids: Vec<i64>) -> CmdResult<AddReport> {
    let (p, a, remote) = sent_playlist(&state, id)?;
    let key = a.key();
    let (found, there) = {
        let lib = state.lib();
        let found: Vec<(i64, String)> = track_ids.iter().filter_map(|t| Some((*t, on_server(&lib, *t, &key)?))).collect();
        let there: HashSet<i64> = lib.playlist_tracks(id).map_err(err)?.into_iter().map(|t| t.id).collect();
        (found, there)
    };
    let no_youtube = track_ids.len() - found.len();
    let mut seen = HashSet::new();
    let (new, dup): (Vec<_>, Vec<_>) = found.into_iter().filter(|(t, _)| seen.insert(*t)).partition(|(t, _)| !there.contains(t));
    let report = AddReport { added: new.len(), already: dup.len(), no_youtube };
    if new.is_empty() {
        return Ok(report);
    }
    let (added, items): (Vec<i64>, Vec<String>) = new.into_iter().unzip();
    state.lib().append_to_imported(id, &added).map_err(err)?;
    let app = state.app.clone();
    push::later(async move {
        if let Err(e) = Conn::from_account(&a).playlist_add(&remote, &items).await {
            {
                let st = app.state::<AppState>();
                let lib = st.lib();
                for t in &added {
                    let _ = lib.remove_from_imported(id, *t);
                }
            }
            push::failed(&app, push::Failed { kind: push::Kind::ServerAdd, playlist: p.name, songs: added.len(), reason: err(e) });
        }
    });
    Ok(report)
}

/// Send a playlist made here to your Subsonic server: created there with its songs, then it is that server's playlist
/// here too (mirrored; the next sync finds it by its id). Only when every song is that server's, since the mirror is
/// what the server holds: songs it doesn't have would vanish at the next sync. Err in words before anything changes.
#[tauri::command]
pub async fn server_playlist_create(state: State<'_, AppState>, id: i64, key: String) -> CmdResult<usize> {
    let a = account(&key).ok_or("Your music server isn't signed in")?;
    if a.kind != Kind::Subsonic {
        return Err(conns::READ_ONLY.into());
    }
    if !state.direction(&direction_key(&a.key())).pushes() {
        return Err(NOT_SENT.into());
    }
    let (name, items, missing) = {
        let lib = state.lib();
        let p = lib.playlists().map_err(err)?.into_iter().find(|p| p.id == id && p.custom).ok_or("Not a playlist made here")?;
        let tracks = lib.playlist_tracks(id).map_err(err)?;
        let items: Vec<String> = tracks.iter().filter_map(|t| on_server(&lib, t.id, &key)).collect();
        (p.name, items, tracks.len() - tracks.iter().filter(|t| on_server(&lib, t.id, &key).is_some()).count())
    };
    if items.is_empty() {
        return Err("None of this playlist's songs are on that server".into());
    }
    if missing > 0 {
        return Err(format!("{missing} of this playlist's songs aren't on that server: take them out first, or add the server's own songs to a new playlist"));
    }
    let remote = Conn::from_account(&a).playlist_create(&name, &items).await.map_err(err)?;
    state.lib().adopt_playlist(id, Source::Server, &server::item_id(&key, &remote)).map_err(err)?;
    Ok(items.len())
}

/// Remove from a playlist of your Subsonic server, every occurrence: here at once, then on the server in the
/// background, put back here if it refuses.
#[tauri::command]
pub async fn server_playlist_remove(state: State<'_, AppState>, id: i64, track_id: i64) -> CmdResult<()> {
    let (p, a, remote) = sent_playlist(&state, id)?;
    let item = on_server(&state.lib(), track_id, &a.key());
    state.lib().remove_from_imported(id, track_id).map_err(err)?;
    let app = state.app.clone();
    push::later(async move {
        // Not that server's song (matched from elsewhere): nothing to take out there.
        let Some(item) = item else { return };
        if let Err(e) = Conn::from_account(&a).playlist_remove(&remote, &item).await {
            let _ = app.state::<AppState>().lib().append_to_imported(id, &[track_id]);
            push::failed(&app, push::Failed { kind: push::Kind::ServerRemove, playlist: p.name, songs: 1, reason: err(e) });
        }
    });
    Ok(())
}

/// Songs' levelling gains as their servers gave them, by library id (None: it has none). Asked once per run of the app.
static GAINS: Mutex<Option<HashMap<String, Option<Gain>>>> = Mutex::new(None);

/// Volume levelling for server songs about to play (`paths`: the engine's): the ReplayGain their server read from
/// the files' tags, told to the engine. A server that gives none, or doesn't answer: the song plays as it is.
pub async fn gains(state: &AppState, paths: Vec<PathBuf>) {
    let known = |id: &str| GAINS.lock().unwrap_or_else(PoisonError::into_inner).get_or_insert_default().get(id).copied();
    let mut list = Vec::new();
    for path in paths {
        let Some(id) = path.to_str().and_then(|p| p.strip_prefix(PREFIX)).map(str::to_string) else { continue };
        let gain = match known(&id) {
            Some(g) => g,
            None => {
                let Ok((a, item)) = item(&id) else { continue };
                let Ok(rg) = Conn::from_account(&a).replay_gain(&item).await else { continue };
                let g = rg.map(|rg| Gain::tagged(rg.track_db, rg.track_peak, rg.album));
                let mut all = GAINS.lock().unwrap_or_else(PoisonError::into_inner);
                let all = all.get_or_insert_default();
                if all.len() > 2000 {
                    all.clear();
                }
                all.insert(id, g);
                g
            }
        };
        list.extend(gain.map(|g| (path, g)));
    }
    if !list.is_empty() {
        state.player.send(Command::Gains { list });
    }
}

/// The engine's way to server songs: the request built here with fresh auth, run on the app's async runtime, the
/// body read chunk by chunk (each wait bounded).
struct Fetch;

impl PlayerFetch for Fetch {
    fn get(&self, key: &str, from: u64, transcode: bool) -> io::Result<Reply> {
        // A radio station (`radio:<stream address>`): no account, no Range, an endless body.
        if let Some(stream) = key.strip_prefix(music_player::http::RADIO) {
            let stream = stream.to_string();
            let s = tauri::async_runtime::block_on(async move { tokio::time::timeout(Duration::from_secs(30), music_connectors::radio_browser::open(&stream)).await })
                .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "This radio station doesn't answer (timed out)"))?
                .map_err(|e| io::Error::new(io::ErrorKind::NotConnected, format!("{e:#}")))?;
            return Ok(Reply { status: s.status, content_length: s.content_length, content_range: s.content_range, content_type: s.content_type, body: Box::new(Body { body: s.body, left: Vec::new(), at: 0 }) });
        }
        // A podcast episode (`podcast:<audio address>`): no account, an ordinary ranged file.
        if let Some(audio) = key.strip_prefix(music_player::http::PODCAST) {
            let audio = audio.to_string();
            let s = tauri::async_runtime::block_on(async move { tokio::time::timeout(Duration::from_secs(30), music_connectors::podcast::open(&audio, from)).await })
                .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "This episode's server doesn't answer (timed out)"))?
                .map_err(|e| io::Error::new(io::ErrorKind::NotConnected, format!("{e:#}")))?;
            return Ok(Reply { status: s.status, content_length: s.content_length, content_range: s.content_range, content_type: s.content_type, body: Box::new(Body { body: s.body, left: Vec::new(), at: 0 }) });
        }
        let (a, item) = item(key).map_err(|e| io::Error::new(io::ErrorKind::PermissionDenied, e))?;
        let sub = Conn::from_account(&a);
        let s = tauri::async_runtime::block_on(async move { tokio::time::timeout(Duration::from_secs(30), sub.stream(&item, from, transcode)).await })
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "Your music server doesn't answer (timed out)"))?
            .map_err(|e| {
                let said = format!("{e:#}");
                io::Error::new(kind_of(&said), said)
            })?;
        Ok(Reply { status: s.status, content_length: s.content_length, content_range: s.content_range, content_type: s.content_type, body: Box::new(Body { body: s.body, left: Vec::new(), at: 0 }) })
    }
}

/// The connector's words as the engine's kinds: the server off or refusing (the run stops, `http::unreachable`), or
/// this song alone (the next one is tried).
fn kind_of(said: &str) -> io::ErrorKind {
    if said.starts_with("Your music server doesn't have this item") || said.starts_with("Your music server sent no audio") {
        io::ErrorKind::NotFound
    } else if said.starts_with("Your music server refused the sign-in") || said.starts_with("Your music server no longer accepts") || said.starts_with("Your music server doesn't take") {
        io::ErrorKind::PermissionDenied
    } else if said.starts_with("Your music server doesn't answer") || said.starts_with("Your music server's certificate") || said.starts_with("That address isn't a") {
        io::ErrorKind::NotConnected
    } else {
        io::ErrorKind::Other
    }
}

/// A response body as a blocking reader (the stream's worker thread, never an async one).
struct Body {
    body: conns::Body,
    left: Vec<u8>,
    at: usize,
}

impl Read for Body {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if self.at >= self.left.len() {
            let body = &mut self.body;
            match tauri::async_runtime::block_on(async { tokio::time::timeout(CHUNK_WAIT, body.chunk()).await }) {
                Err(_) => return Err(io::Error::new(io::ErrorKind::TimedOut, "Your music server stopped sending this song (timed out)")),
                Ok(Err(e)) => return Err(io::Error::other(format!("{e:#}"))),
                Ok(Ok(None)) => return Ok(0),
                Ok(Ok(Some(b))) => (self.left, self.at) = (b, 0),
            }
        }
        let n = out.len().min(self.left.len() - self.at);
        out[..n].copy_from_slice(&self.left[self.at..self.at + n]);
        self.at += n;
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_connectors_words_tell_a_server_down_from_a_song_it_lacks() {
        let down = |s: &str| music_player::http::unreachable(&io::Error::new(kind_of(s), s));
        assert!(down("Your music server doesn't answer: check that it's on and its address is right (tcp connect error)"));
        assert!(down("Your music server refused the sign-in: check the user and the password"));
        assert!(down("Your music server's certificate isn't trusted (a self-signed one?): …"));
        assert!(down("Your music server no longer accepts this sign-in: sign in again in Settings › Accounts"));
        assert!(down("That address isn't a Jellyfin server: check it"));
        assert!(!down("Your music server sent a format Legato can't play"));
        assert!(!down("Your music server doesn't have this item (Song not found)"));
        assert!(!down("Your music server sent no audio for this song"));
        assert!(!down("Your music server said: odd (code 0)"));
    }
}
