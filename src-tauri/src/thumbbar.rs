//! Previous, Play / Pause and Next under the taskbar thumbnail (hover the app's taskbar button): Windows' thumbnail
//! toolbar (ITaskbarList3). Buttons go in once the taskbar button exists ("TaskbarButtonCreated"); clicks arrive as
//! WM_COMMAND through a subclass of the window and reach the UI like media keys. Icons are drawn here at the window's
//! DPI, white on a dark taskbar, black on a light one; Play / Pause follows the player.

/// RGBA icon of `size` px: a glyph made of filled shapes, 4×4 supersampled (smooth edges).
pub fn glyph(kind: Glyph, size: u32, color: [u8; 3]) -> Vec<u8> {
    let s = size as f32;
    let inside = |x: f32, y: f32| -> bool {
        // Unit square coordinates, glyph drawn in the middle 60 %.
        let (u, v) = (x / s, y / s);
        let tri = |x0: f32, x1: f32, u: f32, v: f32| {
            // Triangle pointing right from x0 to x1, full height 0.25..0.75.
            u >= x0 && u <= x1 && (v - 0.5).abs() <= 0.25 * (x1 - u) / (x1 - x0)
        };
        let bar = |x0: f32, x1: f32, u: f32, v: f32| u >= x0 && u <= x1 && (0.25..=0.75).contains(&v);
        match kind {
            Glyph::Play => tri(0.3, 0.75, u, v),
            Glyph::Pause => bar(0.3, 0.43, u, v) || bar(0.57, 0.7, u, v),
            Glyph::Next => tri(0.25, 0.62, u, v) || bar(0.64, 0.74, u, v),
            Glyph::Previous => tri(0.25, 0.62, 1.0 - u, v) || bar(0.64, 0.74, 1.0 - u, v),
        }
    };
    let mut out = vec![0u8; (size * size * 4) as usize];
    for y in 0..size {
        for x in 0..size {
            let mut hits = 0;
            for sy in 0..4 {
                for sx in 0..4 {
                    if inside(x as f32 + (sx as f32 + 0.5) / 4.0, y as f32 + (sy as f32 + 0.5) / 4.0) {
                        hits += 1;
                    }
                }
            }
            let o = ((y * size + x) * 4) as usize;
            out[o..o + 4].copy_from_slice(&[color[0], color[1], color[2], (hits * 255 / 16) as u8]);
        }
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Glyph {
    Previous,
    Play,
    Pause,
    Next,
}

#[cfg(windows)]
mod imp {
    use super::{Glyph, glyph};
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use tauri::{AppHandle, Emitter, Manager};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{CreateBitmap, DeleteObject};
    use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance};
    use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
    use windows::Win32::UI::Shell::{DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList, THB_ICON, THB_TOOLTIP, THB_FLAGS, THBF_ENABLED, THBN_CLICKED, THUMBBUTTON};
    use windows::Win32::UI::WindowsAndMessaging::{CreateIconIndirect, DestroyIcon, HICON, ICONINFO, RegisterWindowMessageW, SM_CXSMICON, WM_COMMAND};
    use windows::core::w;

    const PREV: u32 = 1;
    const PLAY: u32 = 2;
    const NEXT: u32 = 3;

    static CREATED: AtomicU32 = AtomicU32::new(0);
    static READY: AtomicBool = AtomicBool::new(false);
    static PLAYING: AtomicBool = AtomicBool::new(false);
    /// Window handle (as isize: HWND isn't Send) and the app, for the subclass procedure.
    static STATE: Mutex<Option<(isize, AppHandle)>> = Mutex::new(None);

    /// Taskbar color: light theme = black glyphs, dark = white.
    fn ink() -> [u8; 3] {
        let light = windows_registry::CURRENT_USER.open(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize").and_then(|k| k.get_u32("SystemUsesLightTheme")).is_ok_and(|v| v == 1);
        if light { [0, 0, 0] } else { [255, 255, 255] }
    }

    unsafe fn icon(hwnd: HWND, kind: Glyph) -> Option<HICON> {
        unsafe {
            let size = GetSystemMetricsForDpi(SM_CXSMICON, GetDpiForWindow(hwnd)).max(16) as u32;
            // BGRA, premultiplied for the icon's alpha.
            let rgba = glyph(kind, size, ink());
            let bgra: Vec<u8> = rgba
                .chunks(4)
                .flat_map(|p| {
                    let a = p[3] as u32;
                    [(p[2] as u32 * a / 255) as u8, (p[1] as u32 * a / 255) as u8, (p[0] as u32 * a / 255) as u8, p[3]]
                })
                .collect();
            let color = CreateBitmap(size as i32, size as i32, 1, 32, Some(bgra.as_ptr().cast()));
            let mask_bits = vec![0u8; (size * size / 8) as usize + 4];
            let mask = CreateBitmap(size as i32, size as i32, 1, 1, Some(mask_bits.as_ptr().cast()));
            let info = ICONINFO { fIcon: true.into(), xHotspot: 0, yHotspot: 0, hbmMask: mask, hbmColor: color };
            let out = CreateIconIndirect(&info).ok();
            let _ = DeleteObject(color.into());
            let _ = DeleteObject(mask.into());
            out
        }
    }

    fn tip(text: &str) -> [u16; 260] {
        let mut out = [0u16; 260];
        for (i, c) in text.encode_utf16().take(259).enumerate() {
            out[i] = c;
        }
        out
    }

    unsafe fn buttons(hwnd: HWND) -> Option<[THUMBBUTTON; 3]> {
        unsafe {
            let playing = PLAYING.load(Ordering::Relaxed);
            let button = |id: u32, kind: Glyph, label: &str| -> Option<THUMBBUTTON> {
                Some(THUMBBUTTON { dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS, iId: id, iBitmap: 0, hIcon: icon(hwnd, kind)?, szTip: tip(label), dwFlags: THBF_ENABLED })
            };
            Some([
                button(PREV, Glyph::Previous, crate::lang::tr("Previous"))?,
                if playing { button(PLAY, Glyph::Pause, crate::lang::tr("Pause"))? } else { button(PLAY, Glyph::Play, crate::lang::tr("Play"))? },
                button(NEXT, Glyph::Next, crate::lang::tr("Next"))?,
            ])
        }
    }

    fn taskbar() -> Option<ITaskbarList3> {
        unsafe {
            let t: ITaskbarList3 = CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER).ok()?;
            t.HrInit().ok()?;
            Some(t)
        }
    }

    fn free(b: &[THUMBBUTTON; 3]) {
        for x in b {
            unsafe {
                let _ = DestroyIcon(x.hIcon);
            }
        }
    }

    unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _: usize, _: usize) -> LRESULT {
        unsafe {
            if msg == CREATED.load(Ordering::Relaxed) && msg != 0 {
                if let (Some(t), Some(b)) = (taskbar(), buttons(hwnd)) {
                    READY.store(t.ThumbBarAddButtons(hwnd, &b).is_ok(), Ordering::Relaxed);
                    free(&b);
                }
            } else if msg == WM_COMMAND && ((wparam.0 >> 16) & 0xffff) as u32 == THBN_CLICKED {
                let key = match (wparam.0 & 0xffff) as u32 {
                    PREV => Some("previous"),
                    PLAY => Some("toggle"),
                    NEXT => Some("next"),
                    _ => None,
                };
                let app = STATE.lock().unwrap().as_ref().map(|(_, a)| a.clone());
                if let (Some(key), Some(app)) = (key, app) {
                    crate::background::wake(&app);
                    let _ = app.emit_to("main", "media-key", key);
                }
                return LRESULT(0);
            }
            DefSubclassProc(hwnd, msg, wparam, lparam)
        }
    }

    pub fn install(window: &tauri::WebviewWindow) -> anyhow::Result<()> {
        let hwnd = window.hwnd()?;
        CREATED.store(unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) }, Ordering::Relaxed);
        *STATE.lock().unwrap() = Some((hwnd.0 as isize, window.app_handle().clone()));
        unsafe { SetWindowSubclass(hwnd, Some(proc), 0x4d41, 0).ok()? };
        Ok(())
    }

    /// Play / Pause icon follows the player (and the taskbar's light / dark theme).
    pub fn set_playing(playing: bool) {
        if PLAYING.swap(playing, Ordering::Relaxed) != playing {
            refresh();
        }
    }

    /// Buttons drawn again (state, theme or language changed).
    pub fn refresh() {
        if !READY.load(Ordering::Relaxed) {
            return;
        }
        let Some(hwnd) = STATE.lock().unwrap().as_ref().map(|(h, _)| HWND(*h as *mut _)) else { return };
        unsafe {
            if let (Some(t), Some(b)) = (taskbar(), buttons(hwnd)) {
                let _ = t.ThumbBarUpdateButtons(hwnd, &b);
                free(&b);
            }
        }
    }
}

#[cfg(windows)]
pub use imp::{install, refresh, set_playing};

#[cfg(not(windows))]
pub fn install(_: &tauri::WebviewWindow) -> anyhow::Result<()> {
    Ok(())
}

#[cfg(not(windows))]
pub fn set_playing(_: bool) {}

#[cfg(not(windows))]
pub fn refresh() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glyphs_are_drawn_where_expected() {
        let size = 16;
        let alpha = |g: Glyph, x: u32, y: u32| glyph(g, size, [255, 255, 255])[((y * size + x) * 4 + 3) as usize];
        // Play: solid near its left edge, middle height; empty in the corners.
        assert!(alpha(Glyph::Play, 6, 8) > 200);
        assert_eq!(alpha(Glyph::Play, 1, 1), 0);
        // Pause: two bars with a gap in the middle.
        assert!(alpha(Glyph::Pause, 5, 8) > 200);
        assert_eq!(alpha(Glyph::Pause, 8, 8), 0);
        // Previous mirrors Next.
        for y in 0..size {
            for x in 0..size {
                assert_eq!(alpha(Glyph::Previous, x, y), alpha(Glyph::Next, size - 1 - x, y));
            }
        }
    }
}
