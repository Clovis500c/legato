//! Sync Mode shell: where the files live (a OneDrive folder found on this PC, or one the user picks), this PC's id and
//! file key (OS keychain), the minute timer, and the local network exchange. Logic (snapshot, merge, sealing) lives in
//! `music_core::syncmode`.

use crate::detector::AUDD_TOKEN;
use crate::{AppState, CmdResult, Credentials, err, ytm};
use music_connectors::nearby;
use music_core::model::Connector;
use music_core::library::now_ms;
use music_core::syncmode::{self as sm, Accounts, Key, Manifest, Merged, Secrets, Snapshot};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager, State};

/// Folder made inside the chosen one.
const DIR: &str = "Music App Sync";
const MANIFEST: &str = "sync.json";
/// This PC's Sync Mode settings (library settings row, never synced).
const CONFIG: &str = "sync";
/// Keychain entry: the folder's file key (protected folders).
const KEY: &str = "sync_key";
const FIRST: Duration = Duration::from_secs(15);
const EVERY: Duration = Duration::from_secs(60);

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    #[serde(default)]
    device: String,
    /// Folder holding `Music App Sync`. None = off.
    #[serde(default)]
    folder: Option<String>,
    /// The OneDrive question was answered (set up, or not now).
    #[serde(default)]
    asked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    name: String,
    at: i64,
    accounts: Accounts,
}

/// Settings › Sync.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// OneDrive folders found on this PC.
    onedrive: Vec<String>,
    folder: Option<String>,
    protected: bool,
    asked: bool,
    device_name: String,
    /// Other PCs met (through the folder or the network).
    devices: Vec<Device>,
    last: Option<i64>,
    error: Option<String>,
}

/// A folder before setting up: new, or another PC syncs there already (with a password or not).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    exists: bool,
    protected: bool,
    devices: usize,
}

#[derive(Default)]
pub struct SyncMode {
    inner: Mutex<Inner>,
    /// One round at a time (timer, button, network).
    running: tokio::sync::Mutex<()>,
    offer: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

#[derive(Default)]
struct Inner {
    /// Other PCs' files merged already: path → modified time.
    seen: HashMap<PathBuf, SystemTime>,
    /// Last snapshot written (hash without its time): unchanged = not written again.
    written: Option<u64>,
    devices: HashMap<String, Device>,
    last: Option<i64>,
    error: Option<String>,
}

fn device_name() -> String {
    std::env::var("COMPUTERNAME").ok().filter(|n| !n.is_empty()).unwrap_or_else(|| "PC".into())
}

fn config(state: &AppState) -> Config {
    let lib = state.lib();
    let mut c: Config = lib.setting(CONFIG).ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    if sm::device_file(&c.device).is_none() {
        c.device = sm::new_device_id();
        let _ = lib.set_setting(CONFIG, &serde_json::json!(c));
    }
    c
}

fn save_config(state: &AppState, c: &Config) -> CmdResult<()> {
    state.lib().set_setting(CONFIG, &serde_json::json!(c)).map_err(err)
}

fn read_manifest(dir: &Path) -> Option<Manifest> {
    serde_json::from_slice(&std::fs::read(dir.join(MANIFEST)).ok()?).ok()
}

/// Keychain text ↔ key (hex).
fn file_key(state: &AppState) -> Option<Key> {
    let hex: String = state.store.load(KEY)?;
    let bytes: Option<Vec<u8>> = (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok()).collect();
    bytes?.try_into().ok()
}

/// Other PCs' files in the folder.
fn others(dir: &Path, me: &str) -> Vec<PathBuf> {
    let mine = sm::device_file(me);
    std::fs::read_dir(dir)
        .map(|it| {
            it.filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "musicsync"))
                .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| Some(n) != mine.as_deref()))
                .collect()
        })
        .unwrap_or_default()
}

/// This PC's snapshot. Secrets only when `sealed` (protected file, or the network's code-keyed channel).
/// Never from a sync command: `ytm::session` needs the main thread free.
fn snapshot(state: &AppState, device: &str, sealed: bool) -> anyhow::Result<Snapshot> {
    let accounts = Accounts { spotify: state.spotify().is_some_and(|s| s.is_connected()), youtube: ytm::session(&state.app).is_some() };
    let secrets = sealed.then(|| Secrets { spotify_client_id: state.credentials().spotify_client_id, audd_token: state.store.load(AUDD_TOKEN) });
    state.lib().snapshot(device, &device_name(), accounts, secrets)
}

/// What another PC brought: merged in, its secrets fill what's missing here (never replace), the UI reloads.
fn take(app: &AppHandle, s: &Snapshot) -> anyhow::Result<Merged> {
    let state = app.state::<AppState>();
    let merged = state.lib().merge(s)?;
    if let Some(secrets) = &s.secrets {
        let mut creds = state.credentials();
        if creds.spotify_client_id.is_none()
            && let Some(id) = secrets.spotify_client_id.as_ref().filter(|id| id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric()))
        {
            creds = creds.merged_with(Credentials { spotify_client_id: Some(id.clone()) });
            state.store.save("credentials", &creds)?;
            state.cache.status.clear();
        }
        if state.store.load::<String>(AUDD_TOKEN).is_none()
            && let Some(t) = secrets.audd_token.as_ref().filter(|t| t.len() <= 200)
        {
            state.store.save(AUDD_TOKEN, t)?;
        }
    }
    let sync = app.state::<SyncMode>();
    sync.inner.lock().unwrap().devices.insert(s.device.clone(), Device { name: s.device_name.chars().take(60).collect(), at: s.at, accounts: s.accounts.clone() });
    if merged.any() {
        let _ = app.emit_to("main", "sync", &merged);
    }
    Ok(merged)
}

fn hash(s: &Snapshot) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    serde_json::to_string(&Snapshot { at: 0, ..s.clone() }).unwrap_or_default().hash(&mut h);
    h.finish()
}

/// One folder round: other PCs' new files merged, this PC's file written if it changed.
fn folder_round(app: &AppHandle) -> anyhow::Result<Merged> {
    let state = app.state::<AppState>();
    let sync = app.state::<SyncMode>();
    let c = config(&state);
    let Some(folder) = c.folder else { return Ok(Merged::default()) };
    let dir = PathBuf::from(folder).join(DIR);
    let manifest = read_manifest(&dir).ok_or_else(|| anyhow::anyhow!("The sync folder is gone (moved, or OneDrive is off)"))?;
    let key = if manifest.protected { Some(file_key(&state).ok_or_else(|| anyhow::anyhow!("Enter the sync password on this PC"))?) } else { None };
    let mut total = Merged::default();
    for path in others(&dir, &c.device) {
        let Ok(modified) = std::fs::metadata(&path).and_then(|m| m.modified()) else { continue };
        if sync.inner.lock().unwrap().seen.get(&path) == Some(&modified) {
            continue;
        }
        // OneDrive may still be writing it: next round.
        let Ok(bytes) = std::fs::read(&path) else { continue };
        let s = sm::decode(&bytes, key.as_ref())?;
        let m = take(app, &s)?;
        total = Merged { playlists: total.playlists + m.playlists, deleted: total.deleted + m.deleted, songs: total.songs + m.songs, removed: total.removed + m.removed, plays: total.plays + m.plays, edits: total.edits + m.edits, settings: total.settings + m.settings };
        sync.inner.lock().unwrap().seen.insert(path, modified);
    }
    let mine = snapshot(&state, &c.device, key.is_some())?;
    let h = hash(&mine);
    if sync.inner.lock().unwrap().written != Some(h) {
        let name = sm::device_file(&c.device).expect("checked id");
        let tmp = dir.join(format!("{name}.tmp"));
        std::fs::write(&tmp, sm::encode(&mine, key.as_ref())?)?;
        std::fs::rename(&tmp, dir.join(name))?;
        sync.inner.lock().unwrap().written = Some(h);
    }
    Ok(total)
}

async fn round(app: &AppHandle) -> CmdResult<Merged> {
    let sync = app.state::<SyncMode>();
    let _one = sync.running.lock().await;
    let a = app.clone();
    let out = tauri::async_runtime::spawn_blocking(move || folder_round(&a)).await.map_err(err)?;
    let mut inner = sync.inner.lock().unwrap();
    match out {
        Ok(m) => {
            inner.last = Some(now_ms());
            inner.error = None;
            Ok(m)
        }
        Err(e) => {
            inner.error = Some(e.to_string());
            Err(e.to_string())
        }
    }
}

/// Minute timer (folder mode only; idle otherwise).
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST).await;
        loop {
            if config(&app.state::<AppState>()).folder.is_some() {
                let _ = round(&app).await;
            }
            tokio::time::sleep(EVERY).await;
        }
    });
}

#[tauri::command]
pub async fn sync_status(state: State<'_, AppState>, sync: State<'_, SyncMode>) -> CmdResult<Status> {
    let c = config(&state);
    let protected = c.folder.as_ref().and_then(|f| read_manifest(&PathBuf::from(f).join(DIR))).is_some_and(|m| m.protected);
    let onedrive = sm::onedrive_folders(|k| std::env::var(k).ok()).into_iter().filter(|p| p.is_dir()).map(|p| p.display().to_string()).collect();
    let inner = sync.inner.lock().unwrap();
    let mut devices: Vec<Device> = inner.devices.values().cloned().collect();
    devices.sort_by_key(|d| std::cmp::Reverse(d.at));
    Ok(Status { onedrive, folder: c.folder, protected, asked: c.asked, device_name: device_name(), devices, last: inner.last, error: inner.error.clone() })
}

/// Before setting up `folder`: does another PC sync there already, with a password?
#[tauri::command]
pub async fn sync_probe(state: State<'_, AppState>, folder: String) -> CmdResult<Probe> {
    let dir = PathBuf::from(&folder).join(DIR);
    let me = config(&state).device;
    Ok(match read_manifest(&dir) {
        Some(m) => Probe { exists: true, protected: m.protected, devices: others(&dir, &me).len() },
        None => Probe { exists: false, protected: false, devices: 0 },
    })
}

/// Sync through `folder` (made there: `Music App Sync`). New folder: protected if a password is given. Folder used by
/// another PC: its choice holds, the password must match.
#[tauri::command]
pub async fn sync_setup(app: AppHandle, state: State<'_, AppState>, folder: String, password: Option<String>) -> CmdResult<Merged> {
    let root = PathBuf::from(&folder);
    if !root.is_absolute() || !root.is_dir() {
        return Err("This folder can't be found".into());
    }
    let dir = root.join(DIR);
    let password = password.filter(|p| !p.is_empty());
    let (key, first) = match read_manifest(&dir) {
        Some(m) if m.protected => {
            let pw = password.ok_or("This sync folder has a password: enter it")?;
            let key = tauri::async_runtime::spawn_blocking(move || m.unlock(&pw)).await.map_err(err)?.map_err(err)?;
            (Some(key), false)
        }
        Some(_) => (None, others(&dir, &config(&state).device).is_empty()),
        None => {
            std::fs::create_dir_all(&dir).map_err(err)?;
            let (manifest, key) = match password {
                Some(pw) => {
                    let (m, k) = tauri::async_runtime::spawn_blocking(move || Manifest::protected(&pw)).await.map_err(err)?.map_err(err)?;
                    (m, Some(k))
                }
                None => (Manifest::plain(), None),
            };
            std::fs::write(dir.join(MANIFEST), serde_json::to_vec_pretty(&manifest).map_err(err)?).map_err(err)?;
            (key, true)
        }
    };
    match key {
        Some(k) => state.store.save(KEY, &k.iter().map(|b| format!("{b:02x}")).collect::<String>()).map_err(err)?,
        None => state.store.set(KEY, None).map_err(err)?,
    }
    // First PC: its settings are the reference. Joining PCs take the others'.
    if first {
        state.lib().stamp_all_settings(now_ms()).map_err(err)?;
    }
    let mut c = config(&state);
    c.folder = Some(folder);
    c.asked = true;
    save_config(&state, &c)?;
    {
        let sync = app.state::<SyncMode>();
        let mut inner = sync.inner.lock().unwrap();
        inner.seen.clear();
        inner.written = None;
    }
    round(&app).await
}

/// Stops syncing here; files stay in the folder (other PCs keep going).
#[tauri::command]
pub async fn sync_stop(state: State<'_, AppState>, sync: State<'_, SyncMode>) -> CmdResult<()> {
    let mut c = config(&state);
    c.folder = None;
    save_config(&state, &c)?;
    state.store.set(KEY, None).map_err(err)?;
    let mut inner = sync.inner.lock().unwrap();
    inner.error = None;
    inner.seen.clear();
    inner.written = None;
    Ok(())
}

#[tauri::command]
pub async fn sync_now(app: AppHandle) -> CmdResult<Merged> {
    round(&app).await
}

/// "Not now" on the OneDrive question.
#[tauri::command]
pub async fn sync_dismiss(state: State<'_, AppState>) -> CmdResult<()> {
    let mut c = config(&state);
    c.asked = true;
    save_config(&state, &c)
}

/// Network, offering side: a code to type on the other PC. Done (or failed): "sync-offer" event.
/// Async: the snapshot reads WebView2's cookies (YouTube signed in?), which deadlocks on the main thread.
#[tauri::command]
pub async fn sync_offer(app: AppHandle, state: State<'_, AppState>, sync: State<'_, SyncMode>) -> CmdResult<String> {
    // The PC showing the code is the reference for settings never synced before.
    {
        let lib = state.lib();
        if lib.settings_unstamped().map_err(err)? {
            lib.stamp_all_settings(now_ms()).map_err(err)?;
        }
    }
    let mine = sm::pack(&snapshot(&state, &config(&state).device, true).map_err(err)?).map_err(err)?;
    let code = nearby::new_code();
    let c = code.clone();
    let a = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let out = match nearby::sync_serve(&c, &mine).await {
            Ok(theirs) => sm::unpack(&theirs).and_then(|s| take(&a, &s)).map_err(|e| e.to_string()),
            Err(e) => Err(e.to_string()),
        };
        let _ = a.emit_to("main", "sync-offer", out);
    });
    if let Some(old) = sync.offer.lock().unwrap().replace(task) {
        old.abort();
    }
    Ok(code)
}

#[tauri::command]
pub fn sync_offer_stop(sync: State<SyncMode>) {
    if let Some(t) = sync.offer.lock().unwrap().take() {
        t.abort();
    }
}

/// Network, joining side: the code shown on the other PC.
#[tauri::command]
pub async fn sync_join(app: AppHandle, state: State<'_, AppState>, code: String) -> CmdResult<Merged> {
    let mine = sm::pack(&snapshot(&state, &config(&state).device, true).map_err(err)?).map_err(err)?;
    let theirs = nearby::sync_join(code.trim(), &mine).await.map_err(err)?;
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || sm::unpack(&theirs).and_then(|s| take(&a, &s))).await.map_err(err)?.map_err(err)
}
