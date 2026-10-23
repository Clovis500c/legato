//! Like Discord: closing the window keeps the app in the notification area, music playing. Hidden, the webview is told
//! so (no painting, throttled timers) and asked to free memory; after a while with nothing playing it is suspended
//! (scripts stop) and woken before anything reaches it again: show, tray, global shortcut, media key. Quit (tray) is the
//! only real exit.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// WebView2 flags for every webview (one browser process: they must match). wry's defaults (no mini menu, no
/// SmartScreen), plus: hidden page keeps full-speed timers and normal priority, so the next song starts at once from
/// the tray (review 2026-10-23: switches took seconds in the background). Silent and hidden long = suspended anyway.
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,IntensiveWakeUpThrottling --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";

/// Quit asked: the next close is real.
static QUITTING: AtomicBool = AtomicBool::new(false);
/// Something plays (media panel updates): never suspended then.
static PLAYING: AtomicBool = AtomicBool::new(false);
static SUSPENDED: AtomicBool = AtomicBool::new(false);
/// Since when the window is hidden.
static HIDDEN: Mutex<Option<Instant>> = Mutex::new(None);
/// Hidden and silent this long: suspended.
const SLEEP_AFTER: Duration = Duration::from_secs(5 * 60);

pub fn quitting() -> bool {
    QUITTING.load(Ordering::Relaxed)
}

pub fn set_playing(playing: bool) {
    PLAYING.store(playing, Ordering::Relaxed);
}

/// Should a hidden window go to sleep now?
pub fn should_sleep(hidden_for: Option<Duration>, playing: bool, suspended: bool) -> bool {
    !playing && !suspended && hidden_for.is_some_and(|d| d >= SLEEP_AFTER)
}

/// Window closed: hidden, webview in low-resource mode. Music goes on.
pub fn hide(app: &AppHandle) {
    if let Some(w) = app.get_window("main") {
        let _ = w.hide();
    }
    *HIDDEN.lock().unwrap() = Some(Instant::now());
    set_visible(app, false);
}

/// Back on screen (tray, second launch, global shortcut): woken first, then shown and focused.
pub fn show(app: &AppHandle) {
    wake(app);
    *HIDDEN.lock().unwrap() = None;
    set_visible(app, true);
    if let Some(w) = app.get_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    crate::update::check_if_stale(app);
}

/// The only real exit: the watch-page child goes first (window state is saved for single-webview windows only).
pub fn quit(app: &AppHandle) {
    QUITTING.store(true, Ordering::Relaxed);
    wake(app);
    let _ = crate::ytwatch::close(app);
    crate::window_place::save(app);
    app.exit(0);
}

/// Suspended webview resumed: call before sending it anything.
pub fn wake(app: &AppHandle) {
    if !SUSPENDED.swap(false, Ordering::Relaxed) {
        return;
    }
    #[cfg(windows)]
    if let Some(wv) = app.get_webview("main") {
        let _ = wv.with_webview(|pw| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
            use windows::core::Interface;
            if let Ok(core) = pw.controller().CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_3>()) {
                let _ = core.Resume();
            }
        });
    }
    #[cfg(not(windows))]
    let _ = app;
}

/// WebView2: hidden = no painting, page `hidden` (rAF stops, timers throttled); memory target low while hidden.
fn set_visible(app: &AppHandle, visible: bool) {
    #[cfg(windows)]
    if let Some(wv) = app.get_webview("main") {
        let _ = wv.with_webview(move |pw| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::*;
            use windows::core::Interface;
            let controller = pw.controller();
            let _ = controller.SetIsVisible(visible);
            if let Ok(core) = controller.CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_19>()) {
                let level = if visible { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW };
                let _ = core.SetMemoryUsageTargetLevel(level);
            }
        });
    }
    #[cfg(not(windows))]
    let _ = (app, visible);
}

/// Checks once a minute: hidden and silent long enough = suspended.
pub fn spawn_sleeper(app: AppHandle) {
    // Suspending the webview is WebView2's: elsewhere the app is only checked on.
    #[cfg(not(windows))]
    let _ = app;
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(60));
            let hidden_for = HIDDEN.lock().unwrap().map(|t| t.elapsed());
            if !should_sleep(hidden_for, PLAYING.load(Ordering::Relaxed), SUSPENDED.load(Ordering::Relaxed)) {
                continue;
            }
            #[cfg(windows)]
            if let Some(wv) = app.get_webview("main") {
                let _ = wv.with_webview(|pw| unsafe {
                    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
                    use webview2_com::TrySuspendCompletedHandler;
                    use windows::core::Interface;
                    let Ok(core) = pw.controller().CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_3>()) else { return };
                    let handler = TrySuspendCompletedHandler::create(Box::new(|result, done| {
                        if result.is_ok() && done {
                            SUSPENDED.store(true, Ordering::Relaxed);
                        }
                        Ok(())
                    }));
                    let _ = core.TrySuspend(&handler);
                });
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sleeps_only_hidden_silent_and_long_enough() {
        let long = Some(SLEEP_AFTER + Duration::from_secs(1));
        assert!(should_sleep(long, false, false));
        assert!(!should_sleep(long, true, false), "music playing");
        assert!(!should_sleep(long, false, true), "already asleep");
        assert!(!should_sleep(None, false, false), "on screen");
        assert!(!should_sleep(Some(Duration::from_secs(30)), false, false), "just hidden");
    }
}
