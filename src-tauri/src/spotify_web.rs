//! Spotify without keys, prototype: Spotify's own web player (open.spotify.com) in an app window.
//! The user signs in on Spotify's page; audio plays in Spotify's official player (Widevine DRM, available in WebView2).
//! The window gets no capability (remote page, no IPC) and no ad blocking: the shield only hooks the main window.

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const PLAYER: &str = "https://open.spotify.com/";
const LABEL: &str = "spotify-web";

/// Signed in to the web player (sp_dc = Spotify web session cookie). Profile shared with the main window.
/// WebView2: call from async commands or threads only (sync = deadlock).
pub fn signed_in(app: &AppHandle) -> bool {
    let Some(main) = app.get_webview("main") else { return false };
    let Ok(url) = Url::parse(PLAYER) else { return false };
    main.cookies_for_url(url).is_ok_and(|c| c.iter().any(|c| c.name() == "sp_dc" && !c.value().is_empty()))
}

/// Opens (or focuses) the official web player; Spotify shows its own sign-in when needed.
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        return w.set_focus();
    }
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(Url::parse(PLAYER).expect("valid url"))).additional_browser_args(crate::background::BROWSER_ARGS).title("Spotify").inner_size(1100.0, 760.0).build()?;
    Ok(())
}
