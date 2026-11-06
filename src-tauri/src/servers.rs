//! Your music server (Settings › Accounts): Subsonic-compatible servers now (`music_connectors::subsonic`), Jellyfin
//! and Plex later in the same rows. The account (password included) in the keychain only; its songs, playlists and
//! likes in the library (`Source::Server`); its covers through the `art` scheme (the server's cover path allowed at
//! sign-in, auth added by Rust); its songs played by the native engine over HTTP (`music_player::http`): the engine
//! only knows `server:<key>:<item>`, `Fetch` below builds each request with fresh auth.

use crate::{AppState, CmdResult, err};
use music_connectors::subsonic::Subsonic;
use music_core::model::{Source, Track};
use music_core::server::{self, Account, Exposure, Kind};
use music_player::http::{Fetch as PlayerFetch, Remote, Reply};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{self, Read};
use std::sync::{Arc, RwLock};
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
    for a in ACCOUNTS.read().unwrap().iter().filter(|a| !list.iter().any(|b| b.key() == a.key())) {
        music_connectors::art::forget_server(Subsonic::from_account(a).base());
    }
    for a in &list {
        allow_art(a);
    }
    *ACCOUNTS.write().unwrap() = list;
    Ok(())
}

fn allow_art(a: &Account) {
    let sub = Subsonic::from_account(a);
    // Its covers' URLs start with the connector's base (written as `Url` writes it), not the address as typed.
    let base = sub.base().to_string();
    music_connectors::art::allow_server(&base, Arc::new(move |url: &str| sub.sign(url)));
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
        if a.user.is_empty() || a.user.len() > 200 || a.password.len() > 500 || list.iter().any(|b| b.key() == a.key()) {
            continue;
        }
        list.push(Account { kind: a.kind, address, user: a.user.clone(), password: a.password.clone() });
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
    exposure: Exposure,
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
        exposure: server::exposure(&a.address),
        songs: s.map(|s| s.songs as u32),
        playlists: s.map(|s| s.playlists as u32),
        synced_at: s.map(|s| s.at as f64).filter(|t| *t > 0.0),
        error: s.and_then(|s| s.error.clone()),
    }
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

/// Sign in: the server answers and takes the user and password (`ping`), then the account is kept. The first sync is
/// the interface's next call (it shows its progress).
#[tauri::command]
pub async fn server_sign_in(state: State<'_, AppState>, kind: Kind, address: String, user: String, password: String) -> CmdResult<ServerStatus> {
    // Trust boundary: typed text.
    let address = server::normalize(&address).map_err(String::from)?;
    let user = user.trim().to_string();
    if user.is_empty() || user.len() > 200 || password.is_empty() || password.len() > 500 {
        return Err("Type your server's user and password".into());
    }
    let account = Account { kind, address, user, password };
    match kind {
        Kind::Subsonic => Subsonic::from_account(&account).ping().await.map_err(err)?,
    };
    let mut list = accounts();
    list.retain(|a| a.key() != account.key());
    list.push(account.clone());
    save(&state, list).map_err(err)?;
    Ok(status_of(&account, None))
}

/// Sign out: the account leaves the keychain, its songs and playlists leave the library (songs also on other sources
/// stay, without it).
#[tauri::command]
pub async fn server_sign_out(state: State<'_, AppState>, key: String) -> CmdResult<()> {
    let mut list = accounts();
    list.retain(|a| a.key() != key);
    save(&state, list).map_err(err)?;
    set_synced(&state, &key, None);
    let app = state.app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let lib = state.lib();
        lib.drop_server_playlists(&key, &[])?;
        lib.replace_server(&key, &[]).map(|_| ())
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
    let key = a.key();
    let sub = Subsonic::from_account(a);
    let (songs, mut skipped) = sub.library().await?;
    let mut lists: Vec<(String, String, Vec<Track>)> = Vec::new();
    // Every playlist the server lists stays, one that failed to come too (kept as it was, not dropped).
    let mut keep: Vec<String> = Vec::new();
    for p in sub.playlists().await? {
        let id = server::item_id(&key, &p.id);
        keep.push(id.clone());
        match sub.playlist(&p.id).await {
            Ok(tracks) => lists.push((id, p.name, tracks)),
            Err(e) if e.to_string().starts_with("Your music server refused the sign-in") => return Err(e),
            Err(_) => skipped += 1,
        }
    }
    let liked = sub.starred().await?;
    let app = state.app.clone();
    let key2 = key.clone();
    let (n, playlists) = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<(usize, usize)> {
        let state = app.state::<AppState>();
        let lib = state.lib();
        // Signed out while it read (the sign-out cleans under this same lock, after the keychain): nothing written back.
        anyhow::ensure!(account(&key2).is_some(), "Your music server isn't signed in");
        let n = lib.replace_server(&key2, &songs)?;
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
                t if t.starts_with("Your music server") || t.starts_with("That address") => t,
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
    Subsonic::from_account(&a).star(&item, on).await.map_err(err)
}

/// A play back to the server: now playing at the start, a submission past half the song or 4 minutes (the interface
/// checks Last.fm's rule), when the account takes changes. Failures dropped (a play isn't worth an error box).
#[tauri::command]
pub async fn server_scrobble(state: State<'_, AppState>, id: String, started_at_ms: f64, submission: bool) -> CmdResult<()> {
    let Ok((a, item)) = item(&id) else { return Ok(()) };
    if !state.direction(&direction_key(&a.key())).pushes() {
        return Ok(());
    }
    let _ = Subsonic::from_account(&a).scrobble(&item, started_at_ms as i64, submission).await;
    Ok(())
}

/// The engine's way to server songs: the request built here with fresh auth, run on the app's async runtime, the
/// body read chunk by chunk (each wait bounded).
struct Fetch;

impl PlayerFetch for Fetch {
    fn get(&self, key: &str, from: u64, transcode: bool) -> io::Result<Reply> {
        let (a, item) = item(key).map_err(|e| io::Error::new(io::ErrorKind::PermissionDenied, e))?;
        let sub = Subsonic::from_account(&a);
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
    } else if said.starts_with("Your music server refused the sign-in") || said.starts_with("Your music server doesn't take") {
        io::ErrorKind::PermissionDenied
    } else if said.starts_with("Your music server doesn't answer") || said.starts_with("Your music server's certificate") || said.starts_with("That address isn't a Subsonic server") {
        io::ErrorKind::NotConnected
    } else {
        io::ErrorKind::Other
    }
}

/// A response body as a blocking reader (the stream's worker thread, never an async one).
struct Body {
    body: music_connectors::subsonic::Body,
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
        assert!(!down("Your music server doesn't have this item (Song not found)"));
        assert!(!down("Your music server sent no audio for this song"));
        assert!(!down("Your music server said: odd (code 0)"));
    }
}
