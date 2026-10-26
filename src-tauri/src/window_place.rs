//! Main window comes back where it was closed: same screen, position, size, maximized / full screen.
//! tauri-plugin-window-state keeps it (`.window-state.json` in the app config folder, saved on exit).
//! Window created hidden (tauri.conf.json), placed, then shown: no jump on screen.

use tauri::{AppHandle, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, plugin::TauriPlugin};
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

/// Not visible / decorations: window always opens shown, title bar is ours.
const FLAGS: StateFlags = StateFlags::SIZE.union(StateFlags::POSITION).union(StateFlags::MAXIMIZED).union(StateFlags::FULLSCREEN);
/// Less of the window than this on screen (px each way): brought back to the middle.
const MIN_VISIBLE: i64 = 120;

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_window_state::Builder::new().with_state_flags(FLAGS).skip_initial_state("main").build()
}

static PLACED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Saved place applied yet? Not when the app started in the tray (after an update from there).
pub fn placed() -> bool {
    PLACED.load(std::sync::atomic::Ordering::Relaxed)
}

/// Saved place applied, pulled back onto its screen if that screen got smaller or moved, then shown.
pub fn restore(window: &WebviewWindow) -> tauri::Result<()> {
    PLACED.store(true, std::sync::atomic::Ordering::Relaxed);
    settle_frame(window);
    let _ = window.restore_state(FLAGS);
    if !window.is_maximized()? && !window.is_fullscreen()? {
        // Saved screen gone: plugin lets the OS place it, size may still be too big.
        let screen = match window.current_monitor()? {
            Some(m) => Some(m),
            None => window.primary_monitor()?,
        };
        if let Some(screen) = screen {
            let (pos, size, area) = (window.outer_position()?, window.inner_size()?, screen.work_area());
            let win = Rect { x: pos.x.into(), y: pos.y.into(), w: size.width.into(), h: size.height.into() };
            let area = Rect { x: area.position.x.into(), y: area.position.y.into(), w: area.size.width.into(), h: area.size.height.into() };
            if let Some(r) = fit(win, area) {
                window.set_size(PhysicalSize::new(r.w as u32, r.h as u32))?;
                window.set_position(PhysicalPosition::new(r.x as i32, r.y as i32))?;
            }
        }
    }
    window.show()?;
    window.set_focus()
}

/// Hidden borderless window still counts a title bar until first shown: restored sizes came back 30 px taller each
/// launch. Frame recomputed first.
#[cfg(windows)]
fn settle_frame(window: &WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SetWindowPos};
    if let Ok(hwnd) = window.hwnd() {
        let _ = unsafe { SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE) };
    }
}

#[cfg(not(windows))]
fn settle_frame(_: &WebviewWindow) {}

/// Save now. Restart and update install skip the exit event the plugin saves on. The plugin only sees windows holding a
/// single webview: the watch-page child goes first (the app is leaving anyway).
pub fn save(app: &AppHandle) {
    let _ = crate::ytwatch::close(app);
    let _ = app.save_window_state(FLAGS);
}

/// Physical px.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Rect {
    x: i64,
    y: i64,
    w: i64,
    h: i64,
}

/// None = fine where it is (straddling two screens included). Else shrunk to the work area and centered on it.
fn fit(win: Rect, area: Rect) -> Option<Rect> {
    let seen = |a: i64, al: i64, b: i64, bl: i64| ((a + al).min(b + bl) - a.max(b)).max(0);
    let too_big = win.w > area.w || win.h > area.h;
    let lost = seen(win.x, win.w, area.x, area.w) < MIN_VISIBLE.min(win.w) || seen(win.y, win.h, area.y, area.h) < MIN_VISIBLE.min(win.h);
    if !too_big && !lost {
        return None;
    }
    let (w, h) = (win.w.min(area.w), win.h.min(area.h));
    Some(Rect { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = Rect { x: 0, y: 0, w: 1920, h: 1040 };

    #[test]
    fn fitting_window_stays_put() {
        assert_eq!(fit(Rect { x: 100, y: 50, w: 1360, h: 860 }, SCREEN), None);
        // Half on a second screen: user's choice.
        assert_eq!(fit(Rect { x: 1200, y: 50, w: 1360, h: 860 }, SCREEN), None);
        // Second screen left of the main one.
        assert_eq!(fit(Rect { x: -2000, y: 0, w: 1360, h: 860 }, Rect { x: -2560, y: 0, w: 2560, h: 1400 }), None);
    }

    #[test]
    fn too_big_for_a_smaller_screen_shrinks_and_centers() {
        // Saved on a 4K screen, opened on a laptop.
        assert_eq!(fit(Rect { x: 0, y: 0, w: 2720, h: 1720 }, SCREEN), Some(Rect { x: 0, y: 0, w: 1920, h: 1040 }));
        assert_eq!(fit(Rect { x: 10, y: 10, w: 2000, h: 800 }, SCREEN), Some(Rect { x: 0, y: 120, w: 1920, h: 800 }));
    }

    #[test]
    fn nearly_off_screen_comes_back_to_the_middle() {
        assert_eq!(fit(Rect { x: 1880, y: 50, w: 1360, h: 860 }, SCREEN), Some(Rect { x: 280, y: 90, w: 1360, h: 860 }));
        assert_eq!(fit(Rect { x: 100, y: 1000, w: 1360, h: 860 }, SCREEN), Some(Rect { x: 280, y: 90, w: 1360, h: 860 }));
    }
}
