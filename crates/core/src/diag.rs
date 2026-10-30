//! Local diagnostics log: errors, warnings and playback switches kept in a rotating file in the app data folder, so a
//! bug report carries facts. Nothing is ever sent: Settings › About › Copy diagnostics puts text in the clipboard and
//! the user pastes it where they choose. Pure: the writer thread, the panic hook and the commands are in
//! `src-tauri/src/diag.rs`.
//!
//! A line: `2026-10-30T12:34:56.789Z WARN update check failed | the raw error`. Before the bar: our own words, no song
//! titles, account names or paths. After it: whatever the error said, copied out only when the user ticks "Include
//! details". Secrets (tokens, cookies, URL queries, emails) never reach the file at all.

use regex::{Captures, Regex};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// The file written now. Older ones: `diagnostics.log.1` (newest) to `.4`.
pub const FILE: &str = "diagnostics.log";
/// One file's size, and how many rotate: 5 MB on disk at most.
pub const MAX_BYTES: u64 = 1 << 20;
pub const FILES: usize = 5;
/// Longest message and detail (chars): a line stays far below a file.
const MAX_MESSAGE: usize = 400;
const MAX_DETAIL: usize = 1600;
/// Between a message and its detail.
const BAR: &str = " | ";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    pub fn as_str(self) -> &'static str {
        match self {
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        }
    }

    /// `info`, `warn` / `warning`, `error`, any case. Anything else: none.
    pub fn from_word(word: &str) -> Option<Level> {
        match word.trim().to_ascii_lowercase().as_str() {
            "info" => Some(Level::Info),
            "warn" | "warning" => Some(Level::Warn),
            "error" => Some(Level::Error),
            _ => None,
        }
    }
}

// ---- Time ----

/// ISO 8601 in UTC with milliseconds: `2026-10-30T12:34:56.789Z`.
pub fn timestamp(t: SystemTime) -> String {
    let d = t.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs() as i64;
    let (days, rest) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let (y, m, day) = civil(days);
    format!("{y:04}-{m:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z", rest / 3600, rest % 3600 / 60, rest % 60, d.subsec_millis())
}

/// Days since 1970-01-01 → (year, month, day), Gregorian (Hinnant's civil_from_days).
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

// ---- Lines ----

/// `text` cut to `max` chars, an ellipsis at the cut.
fn cut(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut s: String = text.chars().take(max.saturating_sub(1)).collect();
    s.push('…');
    s
}

/// One line whatever the text holds: lines joined with " / ", control characters as spaces, cut.
fn one_line(text: &str, max: usize) -> String {
    let joined = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" / ");
    cut(&joined.chars().map(|c| if c.is_control() { ' ' } else { c }).collect::<String>(), max)
}

/// The area as one lowercase word (`update`, `sync`, `playback`…), 16 chars at most.
fn area_word(area: &str) -> String {
    let word: String = area.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')).take(16).collect();
    if word.is_empty() { "app".into() } else { word.to_ascii_lowercase() }
}

/// One log line, without its newline. Secrets are redacted here, so no caller can forget: the file never holds them.
pub fn format_line(time: &str, level: Level, area: &str, message: &str, detail: &str) -> String {
    // The bar splits a line when read back: none in the message.
    let message = one_line(&redact_secrets(message), MAX_MESSAGE).replace('|', "/");
    let detail = one_line(&redact_secrets(detail), MAX_DETAIL);
    let mut line = format!("{time} {} {} {message}", level.as_str(), area_word(area));
    if !detail.is_empty() {
        line.push_str(BAR);
        line.push_str(&detail);
    }
    line
}

/// A line read back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub time: String,
    pub level: Level,
    pub area: String,
    pub message: String,
    pub detail: Option<String>,
}

/// None for anything that isn't a line written by `format_line` (a cut one, a foreign one).
pub fn parse_line(line: &str) -> Option<Entry> {
    let mut parts = line.trim_end().splitn(4, ' ');
    let time = parts.next().filter(|t| t.len() == 24 && t.ends_with('Z'))?;
    let level = Level::from_word(parts.next()?)?;
    let area = parts.next()?;
    let rest = parts.next().unwrap_or("");
    let (message, detail) = match rest.split_once(BAR) {
        Some((m, d)) => (m, Some(d.to_string())),
        None => (rest, None),
    };
    Some(Entry { time: time.into(), level, area: area.into(), message: message.into(), detail })
}

// ---- Redaction ----

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("valid regex")
}

// A URL's query and fragment: they carry codes, tokens and search words.
static URL_QUERY: LazyLock<Regex> = LazyLock::new(|| re(r##"(?i)\b([a-z][a-z0-9+.-]{1,15}://[^\s?#"'<>()\[\]]+)[?#][^\s"'<>()\[\]]*"##));
static BEARER: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}"));
// A JSON web token whole: its payload holds ids and emails.
static JWT: LazyLock<Regex> = LazyLock::new(|| re(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?"));
static COOKIE: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)\b((?:set-)?cookie)\s*[:=][^\r\n]*"));
// Google's session cookies by name, wherever they show up.
static COOKIE_NAME: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)\b(sapisid|apisid|ssid|hsid|sid|sidcc|login_info|visitor_info1_live|ysc|__secure-[a-z0-9_-]+|__host-[a-z0-9_-]+)\s*=\s*[^\s;,]+"));
static KEY_VALUE: LazyLock<Regex> = LazyLock::new(|| re(r##"(?i)\b([a-z0-9_-]*(?:token|secret|password|passwd|api[_-]?key|authorization|session[_-]?id|signature))\b("?\s*[:=]\s*"?)[^\s"',;&}]{3,}"##));
static EMAIL: LazyLock<Regex> = LazyLock::new(|| re(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+"));
// Long runs of letters and digits: keys, hashes, ids of a session.
static OPAQUE: LazyLock<Regex> = LazyLock::new(|| re(r"[A-Za-z0-9_+-]{32,}"));
// A Windows user folder, whoever it is: `C:\Users\jane`, `C:/Users/jane`, `\\?\C:\Users\jane`.
static USER_DIR: LazyLock<Regex> = LazyLock::new(|| re(r##"(?i)(?:\\\\\?\\)?[a-z]:[\\/]+users[\\/]+[^\\/\s"'<>|:*?]+"##));

/// The text without what must never be kept or shown: URL queries and fragments, bearer tokens, cookies, `token=…`
/// style values, emails, long opaque strings. Always applied, "Include details" or not.
pub fn redact_secrets(text: &str) -> String {
    let s = URL_QUERY.replace_all(text, "${1}?<redacted>");
    let s = BEARER.replace_all(&s, "$1 <redacted>");
    let s = JWT.replace_all(&s, "<redacted>");
    let s = COOKIE.replace_all(&s, "$1: <redacted>");
    let s = COOKIE_NAME.replace_all(&s, "$1=<redacted>");
    let s = KEY_VALUE.replace_all(&s, "$1$2<redacted>");
    let s = EMAIL.replace_all(&s, "<email>");
    let secret = |run: &str| run.chars().any(|c| c.is_ascii_digit()) && run.chars().any(|c| c.is_ascii_alphabetic());
    OPAQUE.replace_all(&s, |c: &Captures| if secret(&c[0]) { "<redacted>".to_string() } else { c[0].to_string() }).into_owned()
}

/// Whose traces to hide from a copied report: the Windows profile folder and the account name.
#[derive(Debug, Clone, Default)]
pub struct Who {
    pub profile: Option<String>,
    pub user: Option<String>,
}

impl Who {
    pub fn from_env() -> Who {
        let var = |names: &[&str]| names.iter().find_map(|n| std::env::var(n).ok()).filter(|v| !v.trim().is_empty());
        Who { profile: var(&["USERPROFILE", "HOME"]), user: var(&["USERNAME", "USER"]) }
    }
}

/// The user's folder as `%USERPROFILE%` (the exact profile path of `who` first, so a name with spaces goes whole, then
/// any `C:\Users\name`), the account name as `<user>` where it stands alone in a path.
pub fn redact_paths(text: &str, who: &Who) -> String {
    let mut s = text.to_string();
    if let Some(profile) = who.profile.as_deref().map(|p| p.trim().trim_end_matches(['\\', '/'])).filter(|p| p.len() >= 4) {
        // Any slash, any case: one folder written several ways.
        let pattern: String = profile.chars().map(|c| if matches!(c, '\\' | '/') { r"[\\/]+".to_string() } else { regex::escape(&c.to_string()) }).collect();
        s = re(&format!("(?i){pattern}")).replace_all(&s, "%USERPROFILE%").into_owned();
    }
    s = USER_DIR.replace_all(&s, "%USERPROFILE%").into_owned();
    if let Some(user) = who.user.as_deref().map(str::trim).filter(|u| u.len() >= 3) {
        s = re(&format!(r##"(?i)([\\/]){}([\\/\s"'<>)]|$)"##, regex::escape(user))).replace_all(&s, "$1<user>$2").into_owned();
    }
    s
}

/// Secrets and the user's traces out: what a copied report shows when "Include details" is off.
pub fn redact(text: &str, who: &Who) -> String {
    redact_paths(&redact_secrets(text), who)
}

// ---- The rotating file ----

fn file_path(dir: &Path, n: usize) -> PathBuf {
    if n == 0 { dir.join(FILE) } else { dir.join(format!("{FILE}.{n}")) }
}

/// Size-rotating writer: `diagnostics.log` grows to `max` bytes, then becomes `.1` (`.1` → `.2`…), the oldest goes. The
/// time-based appenders of the usual logging crates can't hold a size, so this one is ours. Opened on the first line, not
/// before: nothing touches the disk at startup.
pub struct Log {
    dir: PathBuf,
    max: u64,
    files: usize,
    open: Option<(fs::File, u64)>,
}

impl Log {
    /// 5 files of 1 MB.
    pub fn new(dir: impl Into<PathBuf>) -> Log {
        Log::with_limits(dir, MAX_BYTES, FILES)
    }

    pub fn with_limits(dir: impl Into<PathBuf>, max: u64, files: usize) -> Log {
        Log { dir: dir.into(), max: max.max(2), files: files.max(1), open: None }
    }

    /// Adds a line. One that wouldn't fit moves the file to `.1` first; a line longer than a file is cut. Any failure
    /// (full disk, a locked file) is the caller's to ignore: nothing is written past the limit either way.
    pub fn append(&mut self, line: &str) -> io::Result<()> {
        let line = line.trim_end_matches(['\r', '\n']);
        let mut end = line.len().min(self.max as usize - 1);
        while !line.is_char_boundary(end) {
            end -= 1;
        }
        let mut bytes = line.as_bytes()[..end].to_vec();
        bytes.push(b'\n');
        let size = self.size()?;
        if size > 0 && size + bytes.len() as u64 > self.max {
            self.rotate()?;
        }
        let (file, size) = self.open.as_mut().ok_or_else(|| io::Error::other("log closed"))?;
        file.write_all(&bytes)?;
        *size += bytes.len() as u64;
        Ok(())
    }

    /// Size of the file being written, opened if it isn't yet. A file already over the limit (left by something else)
    /// starts over: the limit holds for everything this writer touches.
    fn size(&mut self) -> io::Result<u64> {
        if let Some((_, size)) = &self.open {
            return Ok(*size);
        }
        fs::create_dir_all(&self.dir)?;
        let path = file_path(&self.dir, 0);
        if fs::metadata(&path).is_ok_and(|m| m.len() > self.max) {
            fs::File::create(&path)?;
        }
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        let size = file.metadata()?.len();
        self.open = Some((file, size));
        Ok(size)
    }

    fn rotate(&mut self) -> io::Result<()> {
        // Closed first: a file can't move while this writer holds it.
        self.open = None;
        if self.files == 1 {
            fs::File::create(file_path(&self.dir, 0))?;
        } else {
            let _ = fs::remove_file(file_path(&self.dir, self.files - 1));
            for n in (0..self.files - 1).rev() {
                let from = file_path(&self.dir, n);
                if from.exists() {
                    fs::rename(&from, file_path(&self.dir, n + 1))?;
                }
            }
        }
        self.size().map(|_| ())
    }
}

/// The newest `n` entries that `want` accepts, oldest first. Files are read newest first, so a long log costs what was asked.
pub fn recent(dir: &Path, want: impl Fn(&Entry) -> bool, n: usize) -> Vec<Entry> {
    let mut out = Vec::new();
    'files: for k in 0..FILES {
        let Ok(bytes) = fs::read(file_path(dir, k)) else { continue };
        for line in String::from_utf8_lossy(&bytes).lines().rev() {
            if let Some(entry) = parse_line(line).filter(&want) {
                out.push(entry);
                if out.len() >= n {
                    break 'files;
                }
            }
        }
    }
    out.reverse();
    out
}

// ---- The report ----

/// Settings worth knowing in a bug report: how the app plays, updates and shows itself. Plain values only.
const SETTINGS: &[&str] = &[
    "language", "shield", "autoUpdate", "closeToTray", "resume", "reopen", "autoplay", "crossfade", "skipLong", "stage", "youtubeControls", "adaptiveSound", "liveYoutube", "earlyEnds",
    "immersive", "motion", "miniPlace", "sidePanel", "visualizer", "coverPulse", "voiceSearch", "detector", "zoom", "textSize", "defaultsVersion",
];

/// `key=value` for those settings of the interface's settings object (on / off, numbers, short words), then the add-ons that are on.
pub fn settings_line(ui: &Value) -> String {
    let mut parts = Vec::new();
    for key in SETTINGS {
        match ui.get(key) {
            Some(Value::Bool(b)) => parts.push(format!("{key}={}", if *b { "on" } else { "off" })),
            Some(Value::Number(n)) => parts.push(format!("{key}={n}")),
            Some(Value::String(s)) if s.len() <= 24 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')) => parts.push(format!("{key}={s}")),
            _ => {}
        }
    }
    let on: Vec<&str> = ui
        .get("addons")
        .and_then(Value::as_object)
        .map(|m| m.iter().filter(|(k, v)| v.as_bool() == Some(true) && k.len() <= 32 && k.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))).map(|(k, _)| k.as_str()).collect())
        .unwrap_or_default();
    if !on.is_empty() {
        parts.push(format!("addons={}", on.join(",")));
    }
    parts.join(" ")
}

/// Which part a sync error names, from the words `sync` starts its errors with (`spotify: …`, `match "Title": …`): the
/// rest of such a text holds playlist names and song titles, so only this goes in a message.
pub fn failing_part(error: &str) -> &'static str {
    let e = error.trim_start();
    let starts = |w: &str| e.len() >= w.len() && e.is_char_boundary(w.len()) && e[..w.len()].eq_ignore_ascii_case(w) && !e[w.len()..].starts_with(|c: char| c.is_alphanumeric());
    [("youtube music", "YouTube Music"), ("youtube", "YouTube"), ("spotify", "Spotify"), ("apple", "Apple Music"), ("library", "Library"), ("match", "Song matching"), ("liked music", "Liked Music")]
        .into_iter()
        .find(|(w, _)| starts(w))
        .map_or("A service", |(_, name)| name)
}

fn show(e: &Entry, details: bool, who: &Who) -> String {
    let head = format!("{} {} {}", e.time, e.level.as_str(), e.area);
    match (&e.detail, details) {
        (Some(d), true) => format!("{head} {} | {}", redact_secrets(&e.message), redact_secrets(d)),
        (Some(_), false) => format!("{head} {} [details left out]", redact(&e.message, who)),
        (None, true) => format!("{head} {}", redact_secrets(&e.message)),
        (None, false) => format!("{head} {}", redact(&e.message, who)),
    }
}

/// The text Settings › About › Copy diagnostics puts in the clipboard. `facts` = "Version", "Windows"… rows from the
/// shell; `problems` = the latest warnings and errors, `events` = the latest plain lines (starts, playback switches).
/// Without `details`, what an error said (after the bar) stays out and the user's folder and name are hidden.
pub fn report(now: SystemTime, facts: &[(String, String)], problems: &[Entry], events: &[Entry], details: bool, who: &Who) -> String {
    let mut out = format!("Legato diagnostics, {}\n", timestamp(now));
    out.push_str(if details { "Details: included (song titles, account names and file paths can appear)\n" } else { "Details: left out (song titles, account names and file paths)\n" });
    out.push('\n');
    for (name, value) in facts {
        out.push_str(&format!("{name}: {value}\n"));
    }
    for (title, list) in [("Errors and warnings", problems), ("Recent events", events)] {
        out.push_str(&format!("\n{title} ({} latest)\n", list.len()));
        if list.is_empty() {
            out.push_str("none\n");
        }
        for e in list {
            out.push_str(&show(e, details, who));
            out.push('\n');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn at(secs: u64, ms: u32) -> SystemTime {
        UNIX_EPOCH + Duration::new(secs, ms * 1_000_000)
    }

    fn sizes(dir: &Path) -> Vec<u64> {
        (0..FILES).filter_map(|n| fs::metadata(file_path(dir, n)).ok()).map(|m| m.len()).collect()
    }

    #[test]
    fn five_files_of_one_megabyte() {
        assert_eq!(MAX_BYTES * FILES as u64, 5 << 20);
    }

    #[test]
    fn rotation_keeps_the_newest_and_never_passes_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        let mut log = Log::with_limits(dir.path(), 200, 3);
        for i in 0..120 {
            log.append(&format!("line {i:03} with enough padding to fill a file fast")).unwrap();
            let s = sizes(dir.path());
            assert!(s.len() <= 3, "{} files after line {i}", s.len());
            assert!(s.iter().all(|n| *n <= 200), "{s:?} after line {i}");
        }
        // Newest in the current file, older in .1 and .2 (higher number = older), the rest gone.
        let read = |n| fs::read_to_string(file_path(dir.path(), n)).unwrap();
        assert!(read(0).contains("line 119"));
        let all = [read(2), read(1), read(0)].concat();
        let numbers: Vec<u32> = all.lines().map(|l| l[5..8].parse().unwrap()).collect();
        assert!(numbers.windows(2).all(|w| w[1] == w[0] + 1), "oldest to newest, no gap: {numbers:?}");
        assert!(!all.contains("line 000"));
        assert!(!file_path(dir.path(), 3).exists());
    }

    #[test]
    fn the_real_limits_hold_over_a_flood() {
        let dir = tempfile::tempdir().unwrap();
        let mut log = Log::new(dir.path());
        let line = format_line("2026-10-30T12:00:00.000Z", Level::Error, "test", &"x ".repeat(190), &"detail ".repeat(200));
        // About 1.6 KB each, 9000 of them: 14 MB through a 5 MB window.
        for _ in 0..9000 {
            log.append(&line).unwrap();
        }
        let s = sizes(dir.path());
        assert_eq!(s.len(), FILES);
        assert!(s.iter().all(|n| *n <= MAX_BYTES), "{s:?}");
        assert!(s.iter().sum::<u64>() <= 5 << 20);
    }

    #[test]
    fn a_line_longer_than_a_file_is_cut_to_fit() {
        let dir = tempfile::tempdir().unwrap();
        let mut log = Log::with_limits(dir.path(), 50, 2);
        log.append(&"é".repeat(200)).unwrap();
        let text = fs::read_to_string(file_path(dir.path(), 0)).unwrap();
        assert!(text.len() <= 50 && text.ends_with('\n'), "{} bytes", text.len());
    }

    #[test]
    fn a_file_left_over_the_limit_starts_over() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(file_path(dir.path(), 0), "x".repeat(500)).unwrap();
        let mut log = Log::with_limits(dir.path(), 100, 2);
        log.append("fresh").unwrap();
        assert_eq!(fs::read_to_string(file_path(dir.path(), 0)).unwrap(), "fresh\n");
    }

    #[test]
    fn one_file_keeps_only_itself() {
        let dir = tempfile::tempdir().unwrap();
        let mut log = Log::with_limits(dir.path(), 30, 1);
        for i in 0..20 {
            log.append(&format!("line {i}")).unwrap();
        }
        assert_eq!(sizes(dir.path()).len(), 1);
        assert!(fs::read_to_string(file_path(dir.path(), 0)).unwrap().contains("line 19"));
    }

    #[test]
    fn writes_continue_in_the_file_of_the_last_run() {
        let dir = tempfile::tempdir().unwrap();
        Log::new(dir.path()).append("first run").unwrap();
        Log::new(dir.path()).append("second run").unwrap();
        assert_eq!(fs::read_to_string(file_path(dir.path(), 0)).unwrap(), "first run\nsecond run\n");
    }

    #[test]
    fn time_is_iso_in_utc() {
        assert_eq!(timestamp(at(0, 0)), "1970-01-01T00:00:00.000Z");
        assert_eq!(timestamp(at(1_700_000_000, 123)), "2023-11-14T22:13:20.123Z");
        assert_eq!(timestamp(at(951_782_400, 0)), "2000-02-29T00:00:00.000Z", "leap day");
        assert_eq!(timestamp(at(4_102_444_799, 999)), "2099-12-31T23:59:59.999Z");
    }

    #[test]
    fn a_line_reads_back_whatever_it_held() {
        let line = format_line("2026-10-30T12:34:56.789Z", Level::Warn, "Update", "check | failed\nsecond line", "boom\r\nat x");
        assert!(!line.contains('\n') && !line.contains('\r'));
        let e = parse_line(&line).unwrap();
        assert_eq!((e.level, e.area.as_str(), e.message.as_str()), (Level::Warn, "update", "check / failed / second line"));
        assert_eq!(e.detail.as_deref(), Some("boom / at x"));
        let plain = parse_line(&format_line("2026-10-30T12:34:56.789Z", Level::Info, "app", "started 1.0.0", "")).unwrap();
        assert_eq!((plain.message.as_str(), plain.detail), ("started 1.0.0", None));
        assert!(parse_line("not a log line").is_none());
        assert!(parse_line("2026-10-30T12:34:56.789Z LOUD app x").is_none());
    }

    #[test]
    fn long_texts_are_cut_and_areas_are_one_word() {
        let line = format_line("2026-10-30T12:34:56.789Z", Level::Error, "Play back!!", &"m".repeat(1000), &"d".repeat(5000));
        assert!(line.len() < 2100, "{} bytes", line.len());
        let e = parse_line(&line).unwrap();
        assert_eq!(e.area, "playback");
        assert!(e.message.ends_with('…') && e.detail.unwrap().ends_with('…'));
        assert_eq!(parse_line(&format_line("2026-10-30T12:34:56.789Z", Level::Info, "!!", "x", "")).unwrap().area, "app");
    }

    #[test]
    fn secrets_never_reach_a_line() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let texts = [
            "error sending request for url (https://accounts.example.com/token?code=SECRETCODE123&state=abc)".to_string(),
            "GET http://127.0.0.1:5173/callback?code=SECRETCODE123#frag".to_string(),
            "Authorization: Bearer abcdef123456SECRET".to_string(),
            format!("token {jwt}"),
            "Cookie: SID=SECRETSID; HSID=SECRETHSID; other=SECRET".to_string(),
            "refused SAPISID=SECRETSAPISID and __Secure-1PSID=SECRETPSID".to_string(),
            r#"{"access_token":"SECRETACCESS","refresh_token":"SECRETREFRESH","spotify_client_secret":"SECRETCLIENT"}"#.to_string(),
            "password=SECRETPASS api_key: SECRETKEY".to_string(),
            "signed in as jane.doe@example.com".to_string(),
            "id a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6 hash".to_string(),
        ];
        for t in texts {
            for part in [format_line("2026-10-30T12:34:56.789Z", Level::Error, "x", &t, ""), format_line("2026-10-30T12:34:56.789Z", Level::Error, "x", "m", &t)] {
                assert!(!part.contains("SECRET") && !part.contains("jane.doe") && !part.contains("a1b2c3d4e5f6") && !part.contains("eyJ"), "{t} -> {part}");
            }
        }
        // What isn't secret stays: the host and path of a URL, short ids, words.
        let kept = redact_secrets("GET https://music.youtube.com/youtubei/v1/browse?key=K failed for video dQw4w9WgXcQ: token expired");
        assert!(kept.contains("https://music.youtube.com/youtubei/v1/browse?<redacted>") && kept.contains("dQw4w9WgXcQ") && kept.contains("token expired"), "{kept}");
        assert_eq!(redact_secrets("a-long-name-made-only-of-letters-and-dashes-without-digits"), "a-long-name-made-only-of-letters-and-dashes-without-digits");
    }

    fn who() -> Who {
        Who { profile: Some(r"C:\Users\Jane Doe".into()), user: Some("Jane".into()) }
    }

    #[test]
    fn the_users_folder_and_name_go_from_paths() {
        let w = who();
        assert_eq!(redact_paths(r"can't open C:\Users\Jane Doe\Music\a.mp3", &w), r"can't open %USERPROFILE%\Music\a.mp3");
        assert_eq!(redact_paths("C:/users/jane doe/Music", &w), "%USERPROFILE%/Music");
        assert_eq!(redact_paths(r"\\?\C:\Users\Someone\x", &Who::default()), r"%USERPROFILE%\x");
        assert_eq!(redact_paths(r"D:\Users\bob\x and E:\users\amy", &Who::default()), r"%USERPROFILE%\x and %USERPROFILE%");
        assert_eq!(redact_paths(r"\\PC\Jane\share and D:\Music", &Who { profile: None, user: Some("Jane".into()) }), r"\\PC\<user>\share and D:\Music");
        assert_eq!(redact_paths("Janet and Jane's", &w), "Janet and Jane's", "a name in prose isn't a path");
    }

    #[test]
    fn a_forced_error_shows_in_the_report() {
        let dir = tempfile::tempdir().unwrap();
        let mut log = Log::new(dir.path());
        let add = |log: &mut Log, level, area: &str, message: &str, detail: &str| log.append(&format_line("2026-10-30T12:00:00.000Z", level, area, message, detail)).unwrap();
        add(&mut log, Level::Info, "app", "started 1.0.0", "");
        add(&mut log, Level::Info, "playback", "embed refused: watch page", "");
        add(&mut log, Level::Error, "forced", "test error", r"C:\Users\Jane Doe\Music\Secret Song.mp3 token=SECRETTOKEN me@mail.com");
        add(&mut log, Level::Warn, "update", "check failed", "");

        let problems = recent(dir.path(), |e| e.level >= Level::Warn, 20);
        let events = recent(dir.path(), |e| e.level == Level::Info, 10);
        let facts = [("Version".to_string(), "1.0.0".to_string()), ("Windows".to_string(), "11 build 26300".to_string())];

        let safe = report(at(1_700_000_000, 0), &facts, &problems, &events, false, &who());
        assert!(safe.contains("Version: 1.0.0") && safe.contains("Windows: 11 build 26300"), "{safe}");
        assert!(safe.contains("ERROR forced test error [details left out]") && safe.contains("WARN update check failed"), "{safe}");
        assert!(safe.contains("embed refused: watch page") && safe.contains("started 1.0.0"), "{safe}");
        for hidden in ["Secret Song", "Jane", "SECRETTOKEN", "me@mail.com"] {
            assert!(!safe.contains(hidden), "{hidden} in {safe}");
        }

        let full = report(at(1_700_000_000, 0), &facts, &problems, &events, true, &who());
        assert!(full.contains(r"C:\Users\Jane Doe\Music\Secret Song.mp3"), "{full}");
        assert!(!full.contains("SECRETTOKEN") && !full.contains("me@mail.com"), "secrets stay out even with details: {full}");
    }

    #[test]
    fn recent_reads_across_files_oldest_first() {
        let dir = tempfile::tempdir().unwrap();
        let mut log = Log::with_limits(dir.path(), 300, 3);
        for i in 0..40 {
            log.append(&format_line("2026-10-30T12:00:00.000Z", if i % 4 == 0 { Level::Error } else { Level::Info }, "n", &i.to_string(), "")).unwrap();
        }
        let errors = recent(dir.path(), |e| e.level == Level::Error, 3);
        assert_eq!(errors.iter().map(|e| e.message.as_str()).collect::<Vec<_>>(), ["28", "32", "36"]);
        let numbers: Vec<u32> = recent(dir.path(), |_| true, usize::MAX).iter().map(|e| e.message.parse().unwrap()).collect();
        assert!(numbers.len() < 40 && numbers.windows(2).all(|w| w[1] == w[0] + 1) && numbers.last() == Some(&39), "{numbers:?}");
    }

    #[test]
    fn sync_errors_name_their_part_only() {
        assert_eq!(failing_part("spotify: HTTP 403"), "Spotify");
        assert_eq!(failing_part(r#"youtube "My Mix": timed out"#), "YouTube");
        assert_eq!(failing_part("YouTube Music: signed out"), "YouTube Music");
        assert_eq!(failing_part(r#"match "Some Song": no id"#), "Song matching");
        assert_eq!(failing_part("library: disk full"), "Library");
        assert_eq!(failing_part("Liked Music: refused"), "Liked Music");
        assert_eq!(failing_part("matching things"), "A service");
        assert_eq!(failing_part("éé"), "A service");
    }

    #[test]
    fn settings_show_plain_values_only() {
        let ui = serde_json::json!({
            "language": "fr", "shield": true, "autoUpdate": false, "crossfade": 6, "stage": "auto", "zoom": 1.25,
            "customThemes": [{"name": "Jane's secret theme"}], "theme": "custom-1", "discord": {"clientId": "123"},
            "miniPlace": "C:\\Users\\jane", "addons": {"discord": true, "lastfm": false, "bad id": true}
        });
        assert_eq!(settings_line(&ui), "language=fr shield=on autoUpdate=off crossfade=6 stage=auto zoom=1.25 addons=discord");
        assert_eq!(settings_line(&serde_json::json!({})), "");
    }
}
