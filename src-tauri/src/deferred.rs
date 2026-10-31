//! Work that waits for the first screen: plugins, the update rounds, Sync Mode's rounds, the cover cache's first prune. Order at launch: window
//! background, library, UI, then the UI's "ready" (`app_ready`), then these. The shield's lists are not here: the first
//! YouTube request must meet them (`lib.rs`, own task). The updater's guard (`identity::installed()`) is untouched.
//! Never depends on the page: a hidden start (login, tray) does not paint, a broken build never says ready, so a
//! timer starts the same work after `FALLBACK` and an update can still repair it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const FALLBACK: Duration = Duration::from_secs(8);

/// Opens once, whoever comes first.
#[derive(Default)]
struct Gate(AtomicBool);

impl Gate {
    /// True for the one call that opens it.
    fn open(&self) -> bool {
        !self.0.swap(true, Ordering::SeqCst)
    }
}

static GATE: Gate = Gate(AtomicBool::new(false));

/// What started the deferred work. The log says it, so a walk (`pnpm e2e`) can tell the UI's ready from the timer.
#[derive(Clone, Copy)]
enum Cause {
    Ready,
    Timer,
}

impl Cause {
    /// Our own words; e2e/smoke.mjs reads these two.
    fn words(self) -> &'static str {
        match self {
            Cause::Ready => "deferred start by the UI ready signal",
            Cause::Timer => "deferred start by the timer",
        }
    }
}

/// Starts the deferred work, once per run: a page reload says ready again, the timer too, nothing doubles.
fn start(app: &AppHandle, cause: Cause) {
    if !GATE.open() {
        return;
    }
    crate::diag::info("startup", cause.words(), "");
    crate::update::spawn(app.clone());
    crate::syncmode::spawn(app.clone());
    // Counts the cover folder and prunes it over its cap, on a thread of its own.
    if let Some(state) = app.try_state::<crate::AppState>() {
        state.art.prune_later();
    }
    // Each plugin opens a QuickJS runtime and a thread: off the async workers' way.
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || crate::plugins::start_all(&app));
}

/// At the end of setup: the timer that covers a page that never says ready.
pub fn arm(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FALLBACK).await;
        start(&app, Cause::Timer);
    });
}

/// The UI is up (library in, page mounted): the rest may start.
#[tauri::command]
pub async fn app_ready(app: AppHandle) {
    start(&app, Cause::Ready);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_once() {
        let g = Gate::default();
        assert!(g.open());
        assert!(!g.open());
        assert!(!g.open());
    }

    #[test]
    fn the_two_causes_say_different_words() {
        // e2e/smoke.mjs fails a walk on the timer's words.
        assert_ne!(Cause::Ready.words(), Cause::Timer.words());
        assert!(Cause::Timer.words().contains("timer"));
    }
}
