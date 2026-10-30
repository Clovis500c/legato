//! Local diagnostics log (plan: Diagnostics). The file, its lines and the report are `music_core::diag`; here: the thread
//! that writes it (a caller only queues a line, so a slow disk never holds up the window), the panic hook and the two
//! commands. A log that fails to start or write never takes the app down. Nothing is sent anywhere: Settings › About ›
//! Copy diagnostics builds a text the user pastes where they choose.

use crate::AppState;
use music_core::diag::{self as log, Level, Log, Who};
use music_core::model::Connector;
use std::io::Write;
use std::path::Path;
use std::sync::OnceLock;
use std::sync::mpsc::{Sender, channel};
use std::time::{Duration, SystemTime};
use tauri::{Manager, State};

enum Job {
    Line(String),
    /// Answered once every line queued before it is written.
    Flush(Sender<()>),
}

static QUEUE: OnceLock<Sender<Job>> = OnceLock::new();
const WRITER: &str = "diag";

/// First thing in setup (`dir` = the app data folder): later steps log, and a panic from here on lands in the file.
/// Nothing is opened here, the writer thread opens the file at its first line.
pub fn init(dir: &Path, version: &str) {
    let (tx, rx) = channel::<Job>();
    let dir = dir.to_path_buf();
    let spawned = std::thread::Builder::new().name(WRITER.into()).spawn(move || {
        let mut file = Log::new(dir);
        for job in rx {
            match job {
                Job::Line(line) => {
                    let _ = file.append(&line);
                }
                Job::Flush(done) => {
                    let _ = done.send(());
                }
            }
        }
    });
    if spawned.is_err() || QUEUE.set(tx).is_err() {
        return;
    }
    keep_panics();
    info("app", &format!("started {version}"), "");
}

/// A panic anywhere lands in the log (thread, place, message), then the default hook goes on as before.
fn keep_panics() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let name = thread.name().unwrap_or("unnamed");
        let place = info.location().map(|l| format!(" at {}:{}", l.file(), l.line())).unwrap_or_default();
        let payload = info.payload();
        let said = payload.downcast_ref::<&str>().map(|s| (*s).to_string()).or_else(|| payload.downcast_ref::<String>().cloned()).unwrap_or_default();
        error("panic", &format!("thread '{name}' panicked{place}"), &said);
        // The process may end right after: the line is on disk first. The writer can't wait for itself.
        if name != WRITER {
            flush();
        }
        previous(info);
    }));
}

fn write(level: Level, area: &str, message: &str, detail: &str) {
    let line = log::format_line(&log::timestamp(SystemTime::now()), level, area, message, detail);
    // Dev builds (pnpm dev) print it too, the terminal is where the developer looks; so does a log that never started.
    if cfg!(debug_assertions) || QUEUE.get().is_none() {
        let _ = writeln!(std::io::stderr(), "{line}");
    }
    if let Some(queue) = QUEUE.get() {
        let _ = queue.send(Job::Line(line));
    }
}

/// `message` = our own words (no song titles, account names, paths); `detail` = what an error said, shown in a copied
/// report only when the user ticks "Include details".
pub fn info(area: &str, message: &str, detail: &str) {
    write(Level::Info, area, message, detail);
}

pub fn warn(area: &str, message: &str, detail: &str) {
    write(Level::Warn, area, message, detail);
}

pub fn error(area: &str, message: &str, detail: &str) {
    write(Level::Error, area, message, detail);
}

/// Waits (1.5 s at most) until every queued line is in the file: before a report reads it, before the process ends.
pub fn flush() {
    let Some(queue) = QUEUE.get() else { return };
    let (done, wait) = channel();
    if queue.send(Job::Flush(done)).is_ok() {
        let _ = wait.recv_timeout(Duration::from_millis(1500));
    }
}

/// The interface's errors and playback switches (shared/diag.ts). Level: info, warn or error (anything else = info).
#[tauri::command]
pub async fn diag_log(level: String, area: String, message: String, detail: Option<String>) {
    write(Level::from_word(&level).unwrap_or(Level::Info), &area, &message, detail.as_deref().unwrap_or(""));
}

/// Windows 11 build 26300.1000 (24H2), x86_64. The registry's product name still says Windows 10 on 11: the build decides.
fn system() -> String {
    #[cfg(windows)]
    {
        if let Ok(key) = windows_registry::LOCAL_MACHINE.open(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion") {
            let build = key.get_string("CurrentBuildNumber").unwrap_or_default();
            let name = if build.parse::<u32>().unwrap_or(0) >= 22000 { "11" } else { "10" };
            let revision = key.get_u32("UBR").map(|u| format!(".{u}")).unwrap_or_default();
            let release = key.get_string("DisplayVersion").map(|v| format!(" ({v})")).unwrap_or_default();
            return format!("Windows {name} build {build}{revision}{release}, {}", std::env::consts::ARCH);
        }
    }
    format!("{}, {}", std::env::consts::OS, std::env::consts::ARCH)
}

/// The text Settings › About › Copy diagnostics copies: versions, the settings that matter, who is signed in, the latest
/// warnings and errors, the latest events. With `details` the errors' own text and the data folder come too; without it
/// no song title, account name or path holding the user's name does.
#[tauri::command]
pub async fn diag_report(state: State<'_, AppState>, details: bool) -> Result<String, String> {
    let app = state.app.clone();
    let ui = state.lib().setting("ui").ok().flatten().unwrap_or_default();
    let mut signed_in = Vec::new();
    if state.spotify().is_some_and(|c| c.is_connected()) {
        signed_in.push("Spotify");
    }
    if crate::ytm::session(&app).is_some() {
        signed_in.push("YouTube Music");
    }
    let dir = app.path().app_data_dir().unwrap_or_default();
    let mut facts = vec![
        ("Version".to_string(), format!("{}{}", app.package_info().version, if cfg!(debug_assertions) { " (dev build)" } else { "" })),
        ("Windows".to_string(), system()),
        ("WebView2".to_string(), tauri::webview_version().unwrap_or_else(|e| format!("not found ({e})"))),
        ("Signed in".to_string(), if signed_in.is_empty() { "nobody".to_string() } else { signed_in.join(", ") }),
        ("Settings".to_string(), log::settings_line(&ui)),
    ];
    if details {
        facts.push(("Data folder".to_string(), dir.display().to_string()));
    }
    tauri::async_runtime::spawn_blocking(move || {
        flush();
        let problems = log::recent(&dir, |e| e.level >= Level::Warn, 20);
        let events = log::recent(&dir, |e| e.level == Level::Info, 12);
        log::report(SystemTime::now(), &facts, &problems, &events, details, &Who::from_env())
    })
    .await
    .map_err(|e| format!("The report failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_and_panics_land_in_the_file() {
        let dir = std::env::temp_dir().join(format!("legato-diag-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        init(&dir, "9.9.9");
        error("test", "forced error", "its detail");
        let _ = std::thread::Builder::new().name("boom-thread".into()).spawn(|| panic!("kaboom")).unwrap().join();
        flush();
        let all = log::recent(&dir, |_| true, 50);
        assert!(all.iter().any(|e| e.area == "app" && e.message == "started 9.9.9"), "{all:?}");
        assert!(all.iter().any(|e| e.level == Level::Error && e.area == "test" && e.message == "forced error" && e.detail.as_deref() == Some("its detail")), "{all:?}");
        let panic = all.iter().find(|e| e.area == "panic").expect("the panic is in the log");
        assert!(panic.message.contains("boom-thread") && panic.message.contains("diag.rs"), "{panic:?}");
        assert_eq!(panic.detail.as_deref(), Some("kaboom"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
