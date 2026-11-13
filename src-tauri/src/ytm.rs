//! YouTube Music web sign-in (like Pear Desktop): the user signs in on music.youtube.com in an app window.
//! The session stays in WebView2's cookie store (profile shared with the main window); nothing copied elsewhere.
//! The sign-in window gets no capability: remote pages can't reach IPC.

use std::time::Duration;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

pub const SITE: &str = "https://music.youtube.com/";
const LABEL: &str = "ytm-sign-in";
#[cfg(desktop)]
const REFRESH: &str = "ytm-refresh";
/// Google's own pages: the app never sees the password.
const SIGN_IN: &str = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F";
const ADD_ACCOUNT: &str = "https://accounts.google.com/AddSession?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F";

/// Cookie header for music.youtube.com; None = signed out.
/// WebView2: call from async commands or threads only (sync = deadlock).
pub fn session(app: &AppHandle) -> Option<String> {
    // Phones: no Spotify, Apple or Google sign-in (one webview, signed out). Android's WebView also throws on a page
    // with no cookie yet (wry 0.57: getCookie(...) must not be null), which aborts the app.
    if cfg!(mobile) {
        return None;
    }
    // The webview, not the "webview window": with the watch-page child (ytwatch.rs) there is none.
    let main = app.get_webview("main")?;
    let cookies = main.cookies_for_url(Url::parse(SITE).ok()?).ok()?;
    // SAPISID = signed-in Google session on youtube.com.
    cookies.iter().any(|c| c.name() == "SAPISID" || c.name() == "__Secure-3PAPISID").then(|| cookies.iter().map(|c| format!("{}={}", c.name(), c.value())).collect::<Vec<_>>().join("; "))
}

/// Opens (or focuses) Google's sign-in page; the window closes by itself once back on YouTube Music signed in.
pub fn open(app: &AppHandle, add_account: bool) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        return w.set_focus();
    }
    let url = Url::parse(if add_account { ADD_ACCOUNT } else { SIGN_IN }).expect("valid url");
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url)).additional_browser_args(&crate::background::browser_args()).title("Sign in with Google · YouTube Music").inner_size(520.0, 720.0).build()?;
    #[cfg(windows)]
    if let Some(wv) = app.get_webview(LABEL) {
        let _ = crate::shield::watch(&wv);
    }
    let app = app.clone();
    std::thread::spawn(move || {
        while let Some(w) = app.get_webview_window(LABEL) {
            std::thread::sleep(Duration::from_secs(2));
            let back = w.url().is_ok_and(|u| u.host_str() == Some("music.youtube.com"));
            if back && session(&app).is_some() {
                if let Some(s) = app.try_state::<crate::AppState>() {
                    s.cache.status.clear();
                }
                let _ = w.close();
                break;
            }
        }
    });
    Ok(())
}

/// Google renews its session cookies from its own pages, which the app never shows after sign-in: twelve days on they
/// were still the sign-in's, and Google refused likes as signed out (401, 2026-10-28). Its sign-in page, hidden: a live
/// session goes straight back to YouTube Music with fresh cookies. False: signed out, or Google wants the user.
#[cfg(desktop)]
pub async fn refresh(app: &AppHandle) -> bool {
    if session(app).is_none() || app.get_webview_window(LABEL).is_some() || app.get_webview_window(REFRESH).is_some() {
        return false;
    }
    let url = Url::parse(SIGN_IN).expect("valid url");
    // Never focused: by default the new webview takes the keyboard focus even hidden (wry's MoveFocus), and the app's
    // window went inactive under the user 90 s after launch (Nov 2026 report, with a window-styling mod).
    let Ok(w) = WebviewWindowBuilder::new(app, REFRESH, WebviewUrl::External(url)).additional_browser_args(&crate::background::browser_args()).visible(false).focused(false).focusable(false).skip_taskbar(true).build() else { return false };
    #[cfg(windows)]
    let _ = crate::shield::watch(w.as_ref());
    let mut back = false;
    for _ in 0..15 {
        tokio::time::sleep(Duration::from_secs(2)).await;
        back = w.url().is_ok_and(|u| u.host_str() == Some("music.youtube.com"));
        if back {
            break;
        }
    }
    let _ = w.close();
    let fresh = back && session(app).is_some();
    if !fresh {
        crate::diag::warn("ytm", "the Google session didn't come back fresh", "");
    }
    fresh
}

/// Phones: signed out of Google always (`session`), nothing to refresh; their window builder has no focus options.
#[cfg(mobile)]
pub async fn refresh(_: &AppHandle) -> bool {
    false
}

/// Forgets every Google session (and other site data) in the app's webview profile.
pub fn sign_out(app: &AppHandle) -> tauri::Result<()> {
    app.get_webview("main").ok_or(tauri::Error::WebviewNotFound)?.clear_all_browsing_data()
}

#[cfg(test)]
mod tests {
    /// A window made hidden never takes the focus from the app's window (`.visible(false)` alone doesn't stop it).
    #[test]
    fn hidden_windows_never_take_the_focus() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut bad = Vec::new();
        for entry in std::fs::read_dir(&dir).unwrap().flatten() {
            let Ok(text) = std::fs::read_to_string(entry.path()) else { continue };
            // Built from parts: this test's own lines don't count.
            let (made, hidden) = (["WebviewWindowBuilder", "::new"].concat(), [".visible", "(false)"].concat());
            for line in text.lines().filter(|l| l.contains(&made) && l.contains(&hidden)) {
                if !line.contains(".focused(false)") {
                    bad.push(format!("{}: {}", entry.file_name().to_string_lossy(), line.trim()));
                }
            }
        }
        assert!(bad.is_empty(), "hidden windows that take the focus: {bad:?}");
    }
}
