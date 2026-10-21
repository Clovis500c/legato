//! Ad/tracker blocker: Brave's adblock engine over EasyList + EasyPrivacy, cached on disk.

use adblock::Engine;
use adblock::request::Request;
use anyhow::Result;
use std::path::Path;
use std::sync::RwLock;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

/// Fetched at runtime, not bundled: lists keep their own licenses.
pub const LISTS: [(&str, &str); 2] = [
    ("easylist.txt", "https://easylist.to/easylist/easylist.txt"),
    ("easyprivacy.txt", "https://easylist.to/easylist/easyprivacy.txt"),
];
/// Prunes ad slots in YouTube player data. Inject into all frames.
pub const YOUTUBE_SCRIPT: &str = include_str!("youtube.js");
/// Hides YouTube's overlays in bare embeds (controls=0). Inject into all frames, shield or not.
pub const BARE_SCRIPT: &str = include_str!("bare.js");
/// YouTube's watch page as a bare player, for videos that can't be embedded. Its own webview only, main frame.
pub const WATCH_SCRIPT: &str = include_str!("watch.js");
/// Live processing of YouTube's sound (Adaptive Sound, cover animation, Live Editor). Embed and watch page; idle until
/// the app asks.
pub const LIVE_SCRIPT: &str = include_str!("live.js");
const MAX_AGE: Duration = Duration::from_secs(4 * 24 * 3600);

/// Own rules so first offline launch still blocks YouTube / Google ad calls.
const FALLBACK: &str = "\
||doubleclick.net^
||googlesyndication.com^
||googleadservices.com^
||youtube.com/api/stats/ads
||youtube.com/pagead/
||youtube.com/ptracking
||youtube.com/get_midroll_
";

pub struct Shield {
    engine: RwLock<Engine>,
    pub enabled: AtomicBool,
    blocked: AtomicU64,
}

impl Shield {
    /// `lists` = raw filter text (cached EasyList etc.), may be empty.
    pub fn new(lists: &str, enabled: bool) -> Self {
        Self { engine: RwLock::new(engine(lists)), enabled: AtomicBool::new(enabled), blocked: AtomicU64::new(0) }
    }

    /// Swap in freshly downloaded lists.
    pub fn reload(&self, lists: &str) {
        *self.engine.write().unwrap() = engine(lists);
    }

    /// `kind` = adblock request type: script, xmlhttprequest, image, sub_frame, media, other…
    pub fn should_block(&self, url: &str, source_url: &str, kind: &str) -> bool {
        if !self.enabled.load(Ordering::Relaxed) || !url.starts_with("http") {
            return false;
        }
        let Ok(req) = Request::new(url, source_url, kind, "GET") else { return false };
        let hit = self.engine.read().unwrap().check_network_request(&req).should_block();
        if hit {
            self.blocked.fetch_add(1, Ordering::Relaxed);
        }
        hit
    }

    /// Requests blocked since launch.
    pub fn blocked(&self) -> u64 {
        self.blocked.load(Ordering::Relaxed)
    }
}

fn engine(lists: &str) -> Engine {
    Engine::new_with_list_text(format!("{FALLBACK}\n{lists}"))
}

/// Concatenated cached lists, "" if none yet.
pub fn cached_lists(dir: &Path) -> String {
    LISTS.iter().filter_map(|(f, _)| std::fs::read_to_string(dir.join(f)).ok()).collect::<Vec<_>>().join("\n")
}

/// Any list missing or older than 4 days.
pub fn lists_stale(dir: &Path) -> bool {
    LISTS.iter().any(|(f, _)| {
        let age = std::fs::metadata(dir.join(f)).and_then(|m| m.modified()).map(|t| SystemTime::now().duration_since(t).unwrap_or_default());
        age.map_or(true, |a| a > MAX_AGE)
    })
}

/// Download lists into `dir`, return concatenated text. Keeps old file on failure.
pub async fn download_lists(dir: &Path) -> Result<String> {
    std::fs::create_dir_all(dir)?;
    let http = reqwest::Client::new();
    for (file, url) in LISTS {
        let text = http.get(url).send().await?.error_for_status()?.text().await?;
        // Trust boundary: an HTML error page is not a filter list.
        anyhow::ensure!(text.starts_with('[') || text.starts_with('!'), "{url}: not a filter list");
        std::fs::write(dir.join(file), text)?;
    }
    Ok(cached_lists(dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    const YT: &str = "https://www.youtube.com/embed/abc";

    #[test]
    fn fallback_blocks_youtube_ads_offline() {
        let s = Shield::new("", true);
        assert!(s.should_block("https://googleads.g.doubleclick.net/pagead/id", YT, "xmlhttprequest"));
        assert!(s.should_block("https://www.youtube.com/api/stats/ads?ver=2", YT, "xmlhttprequest"));
        assert!(!s.should_block("https://www.youtube.com/youtubei/v1/player", YT, "xmlhttprequest"));
        assert!(!s.should_block("http://ipc.localhost/library", "http://tauri.localhost/", "xmlhttprequest"));
        assert_eq!(s.blocked(), 2);
    }

    #[test]
    fn list_rules_and_exceptions_apply() {
        let s = Shield::new("||ads.example.com^\n@@||ads.example.com/ok.js", true);
        assert!(s.should_block("https://ads.example.com/a.js", "https://site.test/", "script"));
        assert!(!s.should_block("https://ads.example.com/ok.js", "https://site.test/", "script"));
    }

    #[test]
    fn disabled_blocks_nothing_and_reload_swaps_rules() {
        let s = Shield::new("", false);
        assert!(!s.should_block("https://googleads.g.doubleclick.net/x", YT, "script"));
        s.enabled.store(true, Ordering::Relaxed);
        s.reload("||tracker.test^");
        assert!(s.should_block("https://tracker.test/p.gif", YT, "image"));
    }

    #[test]
    fn cache_reads_and_staleness() {
        let dir = tempfile::tempdir().unwrap();
        assert!(lists_stale(dir.path()));
        assert_eq!(cached_lists(dir.path()), "");
        for (f, _) in LISTS {
            std::fs::write(dir.path().join(f), "[Adblock Plus]\n||x.test^").unwrap();
        }
        assert!(!lists_stale(dir.path()));
        assert!(Shield::new(&cached_lists(dir.path()), true).should_block("https://x.test/a", YT, "script"));
    }
}
