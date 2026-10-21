//! Videos whose owner turned embedding off (YouTube player errors 101 / 150) play from YouTube's own watch page: it
//! can't be framed, so it opens in a child webview of the main window, placed exactly over the video slot. The page gets
//! no IPC: `music_shield::WATCH_SCRIPT` hides YouTube's interface and posts the player's state on WebView2's message
//! channel; it is checked here (origin, shape, sizes) before it reaches the UI as a `ytwatch` event. Commands go back as
//! scripts built from fixed names and numbers only.

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Url, WebviewBuilder, WebviewUrl};

pub const LABEL: &str = "ytwatch";

/// Where the video slot is, in window physical pixels (UI rect × devicePixelRatio: DPI and the UI's zoom both in).
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    fn position(&self) -> PhysicalPosition<i32> {
        PhysicalPosition::new(self.x.round() as i32, self.y.round() as i32)
    }

    fn size(&self) -> PhysicalSize<u32> {
        PhysicalSize::new(self.width.round().max(1.0) as u32, self.height.round().max(1.0) as u32)
    }
}

/// What the watch page reports.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    #[serde(default)]
    pub state: Option<i32>,
    #[serde(default)]
    pub time: Option<f64>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub video_id: Option<String>,
    /// Playability status when the video can't play (UNPLAYABLE, LOGIN_REQUIRED, ERROR…).
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    /// A click on the video: the app's own play / pause.
    #[serde(default)]
    pub click: bool,
    /// The page waits for the app's volume (it stays muted until then).
    #[serde(default)]
    pub ready: bool,
    /// The app's crop is applied.
    #[serde(default)]
    pub cropped: bool,
}

/// Prefix of the page's messages ("musicapp-ytwatch:" + JSON). Strings: WebView2 drops objects posted from that page.
const PREFIX: &str = "musicapp-ytwatch:";

/// Trust boundary: the watch page runs YouTube's scripts, not ours alone. Origin, shape and sizes checked.
pub fn parse_report(source: &str, message: &str) -> Option<Report> {
    if !source.starts_with("https://www.youtube.com/") || message.len() > 4096 {
        return None;
    }
    let r: Report = serde_json::from_str(message.strip_prefix(PREFIX)?).ok()?;
    let short = |s: &Option<String>, n: usize| s.as_ref().is_none_or(|s| s.chars().count() <= n);
    let finite = |v: Option<f64>| v.is_none_or(|v| v.is_finite() && (0.0..=172_800.0).contains(&v));
    let ok = short(&r.video_id, 16) && short(&r.error, 40) && short(&r.reason, 300) && finite(r.time) && finite(r.duration) && r.state.is_none_or(|s| (-1..=5).contains(&s));
    ok.then_some(r)
}

/// Trust boundary: video id from the UI.
pub fn watch_url(video: &str, start_s: f64) -> Option<Url> {
    let id_ok = video.len() == 11 && video.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    let start = if start_s.is_finite() && start_s > 0.0 { start_s as u64 } else { 0 };
    id_ok.then(|| Url::parse(&format!("https://www.youtube.com/watch?v={video}&t={start}s")).ok()).flatten()
}

/// Player commands the UI may send. Built into a script from fixed names and numbers only.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Cmd {
    Play,
    Pause,
    Seek { seconds: f64 },
    Volume { percent: f64 },
    /// Show only this part of the video frame (black bars cut, fractions), like the embed's crop.
    Crop { x: f64, y: f64, w: f64, h: f64 },
}

pub fn script(cmd: Cmd) -> String {
    let call = |name: &str, v: f64| format!("window.__musicAppWatch && window.__musicAppWatch.cmd('{name}', {v})");
    match cmd {
        Cmd::Play => call("play", 0.0),
        Cmd::Pause => call("pause", 0.0),
        Cmd::Seek { seconds } => call("seek", if seconds.is_finite() { seconds.max(0.0) } else { 0.0 }),
        Cmd::Volume { percent } => call("volume", if percent.is_finite() { percent.clamp(0.0, 100.0).round() } else { 100.0 }),
        Cmd::Crop { x, y, w, h } => {
            let f = |v: f64, lo: f64| if v.is_finite() { v.clamp(lo, 1.0) } else { lo };
            format!("window.__musicAppWatch && window.__musicAppWatch.cmd('crop', [{}, {}, {}, {}])", f(x, 0.0), f(y, 0.0), f(w, 0.05), f(h, 0.05))
        }
    }
}

/// Only YouTube's own pages load in it (consent, redirects); anything else is refused.
fn allowed(url: &Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some_and(|h| h == "youtube.com" || h.ends_with(".youtube.com"))
}

/// Loads `video` from `start_s` in the watch webview over `rect` (made on first use, reused after).
pub fn open(app: &AppHandle, video: &str, start_s: f64, rect: Rect, shield: Arc<music_shield::Shield>) -> anyhow::Result<()> {
    let url = watch_url(video, start_s).ok_or_else(|| anyhow::anyhow!("Invalid video id"))?;
    if let Some(wv) = app.get_webview(LABEL) {
        wv.navigate(url)?;
        place(app, Some(rect))?;
        return Ok(());
    }
    let window = app.get_window("main").ok_or_else(|| anyhow::anyhow!("No main window"))?;
    let mut builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url)).initialization_script(music_shield::WATCH_SCRIPT).on_navigation(allowed).background_color(tauri::window::Color(0, 0, 0, 255));
    if shield.enabled.load(std::sync::atomic::Ordering::Relaxed) {
        builder = builder.initialization_script_for_all_frames(music_shield::YOUTUBE_SCRIPT);
    }
    let wv = window.add_child(builder, rect.position(), rect.size())?;
    #[cfg(windows)]
    {
        crate::shield::install(&wv, shield)?;
        listen(&wv, app.clone())?;
    }
    Ok(())
}

/// Follows the video slot; None = hidden (cover mode): it keeps playing, unseen.
pub fn place(app: &AppHandle, rect: Option<Rect>) -> tauri::Result<()> {
    let Some(wv) = app.get_webview(LABEL) else { return Ok(()) };
    match rect {
        Some(r) => {
            wv.set_position(r.position())?;
            wv.set_size(r.size())?;
            wv.show()
        }
        None => wv.hide(),
    }
}

pub fn command(app: &AppHandle, cmd: Cmd) -> tauri::Result<()> {
    match app.get_webview(LABEL) {
        Some(wv) => wv.eval(script(cmd)),
        None => Ok(()),
    }
}

/// Back to the embed: the watch page goes away (memory, and no second player).
pub fn close(app: &AppHandle) -> tauri::Result<()> {
    match app.get_webview(LABEL) {
        Some(wv) => wv.close(),
        None => Ok(()),
    }
}

#[cfg(windows)]
fn listen(wv: &tauri::Webview, app: AppHandle) -> tauri::Result<()> {
    use tauri::Emitter;
    use webview2_com::{WebMessageReceivedEventHandler, take_pwstr};
    use windows::core::PWSTR;
    wv.with_webview(move |pw| unsafe {
        let Ok(core) = pw.controller().CoreWebView2() else { return };
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut source = PWSTR::null();
            args.Source(&mut source)?;
            let mut message = PWSTR::null();
            // Not a string (or not ours): ignored.
            if args.TryGetWebMessageAsString(&mut message).is_err() {
                return Ok(());
            }
            if let Some(report) = parse_report(&take_pwstr(source), &take_pwstr(message)) {
                let _ = app.emit_to("main", "ytwatch", report);
            }
            Ok(())
        }));
        let mut token = Default::default();
        let _ = core.add_WebMessageReceived(&handler, &mut token);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const YT: &str = "https://www.youtube.com/watch?v=abcdefghijk";

    #[test]
    fn reports_are_checked() {
        let ok = parse_report(YT, r#"musicapp-ytwatch:{"state":1,"time":12.5,"duration":200,"videoId":"abcdefghijk"}"#).unwrap();
        assert_eq!((ok.state, ok.time, ok.duration), (Some(1), Some(12.5), Some(200.0)));
        assert!(parse_report(YT, r#"musicapp-ytwatch:{"click":true}"#).unwrap().click);
        assert_eq!(parse_report(YT, r#"musicapp-ytwatch:{"error":"UNPLAYABLE","reason":"Not in your country"}"#).unwrap().error.as_deref(), Some("UNPLAYABLE"));
        // Other origins, other senders, odd values, junk.
        assert!(parse_report("https://evil.example/", r#"musicapp-ytwatch:{"state":1}"#).is_none());
        assert!(parse_report(YT, r#"{"state":1}"#).is_none());
        assert!(parse_report(YT, r#"musicapp-ytwatch:{"state":99}"#).is_none());
        assert!(parse_report(YT, r#"musicapp-ytwatch:{"time":-4}"#).is_none());
        assert!(parse_report(YT, &format!(r#"musicapp-ytwatch:{{"reason":"{}"}}"#, "x".repeat(400))).is_none());
        assert!(parse_report(YT, "musicapp-ytwatch:not json").is_none());
    }

    #[test]
    fn urls_and_commands_carry_no_injection() {
        assert_eq!(watch_url("abcdefghijk", 42.9).unwrap().as_str(), "https://www.youtube.com/watch?v=abcdefghijk&t=42s");
        assert!(watch_url("abc');alert(1)//", 0.0).is_none());
        assert!(watch_url("abcdefghij", 0.0).is_none());
        assert_eq!(script(Cmd::Volume { percent: 250.0 }), "window.__musicAppWatch && window.__musicAppWatch.cmd('volume', 100)");
        assert_eq!(script(Cmd::Seek { seconds: f64::NAN }), "window.__musicAppWatch && window.__musicAppWatch.cmd('seek', 0)");
        assert_eq!(script(Cmd::Crop { x: 0.25, y: -1.0, w: 0.5, h: f64::INFINITY }), "window.__musicAppWatch && window.__musicAppWatch.cmd('crop', [0.25, 0, 0.5, 0.05])");
    }

    #[test]
    fn only_youtube_loads() {
        assert!(allowed(&Url::parse(YT).unwrap()));
        assert!(allowed(&Url::parse("https://consent.youtube.com/m").unwrap()));
        assert!(!allowed(&Url::parse("https://youtube.com.evil.example/").unwrap()));
        assert!(!allowed(&Url::parse("http://www.youtube.com/").unwrap()));
    }
}
