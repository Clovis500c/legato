//! Updates in the background: checked a few seconds after every launch, when the window comes back from the tray after
//! an hour, and every 6 hours; downloaded quietly when automatic updates are on (else only announced), installed when
//! the UI says it won't cut the music: between two songs or when nothing plays (or the user asks). The installer runs silently and starts the app again; the UI then reopens
//! where it was (session, screen, paused or not).
//! Two channels (Settings › General › Updates): Stable, promoted by hand (`promote.yml`), and Beta, every green push
//! (`release.yml`). Each has its own `latest.json`, same signature key.

use crate::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const FIRST_CHECK: Duration = Duration::from_secs(5);
/// Back from the tray: checked again if the last check is older.
const STALE: i64 = 3600;
const EVERY: Duration = Duration::from_secs(6 * 3600);
/// Settings key: the update being installed, then the last one installed.
const KEY: &str = "update";
/// Beta's file: the rolling `beta` release, whose latest.json `release.yml` replaces at every release. Stable's is
/// `tauri.conf.json`'s endpoint (`releases/latest/download/latest.json`, which skips prereleases): every installed
/// version reads it, so it stays.
const BETA_ENDPOINT: &str = "https://github.com/Clovis500c/legato/releases/download/beta/latest.json";

/// Which releases this PC follows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    Stable,
    Beta,
}

impl Channel {
    /// From the interface's settings object (`updateChannel`). Stable unless it says "beta": older saves, bad values.
    pub fn from_ui(ui: Option<&serde_json::Value>) -> Self {
        match ui.and_then(|u| u.get("updateChannel")?.as_str()) {
            Some("beta") => Self::Beta,
            _ => Self::Stable,
        }
    }

    /// Where this channel's latest.json is; None: the endpoint of `tauri.conf.json` (Stable).
    fn endpoint(self) -> Option<&'static str> {
        match self {
            Self::Stable => None,
            Self::Beta => Some(BETA_ENDPOINT),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, ts_rs::TS)]
#[serde(tag = "state", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[ts(export, rename = "UpdateState")]
pub enum State {
    #[default]
    Idle,
    Checking,
    UpToDate,
    /// Found, not downloaded: automatic updates are off.
    Available { version: String, notes: Option<String> },
    Downloading { version: String, percent: u8 },
    /// Downloaded, waits for a quiet moment.
    Ready { version: String, notes: Option<String> },
    Installing { version: String },
    Error { message: String },
}

/// One update installed: from which version, to which, when (unix s).
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "UpdateInstalled")]
pub struct Installed {
    pub from: String,
    pub to: String,
    pub at: i64,
    /// Release notes of `to`, for "What's new" after the restart. Older saves: none.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    /// Written right before the installer runs.
    pending: Option<Installed>,
    last: Option<Installed>,
    /// Window was in the tray when the installer ran: the new version starts there too.
    #[serde(default)]
    hidden: bool,
}

#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "UpdateStatus")]
pub struct Status {
    pub current: String,
    #[serde(flatten)]
    pub state: State,
    pub last_check: Option<i64>,
    pub last_update: Option<Installed>,
    /// This launch is the first after an update: the UI restores everything as it was.
    pub just_updated: bool,
}

pub struct Updater {
    status: Mutex<Status>,
    ready: Mutex<Option<(Update, Vec<u8>)>>,
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

fn saved(app: &AppHandle) -> Saved {
    app.try_state::<AppState>().and_then(|s| s.lib().setting(KEY).ok().flatten()).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

fn save(app: &AppHandle, s: &Saved) {
    if let (Some(state), Ok(v)) = (app.try_state::<AppState>(), serde_json::to_value(s)) {
        let _ = state.lib().set_setting(KEY, &v);
    }
}

impl Updater {
    /// After the library is managed: reads what the last run was installing.
    pub fn new(app: &AppHandle) -> Self {
        let current = app.package_info().version.to_string();
        let mut s = saved(app);
        // Pending and now running its version: it went in.
        let just_updated = s.pending.as_ref().is_some_and(|p| p.to == current);
        if let Some(p) = s.pending.take() {
            if p.to == current {
                s.last = Some(p);
            }
            save(app, &s);
        }
        Self { status: Mutex::new(Status { current, state: State::Idle, last_check: None, last_update: s.last, just_updated }), ready: Mutex::default() }
    }

    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }

    /// The status once `state` is in (the caller tells the interface).
    fn put(&self, state: State) -> Status {
        let mut s = self.status.lock().unwrap();
        s.state = state;
        s.clone()
    }

    fn set(&self, app: &AppHandle, state: State) {
        let _ = app.emit("update", self.put(state));
    }

    /// The error About shows, kept in the diagnostics log too (`phase` = check, download or install).
    fn failed(&self, app: &AppHandle, phase: &str, message: String) {
        crate::diag::warn("update", &format!("{phase} failed"), &message);
        self.set(app, State::Error { message });
    }

    /// Check, then download what's new (download = false: only announce it). Busy or already downloaded: nothing.
    pub async fn check(&self, app: &AppHandle, download: bool) {
        // A guest build (bench, say) never reaches for updates; a dev build only when asked from About, and it can't install
        // (`install` ends in an error then).
        if !crate::identity::installed() && !cfg!(debug_assertions) {
            return self.set(app, State::Error { message: "Updates only run in the installed app".into() });
        }
        {
            let mut s = self.status.lock().unwrap();
            if matches!(s.state, State::Checking | State::Downloading { .. } | State::Ready { .. } | State::Installing { .. }) {
                return;
            }
            s.last_check = Some(now());
        }
        loop {
            let channel = channel_of(app);
            self.run(app, download, channel).await;
            // Switched meanwhile: what it found or downloaded is the other channel's. Dropped, then again.
            if channel == channel_of(app) || matches!(self.status().state, State::Installing { .. }) {
                return;
            }
            *self.ready.lock().unwrap() = None;
        }
    }

    /// One pass on one channel; ends with the state it reached (up to date, available, ready or error).
    async fn run(&self, app: &AppHandle, download: bool, channel: Channel) {
        self.set(app, State::Checking);
        let found = match updater_for(app, channel) {
            Ok(u) => u.check().await,
            Err(e) => Err(e),
        };
        let update = match found {
            Ok(Some(u)) => u,
            Ok(None) => return self.set(app, State::UpToDate),
            Err(e) => return self.failed(app, "check", e.to_string()),
        };
        let version = update.version.clone();
        if !download {
            return self.set(app, State::Available { version, notes: update.body.clone() });
        }
        self.set(app, State::Downloading { version: version.clone(), percent: 0 });
        let (mut got, mut shown) = (0usize, 0u8);
        let bytes = update
            .download(
                |chunk, total| {
                    got += chunk;
                    let percent = total.filter(|t| *t > 0).map_or(0, |t| (got as u64 * 100 / t).min(100) as u8);
                    // A message per 5 %, not per chunk.
                    if percent >= shown + 5 {
                        shown = percent;
                        self.set(app, State::Downloading { version: version.clone(), percent });
                    }
                },
                || {},
            )
            .await;
        match bytes {
            Ok(bytes) => {
                let notes = update.body.clone();
                *self.ready.lock().unwrap() = Some((update, bytes));
                self.set(app, State::Ready { version, notes });
            }
            Err(e) => self.failed(app, "download", e.to_string()),
        }
    }

    /// The channel setting changed (`save_settings`): an update found or downloaded came from the other channel, so it
    /// goes and the new one is checked now, for the status to follow. A pass running sees the change when it ends.
    pub fn switched(&self, app: &AppHandle) {
        // Debug builds only check when asked; guest builds never.
        if cfg!(debug_assertions) || !crate::identity::installed() {
            return;
        }
        {
            let mut s = self.status.lock().unwrap();
            if matches!(s.state, State::Checking | State::Downloading { .. } | State::Installing { .. }) {
                return;
            }
            s.state = State::Idle;
        }
        *self.ready.lock().unwrap() = None;
        let app = app.clone();
        tauri::async_runtime::spawn(async move { app.state::<Updater>().check(&app, automatic(&app)).await });
    }

    /// An install asked of a build that is not the installed app: the installer is the real app's. Out of Ready, like a
    /// failed install: the interface installs a Ready update at the first quiet moment and would ask every 5 s. The download
    /// goes too, nothing here can run it.
    fn refuse(&self) -> (Status, String) {
        let message = String::from("Updates install from the installed app only");
        crate::diag::warn("update", "install refused", &message);
        *self.ready.lock().unwrap() = None;
        (self.put(State::Error { message: message.clone() }), message)
    }

    /// Runs the downloaded installer (silent), which closes the app and starts it again.
    pub fn install(&self, app: &AppHandle) -> Result<(), String> {
        // The installer is the real app's: no other build may run it.
        if !crate::identity::installed() {
            let (status, message) = self.refuse();
            let _ = app.emit("update", status);
            return Err(message);
        }
        let (update, bytes) = self.ready.lock().unwrap().take().ok_or("No update downloaded")?;
        let current = self.status().current;
        let hidden = app.get_window("main").is_some_and(|w| !w.is_visible().unwrap_or(true));
        save(app, &Saved { pending: Some(Installed { from: current, to: update.version.clone(), at: now(), notes: update.body.clone() }), last: self.status().last_update, hidden });
        self.set(app, State::Installing { version: update.version.clone() });
        // Windows installer ends the process: no exit event.
        crate::window_place::save(app);
        if let Err(e) = update.install(&bytes) {
            let message = e.to_string();
            *self.ready.lock().unwrap() = Some((update, bytes));
            self.failed(app, "install", message.clone());
            return Err(message);
        }
        // Not Windows: the new version is in place, start it.
        app.restart();
    }
}

/// Launch right after an update installed from the tray: stay there (before `Updater::new`, which clears the record).
pub fn back_to_tray(lib: &music_core::library::Library, current: &str) -> bool {
    let s: Saved = lib.setting(KEY).ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    s.hidden && s.pending.is_some_and(|p| p.to == current)
}

/// Settings › About › Automatic updates (UI settings, on by default).
fn automatic(app: &AppHandle) -> bool {
    app.try_state::<AppState>().and_then(|s| s.lib().setting("ui").ok().flatten()).and_then(|u| u.get("autoUpdate")?.as_bool()).unwrap_or(true)
}

/// Settings › General › Updates (UI settings, Stable unless Beta was picked).
fn channel_of(app: &AppHandle) -> Channel {
    Channel::from_ui(app.try_state::<AppState>().and_then(|s| s.lib().setting("ui").ok().flatten()).as_ref())
}

/// The updater of a channel: Stable as `tauri.conf.json` has it, Beta with its own file. The plugin's default
/// comparator only takes a version newer than the installed one, so going back from Beta to Stable never downgrades:
/// the app stays on its beta until a Stable passes it.
fn updater_for(app: &AppHandle, channel: Channel) -> tauri_plugin_updater::Result<tauri_plugin_updater::Updater> {
    match channel.endpoint() {
        None => app.updater(),
        Some(url) => app.updater_builder().endpoints(vec![url.parse::<tauri::Url>()?])?.build(),
    }
}

/// Background checks. Debug builds only check when asked (Settings › About); guest builds (`identity.rs`) never.
pub fn spawn(app: AppHandle) {
    if cfg!(debug_assertions) || !crate::identity::installed() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            app.state::<Updater>().check(&app, automatic(&app)).await;
            tokio::time::sleep(EVERY).await;
        }
    });
}

/// Window back from the tray: "at every opening", without waiting for the 6-hour round.
pub fn check_if_stale(app: &AppHandle) {
    let Some(updater) = app.try_state::<Updater>() else { return };
    if cfg!(debug_assertions) || !crate::identity::installed() || updater.status().last_check.is_some_and(|t| now() - t < STALE) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move { app.state::<Updater>().check(&app, automatic(&app)).await });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn older_saves_load_without_notes() {
        let s: Saved = serde_json::from_str(r#"{"pending":null,"last":{"from":"0.1.246","to":"0.1.270","at":1}}"#).unwrap();
        assert_eq!(s.last.unwrap().notes, None);
        let s: Saved = serde_json::from_str(r#"{"last":{"from":"a","to":"b","at":1,"notes":"feat: x"}}"#).unwrap();
        assert_eq!(s.last.unwrap().notes.as_deref(), Some("feat: x"));
    }

    #[test]
    fn channel_comes_from_the_ui_setting_and_defaults_to_stable() {
        let ui = |v: serde_json::Value| Channel::from_ui(Some(&v));
        assert_eq!(Channel::from_ui(None), Channel::Stable, "nothing saved");
        assert_eq!(ui(serde_json::json!({})), Channel::Stable, "saved before channels");
        assert_eq!(ui(serde_json::json!({ "updateChannel": "stable" })), Channel::Stable);
        assert_eq!(ui(serde_json::json!({ "updateChannel": "beta" })), Channel::Beta);
        assert_eq!(ui(serde_json::json!({ "updateChannel": "nightly" })), Channel::Stable, "unknown name");
        assert_eq!(ui(serde_json::json!({ "updateChannel": true })), Channel::Stable, "wrong type");
    }

    #[test]
    fn stable_keeps_the_endpoint_installed_versions_read() {
        // CLAUDE.md: installed versions read this URL, and GitHub's `latest` skips prereleases: it stays Stable's.
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["plugins"]["updater"]["endpoints"], serde_json::json!(["https://github.com/Clovis500c/legato/releases/latest/download/latest.json"]));
        assert_eq!(Channel::Stable.endpoint(), None, "Stable reads the configured endpoint");
    }

    #[test]
    fn beta_reads_the_rolling_beta_release_that_the_workflow_feeds() {
        let url = Channel::Beta.endpoint().unwrap();
        assert_eq!(url, "https://github.com/Clovis500c/legato/releases/download/beta/latest.json");
        assert!(url.parse::<tauri::Url>().is_ok());
        // A push must reach Beta only: releases are prereleases (GitHub's latest skips them) and feed that release.
        let release = include_str!("../../.github/workflows/release.yml");
        assert!(release.contains("prerelease: true") && !release.contains("prerelease: false"), "a normal release would reach Stable");
        assert!(release.contains("gh release upload beta "), "nothing feeds Beta's file");
    }

    #[test]
    fn back_to_tray_only_right_after_an_update_from_there() {
        let lib = music_core::library::Library::in_memory().unwrap();
        assert!(!back_to_tray(&lib, "0.2.0"), "nothing saved");
        let pending = |hidden| serde_json::json!({ "pending": { "from": "0.1.0", "to": "0.2.0", "at": 1 }, "last": null, "hidden": hidden });
        lib.set_setting(KEY, &pending(true)).unwrap();
        assert!(back_to_tray(&lib, "0.2.0"));
        assert!(!back_to_tray(&lib, "0.1.0"), "install failed: old version runs");
        lib.set_setting(KEY, &pending(false)).unwrap();
        assert!(!back_to_tray(&lib, "0.2.0"), "window was on screen");
    }

    #[test]
    fn a_refused_install_leaves_ready() {
        // A debug guest reaches Ready (About's button downloads) and cannot install. Left in Ready, the interface asked
        // again every 5 s, a toast each time, and held the music back between two songs.
        let ready = Status { current: "1.0.0".into(), state: State::Ready { version: "1.0.9".into(), notes: None }, last_check: Some(1), last_update: None, just_updated: false };
        let updater = Updater { status: Mutex::new(ready), ready: Mutex::default() };
        let (told, message) = updater.refuse();
        assert_eq!(message, "Updates install from the installed app only");
        assert!(matches!(&told.state, State::Error { message: m } if *m == message), "told: {:?}", told.state);
        assert!(matches!(&updater.status().state, State::Error { message: m } if *m == message), "kept: {:?}", updater.status().state);
        assert!(updater.ready.lock().unwrap().is_none(), "the download is dropped");
        // Asked again: the same, nothing comes back to Ready by itself.
        assert!(matches!(updater.refuse().0.state, State::Error { .. }));
    }
}
