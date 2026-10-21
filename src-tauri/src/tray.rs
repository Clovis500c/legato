//! Notification area icon: current track, play / pause, next, previous, show window, quit.
//! Menu actions go to the UI as `media-key`, like media keys.

use crate::media::NowPlaying;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

pub struct Tray {
    icon: TrayIcon,
    now: MenuItem<Wry>,
    toggle: MenuItem<Wry>,
}

/// Tooltip and menu header. Windows cuts tooltips at 127 UTF-16 units.
pub fn label(now: Option<&NowPlaying>) -> String {
    let Some(n) = now else { return "Music App".into() };
    let text = format!("{} · {}", n.title, n.artist);
    let (mut out, mut units) = (String::new(), 0);
    for c in text.chars() {
        if units + c.len_utf16() > 120 {
            out.push('…');
            break;
        }
        units += c.len_utf16();
        out.push(c);
    }
    out
}

impl Tray {
    pub fn install(app: &AppHandle) -> tauri::Result<Self> {
        let now = MenuItem::with_id(app, "now", "Nothing playing", false, None::<&str>)?;
        let toggle = MenuItem::with_id(app, "toggle", "Play", false, None::<&str>)?;
        let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
        let prev = MenuItem::with_id(app, "previous", "Previous", true, None::<&str>)?;
        let show = MenuItem::with_id(app, "show", "Show Music App", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&now, &PredefinedMenuItem::separator(app)?, &toggle, &next, &prev, &PredefinedMenuItem::separator(app)?, &show, &quit])?;
        let mut builder = TrayIconBuilder::with_id("main")
            .tooltip("Music App")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, e| match e.id.as_ref() {
                "show" => show_main(app),
                "quit" => app.exit(0),
                key @ ("toggle" | "next" | "previous") => {
                    let _ = app.emit_to("main", "media-key", key);
                }
                _ => {}
            })
            .on_tray_icon_event(|tray, e| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                    show_main(tray.app_handle());
                }
            });
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
        Ok(Self { icon: builder.build(app)?, now, toggle })
    }

    pub fn update(&self, now: Option<&NowPlaying>) -> tauri::Result<()> {
        let text = label(now);
        self.icon.set_tooltip(Some(&text))?;
        self.now.set_text(if now.is_some() { text.as_str() } else { "Nothing playing" })?;
        self.toggle.set_text(if now.is_some_and(|n| n.playing) { "Pause" } else { "Play" })?;
        self.toggle.set_enabled(now.is_some())
    }
}

/// Restore and focus the main window (minimized or behind others).
pub fn show_main<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    // Window, not "webview window": with the watch-page child (ytwatch.rs) there is none.
    if let Some(w) = app.get_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn np(title: &str) -> NowPlaying {
        NowPlaying { title: title.into(), artist: "Daft Punk".into(), album: None, playing: true, position_ms: 0, duration_ms: None }
    }

    #[test]
    fn label_names_track_and_fits_tooltip() {
        assert_eq!(label(None), "Music App");
        assert_eq!(label(Some(&np("Get Lucky"))), "Get Lucky · Daft Punk");
        let long = label(Some(&np(&"é".repeat(300))));
        assert!(long.ends_with('…'));
        assert!(long.encode_utf16().count() <= 127);
    }
}
