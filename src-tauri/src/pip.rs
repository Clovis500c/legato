//! Picture-in-picture (P, or the player bar's button): the main window made small and kept above the others, the video
//! or the cover with a few controls (`features/player/PipScreen.tsx`), then back as it was. The same window: its one
//! webview plays on (a second window would mean a second player). Its last place is the interface's (settings
//! `pipPlace`, this PC only); the window it was before stays here, and goes back before the app saves its place on exit.

use std::sync::Mutex;

use tauri::{AppHandle, LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalSize, Size, WebviewWindow};

use crate::window_place::{Rect, fit};

/// First size, logical px: a 16:9 picture 480 wide and the controls' strip.
const SIZE: (f64, f64) = (480.0, 316.0);
/// Smallest: the picture stays YouTube's 200 px high at least (the strip, its progress line and the sung line: 70).
const MIN: (f64, f64) = (356.0, 270.0);
/// From the work area's edges, logical px.
const MARGIN: f64 = 24.0;

/// Physical px: x, y, width, height.
type Place = (i32, i32, u32, u32);

/// The window before picture-in-picture.
#[derive(Clone, Copy)]
struct Before {
    rect: Rect,
    maximized: bool,
    fullscreen: bool,
}

static BEFORE: Mutex<Option<Before>> = Mutex::new(None);

/// on: small and above the others, at `place` when it is still on a screen. Off: back as it was; gives the small
/// window's place to keep. Twice the same way: nothing.
#[tauri::command]
pub async fn pip(window: WebviewWindow, on: bool, place: Option<Place>) -> Result<Option<Place>, String> {
    if on { enter(&window, place).map(|()| None) } else { leave(&window) }.map_err(|e| e.to_string())
}

/// Before the app saves the window's place (quit, restart, update): its own size, not the small one.
pub fn leave_for_exit(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = leave(&w);
    }
}

fn enter(window: &WebviewWindow, place: Option<Place>) -> tauri::Result<()> {
    if BEFORE.lock().unwrap().is_some() {
        return Ok(());
    }
    // Instead of a minimize (settings `pipOnMinimize`): back on screen first, or its minimized place would be the one kept.
    if window.is_minimized()? {
        window.unminimize()?;
    }
    let (maximized, fullscreen) = (window.is_maximized()?, window.is_fullscreen()?);
    if fullscreen {
        window.set_fullscreen(false)?;
    }
    if maximized {
        window.unmaximize()?;
    }
    // Read once back to normal: the size it comes back to.
    let (pos, size) = (window.outer_position()?, window.inner_size()?);
    *BEFORE.lock().unwrap() = Some(Before { rect: Rect { x: pos.x.into(), y: pos.y.into(), w: size.width.into(), h: size.height.into() }, maximized, fullscreen });
    let screens: Vec<Rect> = window.available_monitors()?.iter().map(area).collect();
    let here = match window.current_monitor()? {
        Some(m) => Some(m),
        None => window.primary_monitor()?,
    };
    let scale = window.scale_factor()?;
    let px = |v: f64| (v * scale).round() as i64;
    let saved = place.map(|(x, y, w, h)| Rect { x: x.into(), y: y.into(), w: w.into(), h: h.into() });
    let r = match here {
        Some(m) => spot(saved, &screens, area(&m), (px(SIZE.0), px(SIZE.1)), px(MARGIN)),
        None => saved.unwrap_or(Rect { x: 0, y: 0, w: px(SIZE.0), h: px(SIZE.1) }),
    };
    window.set_min_size(Some(Size::Logical(LogicalSize::new(MIN.0, MIN.1))))?;
    window.set_size(PhysicalSize::new(r.w as u32, r.h as u32))?;
    window.set_position(PhysicalPosition::new(r.x as i32, r.y as i32))?;
    window.set_always_on_top(true)
}

fn leave(window: &WebviewWindow) -> tauri::Result<Option<Place>> {
    let Some(b) = BEFORE.lock().unwrap().take() else { return Ok(None) };
    let (pos, size) = (window.outer_position()?, window.inner_size()?);
    window.set_always_on_top(false)?;
    // The configured minimum (tauri.conf.json), else none.
    let min = window.app_handle().config().app.windows.iter().find(|c| c.label == window.label()).and_then(|c| Some(LogicalSize::new(c.min_width?, c.min_height?)));
    window.set_min_size(min.map(Size::Logical))?;
    window.set_size(PhysicalSize::new(b.rect.w as u32, b.rect.h as u32))?;
    window.set_position(PhysicalPosition::new(b.rect.x as i32, b.rect.y as i32))?;
    if b.maximized {
        window.maximize()?;
    }
    if b.fullscreen {
        window.set_fullscreen(true)?;
    }
    Ok(Some((pos.x, pos.y, size.width, size.height)))
}

fn area(m: &Monitor) -> Rect {
    let a = m.work_area();
    Rect { x: a.position.x.into(), y: a.position.y.into(), w: a.size.width.into(), h: a.size.height.into() }
}

/// Where the small window goes: its last place while it still fits a screen, else `size` in the bottom right corner of
/// `here` (the main window's screen), `margin` in. Physical px.
fn spot(saved: Option<Rect>, screens: &[Rect], here: Rect, size: (i64, i64), margin: i64) -> Rect {
    if let Some(r) = saved.filter(|r| screens.iter().any(|s| fit(*r, *s).is_none())) {
        return r;
    }
    let (w, h) = (size.0.min(here.w - 2 * margin).max(1), size.1.min(here.h - 2 * margin).max(1));
    Rect { x: here.x + here.w - w - margin, y: here.y + here.h - h - margin, w, h }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = Rect { x: 0, y: 0, w: 1920, h: 1040 };
    const SIZE: (i64, i64) = (480, 316);

    #[test]
    fn first_time_in_the_bottom_right_corner() {
        assert_eq!(spot(None, &[SCREEN], SCREEN, SIZE, 24), Rect { x: 1416, y: 700, w: 480, h: 316 });
        // A second screen, left of the main one.
        let left = Rect { x: -2560, y: 0, w: 2560, h: 1400 };
        assert_eq!(spot(None, &[SCREEN, left], left, SIZE, 24), Rect { x: -504, y: 1060, w: 480, h: 316 });
    }

    #[test]
    fn its_last_place_while_a_screen_still_shows_it() {
        let top_left = Rect { x: 40, y: 40, w: 600, h: 400 };
        assert_eq!(spot(Some(top_left), &[SCREEN], SCREEN, SIZE, 24), top_left);
        // Left on a screen since unplugged: the corner again.
        let gone = Rect { x: -1500, y: 100, w: 480, h: 316 };
        assert_eq!(spot(Some(gone), &[SCREEN], SCREEN, SIZE, 24), Rect { x: 1416, y: 700, w: 480, h: 316 });
        // Bigger than the screen it was on now is: the corner, first size.
        let huge = Rect { x: 0, y: 0, w: 2400, h: 1300 };
        assert_eq!(spot(Some(huge), &[SCREEN], SCREEN, SIZE, 24), Rect { x: 1416, y: 700, w: 480, h: 316 });
    }

    #[test]
    fn a_tiny_screen_shrinks_it() {
        let tiny = Rect { x: 0, y: 0, w: 400, h: 300 };
        assert_eq!(spot(None, &[tiny], tiny, SIZE, 24), Rect { x: 24, y: 24, w: 352, h: 252 });
    }
}
