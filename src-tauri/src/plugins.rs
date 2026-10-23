//! Third-party plugins, shell side: the plugins folder (`<app data>\plugins\<id>`), install (a checked copy of the
//! folder the user picked, after they approved its permissions), on / off, and the bridge. Calls a plugin makes come
//! here already permission-checked (`music_plugins`): its storage, the library and the network gateway are answered
//! in Rust; player, menus, panel, style and Live Editor go to the interface ("plugin-call", answered by
//! `plugin_reply`). Logic: `crates/plugins`.

use crate::{AppState, CmdResult, err};
use music_plugins::net::{Gateway, Request};
use music_plugins::{Call, Manifest, Outbox, Permission, Route, Running};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// Library settings row: each plugin's on / off and approved permissions.
const REGISTRY: &str = "plugins";
const MAX_FILES: usize = 50;
const MAX_SIZE: u64 = 5 << 20;
const MAX_SCRIPT: u64 = 2 << 20;
const FILE_KINDS: [&str; 6] = ["js", "json", "md", "txt", "png", "css"];
const MAX_STORAGE: usize = 1 << 20;
const LOG_LINES: usize = 200;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    on: bool,
    granted: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    id: String,
    manifest: Option<Manifest>,
    on: bool,
    running: bool,
    granted: Vec<String>,
    /// Broken plugin.json, or why it stopped.
    error: Option<String>,
    folder: String,
}

/// A folder before installing it: what it is and what it asks for.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspect {
    manifest: Manifest,
    /// Version installed now (an update).
    installed: Option<String>,
    /// Permissions not approved before (all of them for a new plugin).
    new_permissions: Vec<String>,
    files: usize,
    size: u64,
}

#[derive(Default)]
pub struct Plugins {
    running: Mutex<HashMap<String, Running>>,
    errors: Mutex<HashMap<String, String>>,
    logs: Mutex<HashMap<String, VecDeque<String>>>,
    gateway: Gateway,
}

fn dir(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(app.path().app_data_dir().map_err(err)?.join("plugins"))
}

fn registry(state: &AppState) -> HashMap<String, Entry> {
    state.lib().setting(REGISTRY).ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

fn save_registry(state: &AppState, r: &HashMap<String, Entry>) -> CmdResult<()> {
    state.lib().set_setting(REGISTRY, &json!(r)).map_err(err)
}

fn read_manifest(folder: &Path) -> anyhow::Result<Manifest> {
    let text = std::fs::read_to_string(folder.join("plugin.json")).map_err(|_| anyhow::anyhow!("No plugin.json in this folder"))?;
    Manifest::parse(&text)
}

/// The files that would be copied: plain files of known kinds, flat, bounded.
fn files(folder: &Path, m: &Manifest) -> anyhow::Result<Vec<(PathBuf, u64)>> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(folder)? {
        let e = e?;
        let meta = std::fs::symlink_metadata(e.path())?;
        let kind_ok = e.path().extension().and_then(|x| x.to_str()).is_some_and(|x| FILE_KINDS.contains(&x.to_lowercase().as_str()));
        if meta.is_file() && kind_ok {
            out.push((e.path(), meta.len()));
        }
    }
    anyhow::ensure!(out.len() <= MAX_FILES, "Too many files (over {MAX_FILES})");
    anyhow::ensure!(out.iter().map(|(_, s)| s).sum::<u64>() <= MAX_SIZE, "Plugin over 5 MB");
    let main = out.iter().find(|(p, _)| p.file_name().and_then(|n| n.to_str()) == Some(m.main.as_str())).ok_or_else(|| anyhow::anyhow!("{} is missing", m.main))?;
    anyhow::ensure!(main.1 <= MAX_SCRIPT, "{} is over 2 MB", m.main);
    Ok(out)
}

/// Bridge for one app: calls out, logs kept, stops told to the interface.
struct Bridge(AppHandle);

impl Outbox for Bridge {
    fn call(&self, call: Call) {
        let app = self.0.clone();
        if call.route == Route::Ui {
            let _ = app.emit_to("main", "plugin-call", json!({ "plugin": call.plugin, "id": call.id, "method": call.method, "args": call.args }));
            return;
        }
        tauri::async_runtime::spawn(async move {
            let result = shell_call(&app, &call).await;
            if let Some(p) = app.state::<Plugins>().running.lock().unwrap().get(&call.plugin) {
                p.reply(call.id, result);
            }
        });
    }

    fn log(&self, plugin: &str, level: &str, text: &str) {
        let plugins = self.0.state::<Plugins>();
        let mut logs = plugins.logs.lock().unwrap();
        let lines = logs.entry(plugin.to_string()).or_default();
        if lines.len() >= LOG_LINES {
            lines.pop_front();
        }
        lines.push_back(format!("{level}: {}", text.chars().take(2000).collect::<String>()));
    }

    fn stopped(&self, plugin: &str, error: Option<String>) {
        let plugins = self.0.state::<Plugins>();
        if let Some(e) = &error {
            plugins.errors.lock().unwrap().insert(plugin.to_string(), e.clone());
            self.log(plugin, "error", e);
        }
        // Its thread ended by itself (error): forget it, the interface drops its menus and panel.
        if error.is_some() {
            plugins.running.lock().unwrap().remove(plugin);
        }
        let _ = self.0.emit_to("main", "plugin-state", plugin);
    }
}

fn storage_key(id: &str) -> String {
    format!("plugin:{id}")
}

/// Calls answered on the Rust side: the plugin's own storage, the library, the network.
async fn shell_call(app: &AppHandle, call: &Call) -> Result<Value, String> {
    let state = app.state::<AppState>();
    let a = &call.args;
    let key = || a["key"].as_str().filter(|k| !k.is_empty() && k.len() <= 100).map(String::from).ok_or_else(|| "storage: key must be 1-100 characters".to_string());
    match call.method.as_str() {
        "storage.get" | "storage.set" | "storage.remove" | "storage.keys" => {
            let lib = state.lib();
            let mut store = lib.setting(&storage_key(&call.plugin)).ok().flatten().and_then(|v| v.as_object().cloned()).unwrap_or_default();
            match call.method.as_str() {
                "storage.get" => Ok(store.get(&key()?).cloned().unwrap_or(Value::Null)),
                "storage.keys" => Ok(json!(store.keys().collect::<Vec<_>>())),
                m => {
                    if m == "storage.set" {
                        store.insert(key()?, a["value"].clone());
                    } else {
                        store.remove(&key()?);
                    }
                    let v = Value::Object(store);
                    if v.to_string().len() > MAX_STORAGE {
                        return Err("storage: over 1 MB for this plugin".into());
                    }
                    lib.set_setting(&storage_key(&call.plugin), &v).map_err(err)?;
                    Ok(Value::Null)
                }
            }
        }
        "library.tracks" => {
            let tracks = state.lib().tracks().map_err(err)?;
            Ok(json!(tracks.iter().map(track_json).collect::<Vec<_>>()))
        }
        "library.playlists" => {
            let lists = state.lib().playlists().map_err(err)?;
            Ok(json!(lists.iter().map(|p| json!({ "id": p.id, "name": p.name, "custom": p.custom, "source": p.source, "trackCount": p.track_count })).collect::<Vec<_>>()))
        }
        "library.playlist" => {
            let id = a["id"].as_i64().ok_or("library.playlist: id")?;
            let lib = state.lib();
            let p = lib.playlists().map_err(err)?.into_iter().find(|p| p.id == id).ok_or("No such playlist")?;
            let tracks = lib.playlist_tracks(id).map_err(err)?;
            Ok(json!({ "id": p.id, "name": p.name, "custom": p.custom, "tracks": tracks.iter().map(track_json).collect::<Vec<_>>() }))
        }
        "net.fetch" => {
            let req: Request = serde_json::from_value(a.clone()).map_err(|_| "net.fetch: bad request".to_string())?;
            app.state::<Plugins>().gateway.fetch(&req).await.map(|r| json!(r)).map_err(|e| e.to_string())
        }
        m => Err(format!("Unknown method: {m}")),
    }
}

/// A song as plugins see it: no local file path.
fn track_json(t: &music_core::library::LibraryTrack) -> Value {
    let sources: Vec<&str> = t.track.ids.keys().map(|s| s.as_str()).collect();
    json!({ "id": t.id, "title": t.track.title, "artist": t.track.artist, "album": t.track.album, "durationMs": t.track.duration_ms, "sources": sources })
}

fn start(app: &AppHandle, id: &str, granted: &[String]) -> CmdResult<()> {
    let folder = dir(app)?.join(id);
    let m = read_manifest(&folder).map_err(err)?;
    let code = std::fs::read_to_string(folder.join(&m.main)).map_err(err)?;
    // Only what was approved and is still asked for.
    let granted: Vec<Permission> = m.permissions().into_iter().filter(|p| granted.contains(&p.as_string())).collect();
    let plugins = app.state::<Plugins>();
    plugins.errors.lock().unwrap().remove(id);
    let running = Running::start(m, granted, code, &app.package_info().version.to_string(), Arc::new(Bridge(app.clone())));
    plugins.running.lock().unwrap().insert(id.to_string(), running);
    Ok(())
}

fn stop(app: &AppHandle, id: &str) {
    // Dropping it stops its thread.
    app.state::<Plugins>().running.lock().unwrap().remove(id);
    let _ = app.emit_to("main", "plugin-state", id);
}

/// At launch: the plugins left on.
pub fn start_all(app: &AppHandle) {
    let state = app.state::<AppState>();
    for (id, e) in registry(&state) {
        if e.on
            && let Err(error) = start(app, &id, &e.granted)
        {
            app.state::<Plugins>().errors.lock().unwrap().insert(id, error);
        }
    }
}

#[tauri::command]
pub async fn plugins_list(app: AppHandle, state: State<'_, AppState>, plugins: State<'_, Plugins>) -> CmdResult<Vec<PluginInfo>> {
    let reg = registry(&state);
    let root = dir(&app)?;
    let mut out = Vec::new();
    for e in std::fs::read_dir(&root).into_iter().flatten().flatten() {
        let Some(id) = e.file_name().to_str().map(String::from) else { continue };
        if !e.path().is_dir() {
            continue;
        }
        let entry = reg.get(&id).cloned().unwrap_or_default();
        let (manifest, broken) = match read_manifest(&e.path()) {
            Ok(m) => (Some(m), None),
            Err(e) => (None, Some(e.to_string())),
        };
        out.push(PluginInfo {
            running: plugins.running.lock().unwrap().contains_key(&id),
            error: broken.or_else(|| plugins.errors.lock().unwrap().get(&id).cloned()),
            folder: e.path().display().to_string(),
            on: entry.on,
            granted: entry.granted,
            manifest,
            id,
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

#[tauri::command]
pub async fn plugin_inspect(app: AppHandle, state: State<'_, AppState>, folder: String) -> CmdResult<Inspect> {
    let folder = PathBuf::from(folder);
    let m = read_manifest(&folder).map_err(err)?;
    let files = files(&folder, &m).map_err(err)?;
    let installed = read_manifest(&dir(&app)?.join(&m.id)).ok().map(|x| x.version);
    let granted = registry(&state).get(&m.id).map(|e| e.granted.clone()).unwrap_or_default();
    Ok(Inspect { new_permissions: m.permissions.iter().filter(|p| !granted.contains(p)).cloned().collect(), installed, files: files.len(), size: files.iter().map(|(_, s)| s).sum(), manifest: m })
}

/// Installs (or updates) the plugin in `folder`, its permissions approved by the user, and turns it on.
#[tauri::command]
pub async fn plugin_install(app: AppHandle, state: State<'_, AppState>, folder: String) -> CmdResult<String> {
    let folder = PathBuf::from(folder);
    let m = read_manifest(&folder).map_err(err)?;
    let files = files(&folder, &m).map_err(err)?;
    let target = dir(&app)?.join(&m.id);
    if folder.canonicalize().ok() == target.canonicalize().ok() {
        return Err("This is the installed copy".into());
    }
    stop(&app, &m.id);
    let tmp = dir(&app)?.join(format!(".{}.new", m.id));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(err)?;
    for (path, _) in &files {
        std::fs::copy(path, tmp.join(path.file_name().expect("file"))).map_err(err)?;
    }
    let _ = std::fs::remove_dir_all(&target);
    std::fs::rename(&tmp, &target).map_err(err)?;
    let mut reg = registry(&state);
    reg.insert(m.id.clone(), Entry { on: true, granted: m.permissions.clone() });
    save_registry(&state, &reg)?;
    start(&app, &m.id, &m.permissions)?;
    Ok(m.id)
}

#[tauri::command]
pub async fn plugin_set(app: AppHandle, state: State<'_, AppState>, id: String, on: bool) -> CmdResult<()> {
    let mut reg = registry(&state);
    let entry = reg.get_mut(&id).ok_or("Plugin not installed")?;
    entry.on = on;
    let granted = entry.granted.clone();
    save_registry(&state, &reg)?;
    if on {
        start(&app, &id, &granted)
    } else {
        stop(&app, &id);
        Ok(())
    }
}

/// Removes the plugin, its storage and its log.
#[tauri::command]
pub async fn plugin_uninstall(app: AppHandle, state: State<'_, AppState>, plugins: State<'_, Plugins>, id: String) -> CmdResult<()> {
    stop(&app, &id);
    let mut reg = registry(&state);
    reg.remove(&id);
    save_registry(&state, &reg)?;
    state.lib().set_setting(&storage_key(&id), &Value::Null).map_err(err)?;
    plugins.logs.lock().unwrap().remove(&id);
    plugins.errors.lock().unwrap().remove(&id);
    let target = dir(&app)?.join(&id);
    if target.parent() == Some(dir(&app)?.as_path()) {
        let _ = std::fs::remove_dir_all(target);
    }
    Ok(())
}

/// The interface's answer to a "plugin-call".
#[tauri::command]
pub fn plugin_reply(plugins: State<Plugins>, plugin: String, id: u64, ok: bool, value: Option<Value>, error: Option<String>) {
    if let Some(p) = plugins.running.lock().unwrap().get(&plugin) {
        p.reply(id, if ok { Ok(value.unwrap_or(Value::Null)) } else { Err(error.unwrap_or_else(|| "Failed".into())) });
    }
}

/// An app event for every plugin allowed to hear it (track, playing).
#[tauri::command]
pub fn plugin_event(plugins: State<Plugins>, name: String, payload: Value) {
    if !["track", "playing"].contains(&name.as_str()) {
        return;
    }
    for p in plugins.running.lock().unwrap().values() {
        p.event(&name, payload.clone());
    }
}

/// One plugin's menu item or panel control was used.
#[tauri::command]
pub fn plugin_input(plugins: State<Plugins>, plugin: String, name: String, payload: Value) {
    if !["command", "panel"].contains(&name.as_str()) {
        return;
    }
    if let Some(p) = plugins.running.lock().unwrap().get(&plugin) {
        p.event(&name, payload);
    }
}

#[tauri::command]
pub fn plugin_log(plugins: State<Plugins>, id: String) -> Vec<String> {
    plugins.logs.lock().unwrap().get(&id).map(|l| l.iter().cloned().collect()).unwrap_or_default()
}
