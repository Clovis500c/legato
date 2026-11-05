//! The phone's twin of `update.rs` (Tauri's updater is desktop only): Beta's latest.json checked a few seconds after
//! launch and every 6 hours, only announced; the APK downloaded when the user asks (mobile data), then handed to
//! Android's installer (`ApkInstall.kt` over JNI), which asks them. Its new version starts as the old one left
//! (`just_updated`). Same status as the PC's: Settings › About and `updates.ts` read both. The phone follows Beta: only
//! Betas carry an APK (`music_connectors::apk`).

use crate::{AppState, CmdResult};
use jni::JavaVM;
use jni::objects::{JObject, JString, JValue};
use music_connectors::apk::{Apk, Found};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const FIRST_CHECK: Duration = Duration::from_secs(5);
const EVERY: Duration = Duration::from_secs(6 * 3600);
/// Settings key: the update handed to the installer, then the last one installed (the PC's record).
const KEY: &str = "update";
const CLASS: &str = "app.legato.mobile.ApkInstall";

// The PC's shapes (`update.rs`, the interface's `UpdateStatus`).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(tag = "state", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum State {
    #[default]
    Idle,
    Checking,
    UpToDate,
    Available { version: String, notes: Option<String> },
    Downloading { version: String, percent: u8 },
    Ready { version: String, notes: Option<String> },
    Error { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub from: String,
    pub to: String,
    pub at: i64,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
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
    pub just_updated: bool,
}

pub struct Updater {
    status: Mutex<Status>,
    /// The newest found, and its APK once downloaded.
    found: Mutex<Option<(Found, Option<PathBuf>)>>,
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

/// Downloaded APKs: in the cache, which `file_paths.xml` lets Android's installer read.
fn folder(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_cache_dir().ok().map(|d| d.join("updates"))
}

impl Updater {
    /// After the library is managed: what the last run handed to the installer, and whether it went in.
    pub fn new(app: &AppHandle) -> Self {
        let current = app.package_info().version.to_string();
        let mut s = saved(app);
        let just_updated = s.pending.as_ref().is_some_and(|p| p.to == current);
        if let Some(p) = s.pending.take() {
            if p.to == current {
                s.last = Some(p);
                // Its APK has done its job.
                if let Some(dir) = folder(app) {
                    let _ = std::fs::remove_dir_all(dir);
                }
            }
            save(app, &s);
        }
        Self { status: Mutex::new(Status { current, state: State::Idle, last_check: None, last_update: s.last, just_updated }), found: Mutex::default() }
    }

    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }

    fn set(&self, app: &AppHandle, state: State) {
        let s = {
            let mut s = self.status.lock().unwrap();
            s.state = state;
            s.clone()
        };
        let _ = app.emit("update", s);
    }

    fn failed(&self, app: &AppHandle, phase: &str, message: String) {
        crate::diag::warn("update", &format!("{phase} failed"), &message);
        self.set(app, State::Error { message });
    }

    /// Check and announce what's new. Asked (About's button, the toast's Update) with a version announced: its APK now.
    /// Never downloaded unasked: mobile data. Busy or already downloaded: nothing.
    pub async fn check(&self, app: &AppHandle, asked: bool) {
        let offered = {
            let mut s = self.status.lock().unwrap();
            if matches!(s.state, State::Checking | State::Downloading { .. } | State::Ready { .. }) {
                return;
            }
            let offered = if asked && matches!(s.state, State::Available { .. }) { self.found.lock().unwrap().as_ref().map(|(f, _)| f.clone()) } else { None };
            // Taken here, under the lock: a second tap finds it busy.
            match &offered {
                Some(f) => s.state = State::Downloading { version: f.version.clone(), percent: 0 },
                None => {
                    s.state = State::Checking;
                    s.last_check = Some(now());
                }
            }
            offered
        };
        let _ = app.emit("update", self.status());
        if let Some(found) = offered {
            return self.fetch(app, found).await;
        }
        let current = self.status().current;
        match Apk::default().check(&current).await {
            Ok(Some(found)) => {
                *self.found.lock().unwrap() = Some((found.clone(), None));
                self.set(app, State::Available { version: found.version, notes: found.notes });
            }
            Ok(None) => self.set(app, State::UpToDate),
            Err(e) => self.failed(app, "check", e.to_string()),
        }
    }

    async fn fetch(&self, app: &AppHandle, found: Found) {
        let Some(dir) = folder(app) else { return self.failed(app, "download", "No cache folder".into()) };
        // One APK at a time: an older one goes.
        let _ = std::fs::remove_dir_all(&dir);
        if let Err(e) = std::fs::create_dir_all(&dir) {
            return self.failed(app, "download", e.to_string());
        }
        let to = dir.join(format!("legato-{}.apk", found.version));
        let got = Apk::default().download(&found, &to, |percent| self.set(app, State::Downloading { version: found.version.clone(), percent })).await;
        if let Err(e) = got {
            return self.failed(app, "download", e.to_string());
        }
        *self.found.lock().unwrap() = Some((found.clone(), Some(to)));
        self.set(app, State::Ready { version: found.version, notes: found.notes });
    }

    /// The downloaded APK to Android's installer, which asks the user; cancelled there, the update stays Ready. The first
    /// time Android's "Install unknown apps" page comes first, and the installer as the user comes back (`ApkInstall`).
    pub fn install(&self, app: &AppHandle) -> CmdResult<()> {
        let Some((found, Some(apk))) = self.found.lock().unwrap().clone() else { return Err("No update downloaded".into()) };
        let current = self.status().current;
        // Read at the new version's first launch: `just_updated`, the session resumed as it was.
        let mut s = saved(app);
        s.pending = Some(Installed { from: current, to: found.version.clone(), at: now(), notes: found.notes.clone() });
        save(app, &s);
        let answer = installer(&apk.to_string_lossy()).map_err(|e| e.to_string());
        match answer.as_deref() {
            Ok("ok" | "allow" | "later") => Ok(()),
            Ok(other) => Err(self.refused(other)),
            Err(e) => Err(self.refused(e)),
        }
    }

    fn refused(&self, message: &str) -> String {
        crate::diag::warn("update", "install failed", message);
        message.to_string()
    }
}

/// `ApkInstall.install(activity, path)`: "ok", "allow", "later" (Legato off screen) or "refused".
fn installer(path: &str) -> anyhow::Result<String> {
    let ctx = ndk_context::android_context();
    // SAFETY: the pointers come from the Android runtime and live as long as the process.
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }?;
    let mut env = vm.attach_current_thread()?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
    // A native thread sees the system's classes only: the app's own come from its loader.
    let loader = env.call_method(&activity, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?.l()?;
    let name = env.new_string(CLASS)?;
    let class = env.call_method(&loader, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;", &[JValue::Object(&name)])?.l()?;
    let path = env.new_string(path)?;
    let out = env.call_static_method(jni::objects::JClass::from(class), "install", "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;", &[JValue::Object(&activity), JValue::Object(&path)]);
    if env.exception_check()? {
        env.exception_clear()?;
        anyhow::bail!("Android's installer couldn't open");
    }
    let out = JString::from(out?.l()?);
    Ok(env.get_string(&out)?.into())
}

/// Background checks, announced only: release builds (a debug one checks when asked, from About).
pub fn spawn(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            app.state::<Updater>().check(&app, false).await;
            tokio::time::sleep(EVERY).await;
        }
    });
}
