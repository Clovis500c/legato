//! Videos whose owner turned embedding off (YouTube player errors 101 / 150) play from YouTube's own watch page: it
//! can't be framed, so it opens in a child webview of the main window, placed exactly over the video slot. The page gets
//! no IPC: `music_shield::WATCH_SCRIPT` hides YouTube's interface and posts the player's state on WebView2's message
//! channel; it is checked here (origin, shape, sizes) before it reaches the UI as a `ytwatch` event. Commands go back as
//! scripts built from fixed names and numbers only.

// Windows only; the parsing and drawing below are tested on every system (CI), where nothing else calls them.
#![cfg_attr(not(windows), allow(dead_code))]

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Url, WebviewBuilder, WebviewUrl};

pub const LABEL: &str = "ytwatch";

/// Where the video slot is, in window physical pixels (UI rect × devicePixelRatio: DPI and the UI's zoom both in).
#[derive(Debug, Clone, Copy, Deserialize, ts_rs::TS)]
#[ts(export, rename = "WatchRect")]
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
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "WatchReport")]
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

/// Live processing news from the page (live.js): attached or not, levels.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LiveReport {
    #[serde(default)]
    pub attached: Option<bool>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub levels: Option<LiveLevels>,
    /// The song ended here (s of the video), silence after it: an early end.
    #[serde(default)]
    pub end: Option<f64>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct LiveLevels {
    pub fast: f64,
    pub momentary: f64,
    pub short: f64,
    pub peak: f64,
    pub gain: f64,
    /// Visualizer bands, dB (only when asked for).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(as = "Option<Vec<f64>>")]
    pub bands: Option<[f64; 16]>,
}

/// Trust boundary, like `parse_report`: "musicapp-live:" + JSON, finite numbers in range, short error text.
pub fn parse_live(source: &str, message: &str) -> Option<LiveReport> {
    if !source.starts_with("https://www.youtube.com/") || message.len() > 2048 {
        return None;
    }
    let r: LiveReport = serde_json::from_str(message.strip_prefix("musicapp-live:")?).ok()?;
    let ok_levels = r.levels.is_none_or(|l| [l.fast, l.momentary, l.short, l.gain].iter().chain(l.bands.iter().flatten()).all(|v| v.is_finite() && (-200.0..=60.0).contains(v)) && l.peak.is_finite() && (0.0..=16.0).contains(&l.peak));
    let ok_end = r.end.is_none_or(|e| e.is_finite() && (0.0..=86_400.0).contains(&e));
    (ok_levels && ok_end && r.error.as_ref().is_none_or(|e| e.chars().count() <= 200)).then_some(r)
}

/// Trust boundary: video id from the UI.
pub fn watch_url(video: &str, start_s: f64) -> Option<Url> {
    let id_ok = video.len() == 11 && video.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    let start = if start_s.is_finite() && start_s > 0.0 { start_s as u64 } else { 0 };
    id_ok.then(|| Url::parse(&format!("https://www.youtube.com/watch?v={video}&t={start}s")).ok()).flatten()
}

/// Player commands the UI may send. Built into a script from fixed names and numbers only.
#[derive(Debug, Clone, Copy, Deserialize, ts_rs::TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export, rename = "WatchCmd")]
pub enum Cmd {
    Play,
    Pause,
    Seek { seconds: f64 },
    Volume { percent: f64 },
    /// Show only this part of the video frame (black bars cut, fractions), like the embed's crop.
    Crop { x: f64, y: f64, w: f64, h: f64 },
    /// Live processing settings (live.js), same shape as the embed's.
    #[serde(rename_all = "camelCase")]
    Live {
        on: bool,
        /// Levels only: the video keeps its own sound.
        #[serde(default)]
        listen: bool,
        adaptive: bool,
        target_lufs: f64,
        /// The app fades the song out: Adaptive Sound holds.
        #[serde(default)]
        ending: bool,
        /// The visualizer wants the bands.
        #[serde(default)]
        bands: bool,
        /// Adaptive Sound gain a new song starts from, dB (the last song's).
        #[serde(default)]
        gain: Option<f64>,
        /// Live Editor settings; absent = unchanged.
        #[serde(default)]
        #[ts(optional)]
        effects: Option<music_player::Effects>,
    },
}

pub fn script(cmd: Cmd) -> String {
    let call = |name: &str, v: f64| format!("window.__musicAppWatch && window.__musicAppWatch.cmd('{name}', {v})");
    match cmd {
        Cmd::Play => call("play", 0.0),
        Cmd::Pause => call("pause", 0.0),
        Cmd::Seek { seconds } => call("seek", if seconds.is_finite() { seconds.max(0.0) } else { 0.0 }),
        Cmd::Volume { percent } => call("volume", if percent.is_finite() { percent.clamp(0.0, 100.0).round() } else { 100.0 }),
        Cmd::Live { on, listen, adaptive, target_lufs, ending, bands, gain, effects } => {
            let t = if target_lufs.is_finite() { target_lufs.clamp(-30.0, -6.0) } else { -14.0 };
            let gain = gain.filter(|g| g.is_finite()).map_or_else(|| "null".into(), |g| g.clamp(-12.0, 9.0).to_string());
            // Clamped, then JSON of numbers and booleans only: nothing to inject.
            let fx = effects.map(|e| serde_json::to_string(&e.clamped()).unwrap_or_else(|_| "undefined".into())).unwrap_or_else(|| "undefined".into());
            format!("window.__musicAppLive && window.__musicAppLive.set({{ on: {on}, listen: {listen}, adaptive: {adaptive}, targetLufs: {t}, ending: {ending}, bands: {bands}, gain: {gain} }}, {fx})")
        }
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

/// Where the UI last asked the webview to be (None = hidden). Kept even before the webview exists: a hide sent while it
/// is still being made (cover mode at launch, 2026-10-21 report: the video showed over the cover) applies once it is.
static WANTED: Mutex<Option<Rect>> = Mutex::new(None);

/// Loads `video` from `start_s` in the watch webview over `rect`, or hidden (made on first use, reused after).
pub fn open(app: &AppHandle, video: &str, start_s: f64, rect: Option<Rect>, shield: Arc<music_shield::Shield>) -> anyhow::Result<()> {
    let url = watch_url(video, start_s).ok_or_else(|| anyhow::anyhow!("Invalid video id"))?;
    *WANTED.lock().unwrap() = rect;
    if let Some(wv) = app.get_webview(LABEL) {
        wv.navigate(url)?;
        apply(&wv)?;
        return Ok(());
    }
    let window = app.get_window("main").ok_or_else(|| anyhow::anyhow!("No main window"))?;
    let mut builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url)).additional_browser_args(crate::background::BROWSER_ARGS).initialization_script(music_shield::WATCH_SCRIPT).initialization_script(music_shield::LIVE_SCRIPT).on_navigation(allowed).background_color(tauri::window::Color(0, 0, 0, 255));
    if shield.enabled.load(std::sync::atomic::Ordering::Relaxed) {
        builder = builder.initialization_script_for_all_frames(music_shield::YOUTUBE_SCRIPT);
    }
    let start = rect.unwrap_or(UNSEEN);
    let wv = window.add_child(builder, start.position(), start.size())?;
    #[cfg(windows)]
    {
        crate::shield::install(&wv, shield)?;
        listen(&wv, app.clone())?;
    }
    // Moves or hides asked while it was being made.
    apply(&wv)?;
    Ok(())
}

/// Unseen = 1 px in the window's corner, still shown: Chromium never starts the media of a page that was never visible
/// (a watch page made hidden stayed buffering at 0:00, 2026-10-21).
const UNSEEN: Rect = Rect { x: 0.0, y: 0.0, width: 1.0, height: 1.0 };

fn apply(wv: &tauri::Webview) -> tauri::Result<()> {
    let r = WANTED.lock().unwrap().unwrap_or(UNSEEN);
    wv.set_position(r.position())?;
    wv.set_size(r.size())?;
    wv.show()
}

/// Follows the video slot; None = hidden (cover mode): it keeps playing, unseen.
pub fn place(app: &AppHandle, rect: Option<Rect>) -> tauri::Result<()> {
    *WANTED.lock().unwrap() = rect;
    match app.get_webview(LABEL) {
        Some(wv) => apply(&wv),
        None => Ok(()),
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
            let (source, message) = (take_pwstr(source), take_pwstr(message));
            if let Some(report) = parse_report(&source, &message) {
                let _ = app.emit_to("main", "ytwatch", report);
            } else if let Some(live) = parse_live(&source, &message) {
                let _ = app.emit_to("main", "live", live);
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
    fn live_reports_are_checked() {
        let ok = parse_live(YT, r#"musicapp-live:{"levels":{"fast":-10,"momentary":-12.5,"short":-14,"peak":0.8,"gain":2}}"#).unwrap();
        assert_eq!(ok.levels.unwrap().short, -14.0);
        assert_eq!(parse_live(YT, r#"musicapp-live:{"attached":true}"#).unwrap().attached, Some(true));
        assert!(parse_live(YT, r#"musicapp-live:{"levels":{"fast":0,"momentary":1e9,"short":0,"peak":0,"gain":0}}"#).is_none());
        let bands = parse_live(YT, r#"musicapp-live:{"levels":{"fast":0,"momentary":0,"short":0,"peak":0,"gain":0,"bands":[-3,-120,0,0,0,0,0,0,0,0,0,0,0,0,0,-60]}}"#).unwrap();
        assert_eq!(bands.levels.unwrap().bands.unwrap()[15], -60.0);
        assert!(parse_live(YT, r#"musicapp-live:{"levels":{"fast":0,"momentary":0,"short":0,"peak":0,"gain":0,"bands":[1e9,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}}"#).is_none());
        assert!(parse_live(YT, r#"musicapp-live:{"levels":{"fast":0,"momentary":0,"short":0,"peak":0,"gain":0,"bands":[0,0]}}"#).is_none());
        assert!(parse_live("https://x.example/", r#"musicapp-live:{"attached":true}"#).is_none());
        assert!(parse_live(YT, r#"musicapp-ytwatch:{"state":1}"#).is_none());
        assert_eq!(parse_live(YT, r#"musicapp-live:{"end":212.4}"#).unwrap().end, Some(212.4));
        assert!(parse_live(YT, r#"musicapp-live:{"end":-1}"#).is_none());
        assert_eq!(script(Cmd::Live { on: true, listen: false, adaptive: false, target_lufs: -99.0, ending: false, bands: true, gain: None, effects: None }), "window.__musicAppLive && window.__musicAppLive.set({ on: true, listen: false, adaptive: false, targetLufs: -30, ending: false, bands: true, gain: null }, undefined)");
        assert!(script(Cmd::Live { on: true, listen: false, adaptive: true, target_lufs: -14.0, ending: true, bands: false, gain: Some(40.0), effects: None }).contains("ending: true, bands: false, gain: 9 }"));
        assert!(script(Cmd::Live { on: true, listen: false, adaptive: true, target_lufs: -14.0, ending: false, bands: false, gain: Some(f64::NAN), effects: None }).contains("gain: null }"));
        let with = script(Cmd::Live { on: true, listen: true, adaptive: false, target_lufs: -14.0, ending: false, bands: false, gain: None, effects: Some(music_player::Effects { speed: 9.0, ..Default::default() }) });
        assert!(with.contains("\"speed\":2.5") && with.contains("listen: true") && with.ends_with("})"), "{with}");
        // The UI's shape (api.ts WatchCmd).
        let cmd: Cmd = serde_json::from_str(r#"{"type":"live","on":true,"adaptive":true,"targetLufs":-16}"#).unwrap();
        assert!(matches!(cmd, Cmd::Live { on: true, listen: false, adaptive: true, target_lufs, ending: false, bands: false, gain: None, effects: None } if target_lufs == -16.0));
        let cmd: Cmd = serde_json::from_str(r#"{"type":"live","on":true,"adaptive":true,"targetLufs":-16,"ending":true,"gain":-3.5}"#).unwrap();
        assert!(matches!(cmd, Cmd::Live { ending: true, gain: Some(g), .. } if g == -3.5));
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
