//! Cover art and profile pictures: fetched by Rust from the services' image hosts only, kept on disk under a size cap.
//! The UI never hits the network: it loads images through the app's `art` URI scheme (src-tauri/src/art.rs).

use anyhow::{Context, Result, ensure};
use music_core::cache::{Lru, Stats};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tokio::sync::OnceCell;
use url::Url;

/// One image at most (animated avatars included).
const MAX_IMAGE: usize = 5 << 20;

/// Image hosts of YouTube, Google accounts, Apple and Spotify, and YouTube Music's own art paths (Liked Music's cover on
/// gstatic, My Mix covers drawn by music.youtube.com): both load without a session.
pub fn allowed(url: &str) -> bool {
    Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https"
            && u.host_str().is_some_and(|h| {
                ["i.ytimg.com", "yt3.ggpht.com", "i.scdn.co"].contains(&h)
                    || [".googleusercontent.com", ".mzstatic.com"].iter().any(|d| h.ends_with(d))
                    || (h == "www.gstatic.com" && u.path().starts_with("/youtube/media/ytm/"))
                    || (h == "music.youtube.com" && u.path().starts_with("/image/"))
            })
    })
}

/// Image type from magic bytes (cache files carry no headers).
pub fn sniff(b: &[u8]) -> &'static str {
    match b {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [b'G', b'I', b'F', ..] => "image/gif",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
        _ => "image/jpeg",
    }
}

/// Images kept in memory: a long list scrolls back without touching the disk.
const HOT_BUDGET: usize = 64 << 20;

type Image = (Vec<u8>, &'static str);
/// One pending read or download, shared by every caller of the same URL.
type Pending = Arc<OnceCell<Option<Arc<Image>>>>;

/// FNV-1a: stable file name per URL.
fn key(url: &str) -> String {
    format!("{:016x}", url.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| (h ^ u64::from(b)).wrapping_mul(0x100_0000_01b3)))
}

pub struct ArtCache {
    dir: PathBuf,
    cap: u64,
    used: AtomicU64,
    http: reqwest::Client,
    hot: Lru<Image>,
    /// Same image asked by many rows at once (an album's songs): one read or download, shared.
    inflight: Mutex<HashMap<String, Pending>>,
}

impl ArtCache {
    pub fn new(dir: PathBuf, cap: u64) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        let used = std::fs::read_dir(&dir).map(|d| d.flatten().filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum()).unwrap_or(0);
        // Redirects stay on image hosts too.
        let http = reqwest::Client::builder().redirect(reqwest::redirect::Policy::custom(|a| if allowed(a.url().as_str()) { a.follow() } else { a.stop() })).build().unwrap_or_default();
        Self { dir, cap, used: used.into(), http, hot: Lru::new(HOT_BUDGET), inflight: Mutex::default() }
    }

    /// Image bytes + type: from memory, from disk, else downloaded (allowed hosts only) and kept.
    pub async fn get(&self, url: &str) -> Result<(Vec<u8>, &'static str)> {
        ensure!(allowed(url), "Image host not allowed");
        let image = self.shared(url).await.context("Image not available")?;
        Ok((image.0.clone(), image.1))
    }

    /// Memory first; else one fetch per URL, whoever asks meanwhile waits for the same one.
    async fn shared(&self, url: &str) -> Option<Arc<Image>> {
        if let Some(hit) = self.hot.get(url) {
            return Some(hit);
        }
        let cell = self.inflight.lock().unwrap().entry(url.to_string()).or_default().clone();
        let image = cell.get_or_init(|| async { self.fetch(url).await.ok().map(Arc::new) }).await.clone();
        self.inflight.lock().unwrap().remove(url);
        if let Some(i) = &image {
            self.hot.put(url, i.clone(), i.0.len());
        }
        image
    }

    pub fn stats(&self) -> Stats {
        self.hot.stats()
    }

    async fn fetch(&self, url: &str) -> Result<(Vec<u8>, &'static str)> {
        let path = self.dir.join(key(url));
        if let Ok(bytes) = std::fs::read(&path) {
            // Recently used files survive pruning.
            let _ = std::fs::File::options().write(true).open(&path).and_then(|f| f.set_modified(SystemTime::now()));
            return Ok((bytes.clone(), sniff(&bytes)));
        }
        let res = self.http.get(url).send().await?.error_for_status()?;
        let image = res.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|t| t.starts_with("image/"));
        ensure!(image, "Not an image");
        ensure!(res.content_length().is_none_or(|n| n <= MAX_IMAGE as u64), "Image too large");
        let bytes = res.bytes().await?;
        ensure!(bytes.len() <= MAX_IMAGE, "Image too large");
        std::fs::write(&path, &bytes).context("Image cache")?;
        if self.used.fetch_add(bytes.len() as u64, Ordering::Relaxed) + bytes.len() as u64 > self.cap {
            self.prune();
        }
        Ok((bytes.to_vec(), sniff(&bytes)))
    }

    /// Least recently used files out until 80 % of the cap.
    fn prune(&self) {
        let Ok(dir) = std::fs::read_dir(&self.dir) else { return };
        let mut files: Vec<_> = dir.flatten().filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.metadata().ok()?.len(), e.path()))).collect();
        files.sort();
        let mut used: u64 = files.iter().map(|f| f.1).sum();
        for (_, len, path) in files {
            if used <= self.cap * 4 / 5 {
                break;
            }
            if std::fs::remove_file(path).is_ok() {
                used -= len;
            }
        }
        self.used.store(used, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;

    #[test]
    fn allows_service_image_hosts_only() {
        for ok in ["https://i.ytimg.com/vi/x/hqdefault.jpg", "https://lh3.googleusercontent.com/a=w544-h544", "https://yt3.ggpht.com/p=s88", "https://is1-ssl.mzstatic.com/image/a/600x600bb.jpg", "https://i.scdn.co/image/ab", "https://www.gstatic.com/youtube/media/ytm/images/pbg/liked-songs-delhi-576.png", "https://music.youtube.com/image/mixart?r=EN"] {
            assert!(allowed(ok), "{ok}");
        }
        for bad in ["http://i.ytimg.com/x", "https://evil.example/x.jpg", "https://googleusercontent.com.evil.example/x", "file:///C:/x.jpg", "https://127.0.0.1/x", "https://www.gstatic.com/other/x.png", "https://music.youtube.com/watch?v=x"] {
            assert!(!allowed(bad), "{bad}");
        }
    }

    #[test]
    fn sniffs_types() {
        assert_eq!(sniff(b"GIF89a"), "image/gif");
        assert_eq!(sniff(b"\x89PNG\r\n"), "image/png");
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8"), "image/webp");
        assert_eq!(sniff(b"\xff\xd8\xff"), "image/jpeg");
    }

    #[tokio::test]
    async fn caches_on_disk_and_prunes_oldest() {
        let mut s = Server::new_async().await;
        for n in 1..=3 {
            s.mock("GET", format!("/{n}.png").as_str()).with_header("content-type", "image/png").with_body(vec![0x89, b'P', b'N', b'G', n, 0, 0, 0, 0, 0]).expect(1).create_async().await;
        }
        s.mock("GET", "/page").with_header("content-type", "text/html").with_body("<html>").create_async().await;
        let dir = tempfile::tempdir().unwrap();
        let cache = ArtCache::new(dir.path().to_path_buf(), 25);
        let url = |n: &str| format!("{}/{n}", s.url());
        let (bytes, ty) = cache.fetch(&url("1.png")).await.unwrap();
        assert_eq!((bytes.len(), ty), (10, "image/png"));
        assert_eq!(cache.fetch(&url("1.png")).await.unwrap().0, bytes, "second read from disk (mock expects 1 call)");
        assert!(cache.fetch(&url("page")).await.is_err());
        assert!(cache.get(&url("1.png")).await.is_err(), "mock host not on allowlist");
        cache.fetch(&url("2.png")).await.unwrap();
        // Touch 1 so 2 is the least recently used.
        std::thread::sleep(std::time::Duration::from_millis(20));
        cache.fetch(&url("1.png")).await.unwrap();
        cache.fetch(&url("3.png")).await.unwrap();
        let left: Vec<bool> = ["1.png", "2.png", "3.png"].iter().map(|n| dir.path().join(key(&url(n))).exists()).collect();
        assert_eq!(left, [true, false, true]);
    }

    #[tokio::test]
    async fn same_image_at_once_is_one_read_then_memory() {
        let mut s = Server::new_async().await;
        let m = s.mock("GET", "/a.png").with_header("content-type", "image/png").with_body(vec![0x89, b'P', b'N', b'G', 1]).expect(1).create_async().await;
        let dir = tempfile::tempdir().unwrap();
        let cache = ArtCache::new(dir.path().to_path_buf(), 1 << 20);
        let url = format!("{}/a.png", s.url());
        let all = futures_join(&cache, &url).await;
        assert!(all.iter().all(|i| i.as_ref().is_some_and(|i| i.0.len() == 5)));
        // On disk, then gone from disk: memory still answers.
        std::fs::remove_file(dir.path().join(key(&url))).unwrap();
        assert!(cache.shared(&url).await.is_some());
        assert!(cache.stats().hits >= 1);
        m.assert_async().await;
    }

    async fn futures_join(cache: &ArtCache, url: &str) -> Vec<Option<Arc<Image>>> {
        let (a, b, c) = tokio::join!(cache.shared(url), cache.shared(url), cache.shared(url));
        vec![a, b, c]
    }
}
