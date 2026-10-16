//! YouTube Music web sign-in (like Pear Desktop): the user signs in on music.youtube.com in an app window.
//! The session stays in WebView2's cookie store (profile shared with the main window); nothing copied elsewhere.
//! The sign-in window gets no capability: remote pages can't reach IPC.

use std::time::Duration;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

pub const SITE: &str = "https://music.youtube.com/";
const LABEL: &str = "ytm-sign-in";
/// Google's own pages: the app never sees the password.
const SIGN_IN: &str = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F";
const ADD_ACCOUNT: &str = "https://accounts.google.com/AddSession?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F";

/// Cookie header for music.youtube.com; None = signed out.
/// WebView2: call from async commands or threads only (sync = deadlock).
pub fn session(app: &AppHandle) -> Option<String> {
    let main = app.get_webview_window("main")?;
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
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url)).title("Sign in with Google · YouTube Music").inner_size(520.0, 720.0).build()?;
    let app = app.clone();
    std::thread::spawn(move || {
        while let Some(w) = app.get_webview_window(LABEL) {
            std::thread::sleep(Duration::from_secs(2));
            let back = w.url().is_ok_and(|u| u.host_str() == Some("music.youtube.com"));
            if back && session(&app).is_some() {
                let _ = w.close();
                break;
            }
        }
    });
    Ok(())
}

/// Forgets every Google session (and other site data) in the app's webview profile.
pub fn sign_out(app: &AppHandle) -> tauri::Result<()> {
    app.get_webview_window("main").ok_or(tauri::Error::WebviewNotFound)?.clear_all_browsing_data()
}
