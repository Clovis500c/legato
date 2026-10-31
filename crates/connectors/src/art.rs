//! Cover art and profile pictures: fetched by Rust from the services' image hosts only, kept on disk under a size cap.
//! The UI never hits the network: it loads images through the app's `art` URI scheme (src-tauri/src/art.rs).

use anyhow::{Context, Result, ensure};
use music_core::cache::{Lru, Stats};
use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::{OnceCell, Semaphore};
use url::Url;

/// One image at most (animated avatars included).
const MAX_IMAGE: usize = 5 << 20;

/// Image hosts of YouTube, Google accounts, Apple, Spotify and Deezer (exact names), and YouTube Music's own art paths (Liked Music's cover on
/// gstatic, My Mix covers drawn by music.youtube.com): both load without a session.
pub fn allowed(url: &str) -> bool {
    Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https"
            && u.host_str().is_some_and(|h| {
                ["i.ytimg.com", "yt3.ggpht.com", "i.scdn.co", "cdn-images.dzcdn.net", "e-cdns-images.dzcdn.net"].contains(&h)
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

/// Thumbnails cut at once: decoding is CPU work, the window must stay quick while a long list scrolls in.
const RESIZERS: usize = 2;

type Image = (Vec<u8>, &'static str);
/// One pending read or download, shared by every caller of the same URL.
type Pending = Arc<OnceCell<Option<Arc<Image>>>>;

/// FNV-1a: stable file name per URL.
fn key(url: &str) -> String {
    format!("{:016x}", url.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| (h ^ u64::from(b)).wrapping_mul(0x100_0000_01b3)))
}

/// Disk cache of remote images under a size cap (rules in `music_core::artcache`: this folder holds only what can be
/// downloaded again), plus 64 / 256 / 600 px thumbnails cut once from the cached original.
pub struct ArtCache {
    dir: PathBuf,
    cap: Arc<AtomicU64>,
    /// Bytes on disk as last counted, plus what was written since: no scan per write.
    used: Arc<AtomicU64>,
    pruning: Arc<AtomicBool>,
    http: reqwest::Client,
    hot: Lru<Image>,
    /// Same image asked by many rows at once (an album's songs): one read or download, shared.
    inflight: Mutex<HashMap<String, Pending>>,
    resizers: Semaphore,
}

impl ArtCache {
    pub fn new(dir: PathBuf, cap: u64) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        // Redirects stay on image hosts too.
        let http = reqwest::Client::builder().redirect(reqwest::redirect::Policy::custom(|a| if allowed(a.url().as_str()) { a.follow() } else { a.stop() })).build().unwrap_or_default();
        Self { dir, cap: Arc::new(cap.into()), used: Arc::default(), pruning: Arc::default(), http, hot: Lru::new(HOT_BUDGET), inflight: Mutex::default(), resizers: Semaphore::new(RESIZERS) }
    }

    /// Image bytes + type: from memory, from disk, else downloaded (allowed hosts only) and kept.
    /// `size` (one of `artcache::SIZES`) = a thumbnail of it, cut on first ask and kept; the original if it can't be cut.
    pub async fn get(&self, url: &str, size: Option<u32>) -> Result<(Vec<u8>, &'static str)> {
        ensure!(allowed(url), "Image host not allowed");
        let image = self.shared(url, size).await.context("Image not available")?;
        Ok((image.0.clone(), image.1))
    }

    /// Memory first; else one fetch per URL (and size), whoever asks meanwhile waits for the same one.
    async fn shared(&self, url: &str, size: Option<u32>) -> Option<Arc<Image>> {
        let id = size.map_or_else(|| url.to_string(), |s| format!("{url}#{s}"));
        if let Some(hit) = self.hot.get(&id) {
            return Some(hit);
        }
        let cell = self.inflight.lock().unwrap().entry(id.clone()).or_default().clone();
        let image = cell
            .get_or_init(|| async {
                match size {
                    Some(s) => self.thumb(url, s).await,
                    None => self.fetch(url).await.ok(),
                }
                .map(Arc::new)
            })
            .await
            .clone();
        self.inflight.lock().unwrap().remove(&id);
        if let Some(i) = &image {
            self.hot.put(&id, i.clone(), i.0.len());
        }
        image
    }

    pub fn stats(&self) -> Stats {
        self.hot.stats()
    }

    /// Thumbnail of a picture that is not in the cache folder (a local file's embedded cover): in memory only, the file
    /// can change under it. `id` names the picture (and its version); `load` reads it, only when the thumbnail is missing.
    pub async fn local(&self, id: &str, size: u32, load: impl Future<Output = Option<Vec<u8>>>) -> Option<(Vec<u8>, &'static str)> {
        let id = format!("local/{id}#{size}");
        if let Some(hit) = self.hot.get(&id) {
            return Some((hit.0.clone(), hit.1));
        }
        let bytes = load.await?;
        let image = self.resized(&bytes, size).await.unwrap_or_else(|| (bytes.clone(), sniff(&bytes)));
        self.hot.put(&id, Arc::new(image.clone()), image.0.len());
        Some(image)
    }

    /// Bytes the folder holds now (counted on disk).
    pub fn size(&self) -> u64 {
        music_core::artcache::used(&self.dir)
    }

    /// Settings › cover cache: new cap in bytes. Pruned at once, in the background, if the folder is over it.
    pub fn set_cap(&self, bytes: u64) {
        self.cap.store(bytes, Ordering::Relaxed);
        self.prune_later();
    }

    /// Empties the folder (everything here downloads again). Bytes freed.
    pub fn clear(&self) -> u64 {
        let freed = music_core::artcache::clear(&self.dir);
        self.used.store(0, Ordering::Relaxed);
        freed
    }

    /// Counts the folder and prunes it if over the cap, on a thread of its own (never on a request): at launch and after writes.
    pub fn prune_later(&self) {
        if self.pruning.swap(true, Ordering::SeqCst) {
            return;
        }
        let (dir, cap, used, pruning) = (self.dir.clone(), self.cap.clone(), self.used.clone(), self.pruning.clone());
        let started = std::thread::Builder::new().name("art-prune".into()).spawn(move || {
            used.store(music_core::artcache::prune(&dir, cap.load(Ordering::Relaxed)), Ordering::Relaxed);
            pruning.store(false, Ordering::SeqCst);
        });
        if started.is_err() {
            self.pruning.store(false, Ordering::SeqCst);
        }
    }

    /// A write of `len` bytes landed: prune when the count passes the cap (it stops at 80 %, so not at every write after).
    fn wrote(&self, len: usize) {
        if self.used.fetch_add(len as u64, Ordering::Relaxed) + len as u64 > self.cap.load(Ordering::Relaxed) {
            self.prune_later();
        }
    }

    /// Whole file at once (a reader never sees half of it). Own temp name per write: two fetches of one picture meet here.
    fn write(&self, name: &str, bytes: &[u8]) -> Result<()> {
        static WRITES: AtomicU64 = AtomicU64::new(0);
        let tmp = self.dir.join(format!("{name}~{}.tmp", WRITES.fetch_add(1, Ordering::Relaxed)));
        std::fs::write(&tmp, bytes).context("Image cache")?;
        std::fs::rename(&tmp, self.dir.join(name)).context("Image cache")?;
        self.wrote(bytes.len());
        Ok(())
    }

    /// Smaller copy on a worker thread, two at a time. None = the original does the job.
    async fn resized(&self, bytes: &[u8], size: u32) -> Option<(Vec<u8>, &'static str)> {
        let _turn = self.resizers.acquire().await.ok()?;
        let bytes = bytes.to_vec();
        tokio::task::spawn_blocking(move || music_core::artcache::thumbnail(&bytes, size)).await.ok()?
    }

    /// Thumbnail from disk, else cut from the cached original and kept. The original when it can't be cut.
    async fn thumb(&self, url: &str, size: u32) -> Option<(Vec<u8>, &'static str)> {
        let name = music_core::artcache::file_name(&key(url), Some(size));
        let path = self.dir.join(&name);
        if let Ok(bytes) = std::fs::read(&path) {
            music_core::artcache::touch(&path);
            return Some((bytes.clone(), sniff(&bytes)));
        }
        let (original, kind) = self.fetch(url).await.ok()?;
        match self.resized(&original, size).await {
            Some(small) => {
                // A failed write still serves it; the next ask cuts it again.
                let _ = self.write(&name, &small.0);
                Some(small)
            }
            None => Some((original, kind)),
        }
    }

    async fn fetch(&self, url: &str) -> Result<(Vec<u8>, &'static str)> {
        let path = self.dir.join(key(url));
        if let Ok(bytes) = std::fs::read(&path) {
            // Used: out of the way of pruning (once a day at most).
            music_core::artcache::touch(&path);
            return Ok((bytes.clone(), sniff(&bytes)));
        }
        let res = self.http.get(url).send().await?.error_for_status()?;
        let image = res.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|t| t.starts_with("image/"));
        ensure!(image, "Not an image");
        ensure!(res.content_length().is_none_or(|n| n <= MAX_IMAGE as u64), "Image too large");
        let bytes = res.bytes().await?;
        ensure!(bytes.len() <= MAX_IMAGE, "Image too large");
        // A failed write still serves it; the next ask downloads again.
        let _ = self.write(&key(url), &bytes);
        Ok((bytes.to_vec(), sniff(&bytes)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;
    use std::time::SystemTime;

    #[test]
    fn allows_service_image_hosts_only() {
        for ok in ["https://i.ytimg.com/vi/x/hqdefault.jpg", "https://lh3.googleusercontent.com/a=w544-h544", "https://yt3.ggpht.com/p=s88", "https://is1-ssl.mzstatic.com/image/a/600x600bb.jpg", "https://i.scdn.co/image/ab", "https://cdn-images.dzcdn.net/images/cover/a91071665368a95007d4c40288e2074e/500x500-000000-80-0-0.jpg", "https://e-cdns-images.dzcdn.net/images/cover/x/250x250.jpg", "https://www.gstatic.com/youtube/media/ytm/images/pbg/liked-songs-delhi-576.png", "https://music.youtube.com/image/mixart?r=EN"] {
            assert!(allowed(ok), "{ok}");
        }
        for bad in ["http://i.ytimg.com/x", "https://evil.example/x.jpg", "https://googleusercontent.com.evil.example/x", "https://dzcdn.net/x.jpg", "https://evil.dzcdn.net/x.jpg", "https://api.deezer.com/album/1/image", "file:///C:/x.jpg", "https://127.0.0.1/x", "https://www.gstatic.com/other/x.png", "https://music.youtube.com/watch?v=x"] {
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
    fn png(n: u8) -> Vec<u8> {
        vec![0x89, b'P', b'N', b'G', n, 0, 0, 0, 0, 0]
    }

    fn jpeg(w: u32, h: u32) -> Vec<u8> {
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 90).encode_image(&image::DynamicImage::ImageRgb8(image::RgbImage::from_fn(w, h, |x, y| { let n = (x.wrapping_mul(2_654_435_761) ^ y.wrapping_mul(40_503)).wrapping_mul(2_246_822_519); image::Rgb([(n >> 8) as u8, (n >> 16) as u8, (n >> 24) as u8]) }))).unwrap();
        out
    }

    fn dims(bytes: &[u8]) -> (u32, u32) {
        image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().unwrap().into_dimensions().unwrap()
    }

    fn age(path: &std::path::Path, days: u64) {
        let f = std::fs::File::options().write(true).open(path).unwrap();
        f.set_modified(SystemTime::now() - std::time::Duration::from_secs(days * 86_400)).unwrap();
    }

    /// The background prune is done.
    fn settle(cache: &ArtCache) {
        while cache.pruning.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }

    #[tokio::test]
    async fn caches_on_disk_and_prunes_oldest() {
        let mut s = Server::new_async().await;
        for n in 1..=3 {
            s.mock("GET", format!("/{n}.png").as_str()).with_header("content-type", "image/png").with_body(png(n)).expect(1).create_async().await;
        }
        s.mock("GET", "/page").with_header("content-type", "text/html").with_body("<html>").create_async().await;
        let dir = tempfile::tempdir().unwrap();
        let cache = ArtCache::new(dir.path().to_path_buf(), 25);
        let url = |n: &str| format!("{}/{n}", s.url());
        let on_disk = |n: &str| dir.path().join(key(&url(n)));
        let (bytes, ty) = cache.fetch(&url("1.png")).await.unwrap();
        assert_eq!((bytes.len(), ty), (10, "image/png"));
        assert_eq!(cache.fetch(&url("1.png")).await.unwrap().0, bytes, "second read from disk (mock expects 1 call)");
        assert!(cache.fetch(&url("page")).await.is_err());
        assert!(cache.get(&url("1.png"), None).await.is_err(), "mock host not on allowlist");
        cache.fetch(&url("2.png")).await.unwrap();
        // 2 is the oldest, 1 was used again (a day or more later: that is when the file is touched).
        age(&on_disk("2.png"), 3);
        age(&on_disk("1.png"), 2);
        cache.fetch(&url("1.png")).await.unwrap();
        cache.fetch(&url("3.png")).await.unwrap();
        settle(&cache);
        assert_eq!([on_disk("1.png").exists(), on_disk("2.png").exists(), on_disk("3.png").exists()], [true, false, true]);
        assert_eq!(cache.size(), 20);
    }

    #[tokio::test]
    async fn a_read_today_writes_nothing_to_the_file() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/1.png").with_header("content-type", "image/png").with_body(png(1)).expect(1).create_async().await;
        let dir = tempfile::tempdir().unwrap();
        let cache = ArtCache::new(dir.path().to_path_buf(), 1 << 20);
        let url = format!("{}/1.png", s.url());
        cache.fetch(&url).await.unwrap();
        let path = dir.path().join(key(&url));
        age(&path, 0);
        let before = std::fs::metadata(&path).unwrap().modified().unwrap();
        cache.fetch(&url).await.unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(), before);
    }

    #[tokio::test]
    async fn thumbnails_are_cut_once_and_kept() {
        let mut s = Server::new_async().await;
        let big = jpeg(640, 480);
        let m = s.mock("GET", "/a.jpg").with_header("content-type", "image/jpeg").with_body(&big).expect(1).create_async().await;
        let dir = tempfile::tempdir().unwrap();
        let cache = ArtCache::new(dir.path().to_path_buf(), 1 << 20);
        let url = format!("{}/a.jpg", s.url());
        let small = cache.shared(&url, Some(64)).await.unwrap();
        assert_eq!((small.1, dims(&small.0)), ("image/jpeg", (85, 64)));
        let file = dir.path().join(format!("{}.64", key(&url)));
        assert_eq!(std::fs::read(&file).unwrap(), small.0, "kept next to the original");
        // Another size is another file; the original stays what it was.
        assert_eq!(dims(&cache.shared(&url, Some(256)).await.unwrap().0), (341, 256));
        assert_eq!(dims(&cache.shared(&url, None).await.unwrap().0), (640, 480));
        // A new run (memory empty) reads the thumbnail from disk: no download, no cutting.
        std::fs::remove_file(dir.path().join(key(&url))).unwrap();
        let again = ArtCache::new(dir.path().to_path_buf(), 1 << 20);
        assert_eq!(again.shared(&url, Some(64)).await.unwrap().0, small.0);
        m.assert_async().await;
    }

    #[tokio::test]
    async fn a_picture_that_cannot_be_cut_is_served_whole() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/broken.png").with_header("content-type", "image/png").with_body(png(1)).create_async().await;
        s.mock("GET", "/tiny.jpg").with_header("content-type", "image/jpeg").with_body(jpeg(40, 40)).create_async().await;
        let dir = tempfile::tempdir().unwrap();
        let cache = ArtCache::new(dir.path().to_path_buf(), 1 << 20);
        let url = |n: &str| format!("{}/{n}", s.url());
        assert_eq!(cache.shared(&url("broken.png"), Some(64)).await.unwrap().0, png(1));
        assert_eq!(dims(&cache.shared(&url("tiny.jpg"), Some(64)).await.unwrap().0), (40, 40));
        assert!(!dir.path().join(format!("{}.64", key(&url("tiny.jpg")))).exists(), "no copy of a picture that is small already");
        assert!(cache.shared(&url("missing.jpg"), Some(64)).await.is_none());
    }

    #[tokio::test]
    async fn one_picture_in_three_sizes_at_once_all_arrive() {
        let mut s = Server::new_async().await;
        s.mock("GET", "/a.jpg").with_header("content-type", "image/jpeg").with_body(jpeg(640, 480)).create_async().await;
        let dir = tempfile::tempdir().unwrap();
        let cache = ArtCache::new(dir.path().to_path_buf(), 1 << 20);
        let url = format!("{}/a.jpg", s.url());
        let (a, b, c) = tokio::join!(cache.shared(&url, None), cache.shared(&url, Some(64)), cache.shared(&url, Some(256)));
        assert!(a.is_some() && b.is_some() && c.is_some());
        assert!(std::fs::read_dir(dir.path()).unwrap().flatten().all(|f| !f.file_name().to_string_lossy().ends_with(".tmp")), "no temp file left");
    }

    #[tokio::test]
    async fn thumbnails_count_in_the_cap_and_go_with_the_rest() {
        let mut s = Server::new_async().await;
        let big = jpeg(640, 480);
        s.mock("GET", "/a.jpg").with_header("content-type", "image/jpeg").with_body(&big).create_async().await;
        s.mock("GET", "/b.jpg").with_header("content-type", "image/jpeg").with_body(&big).create_async().await;
        let dir = tempfile::tempdir().unwrap();
        // Room for one original and its thumbnail, not two originals.
        let cache = ArtCache::new(dir.path().to_path_buf(), big.len() as u64 * 3 / 2);
        let url = |n: &str| format!("{}/{n}", s.url());
        cache.shared(&url("a.jpg"), Some(64)).await.unwrap();
        settle(&cache);
        for f in std::fs::read_dir(dir.path()).unwrap().flatten() {
            age(&f.path(), 5);
        }
        cache.shared(&url("b.jpg"), Some(64)).await.unwrap();
        settle(&cache);
        assert!(cache.size() <= big.len() as u64 * 3 / 2, "{}", cache.size());
        assert!(!dir.path().join(key(&url("a.jpg"))).exists(), "the older picture went first");
        assert!(dir.path().join(format!("{}.64", key(&url("b.jpg")))).exists());
    }

    #[tokio::test]
    async fn a_smaller_cap_prunes_and_clear_empties() {
        let dir = tempfile::tempdir().unwrap();
        for (i, name) in ["00000000000000a1", "00000000000000a2", "00000000000000a3"].iter().enumerate() {
            let p = dir.path().join(name);
            std::fs::write(&p, vec![0u8; 100]).unwrap();
            age(&p, 3 - i as u64);
        }
        std::fs::write(dir.path().join("bg-00000000000000a1.png"), vec![0u8; 100]).unwrap();
        let cache = ArtCache::new(dir.path().to_path_buf(), 1 << 20);
        assert_eq!(cache.size(), 300);
        cache.set_cap(250);
        settle(&cache);
        assert_eq!(cache.size(), 200, "oldest out, down to 80 % of the cap");
        assert!(!dir.path().join("00000000000000a1").exists());
        assert_eq!(cache.clear(), 200);
        assert!(dir.path().join("bg-00000000000000a1.png").exists(), "not the cache's file");
    }

    #[tokio::test]
    async fn local_thumbnails_are_read_once_and_stay_in_memory() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ArtCache::new(dir.path().to_path_buf(), 1 << 20);
        let loads = std::sync::atomic::AtomicUsize::new(0);
        let load = || async {
            loads.fetch_add(1, Ordering::SeqCst);
            Some(jpeg(512, 512))
        };
        for _ in 0..2 {
            let small = cache.local("7", 64, load()).await.unwrap();
            assert_eq!(dims(&small.0), (64, 64));
        }
        // `load()` builds a future but only the first one is awaited.
        assert_eq!(loads.load(Ordering::SeqCst), 1);
        assert!(cache.local("8", 64, async { None }).await.is_none());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0, "nothing written to the folder");
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
        assert!(cache.shared(&url, None).await.is_some());
        assert!(cache.stats().hits >= 1);
        m.assert_async().await;
    }

    async fn futures_join(cache: &ArtCache, url: &str) -> Vec<Option<Arc<Image>>> {
        let (a, b, c) = tokio::join!(cache.shared(url, None), cache.shared(url, None), cache.shared(url, None));
        vec![a, b, c]
    }
}
