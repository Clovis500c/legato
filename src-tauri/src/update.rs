//! Updates in the background: checked after launch and every 6 hours, downloaded quietly, installed when the UI says
//! nothing plays (or the user asks). The installer runs silently and starts the app again; the UI then reopens
//! where it was (session, screen, paused or not).

use crate::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const FIRST_CHECK: Duration = Duration::from_secs(20);
const EVERY: Duration = Duration::from_secs(6 * 3600);
/// Settings key: the update being installed, then the last one installed.
const KEY: &str = "update";

#[derive(Debug, Clone, Default, Serialize)]
#[serde(tag = "state", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum State {
    #[default]
    Idle,
    Checking,
    UpToDate,
    Downloading { version: String, percent: u8 },
    /// Downloaded, waits for a quiet moment.
    Ready { version: String, notes: Option<String> },
    Installing { version: String },
    Error { message: String },
}

/// One update installed: from which version, to which, when (unix s).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub from: String,
    pub to: String,
    pub at: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    /// Written right before the installer runs.
    pending: Option<Installed>,
    last: Option<Installed>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
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
    app.try_state::<AppState>().and_then(|s| s.lib.lock().unwrap().setting(KEY).ok().flatten()).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

fn save(app: &AppHandle, s: &Saved) {
    if let (Some(state), Ok(v)) = (app.try_state::<AppState>(), serde_json::to_value(s)) {
        let _ = state.lib.lock().unwrap().set_setting(KEY, &v);
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

    fn set(&self, app: &AppHandle, state: State) {
        let status = {
            let mut s = self.status.lock().unwrap();
            s.state = state;
            s.clone()
        };
        let _ = app.emit("update", status);
    }

    /// Check, then download what's new. Busy or already downloaded: nothing.
    pub async fn check(&self, app: &AppHandle) {
        {
            let mut s = self.status.lock().unwrap();
            if matches!(s.state, State::Checking | State::Downloading { .. } | State::Ready { .. } | State::Installing { .. }) {
                return;
            }
            s.last_check = Some(now());
        }
        self.set(app, State::Checking);
        let found = match app.updater() {
            Ok(u) => u.check().await,
            Err(e) => Err(e),
        };
        let update = match found {
            Ok(Some(u)) => u,
            Ok(None) => return self.set(app, State::UpToDate),
            Err(e) => return self.set(app, State::Error { message: e.to_string() }),
        };
        let version = update.version.clone();
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
            Err(e) => self.set(app, State::Error { message: e.to_string() }),
        }
    }

    /// Runs the downloaded installer (silent), which closes the app and starts it again.
    pub fn install(&self, app: &AppHandle) -> Result<(), String> {
        let (update, bytes) = self.ready.lock().unwrap().take().ok_or("No update downloaded")?;
        let current = self.status().current;
        save(app, &Saved { pending: Some(Installed { from: current, to: update.version.clone(), at: now() }), last: self.status().last_update });
        self.set(app, State::Installing { version: update.version.clone() });
        // Windows installer ends the process: no exit event.
        crate::window_place::save(app);
        if let Err(e) = update.install(&bytes) {
            let message = e.to_string();
            *self.ready.lock().unwrap() = Some((update, bytes));
            self.set(app, State::Error { message: message.clone() });
            return Err(message);
        }
        // Not Windows: the new version is in place, start it.
        app.restart();
    }
}

/// Background checks. Debug builds only check when asked (Settings › About).
pub fn spawn(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            app.state::<Updater>().check(&app).await;
            tokio::time::sleep(EVERY).await;
        }
    });
}
