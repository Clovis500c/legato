//! Cover cache rules, pure: thumbnail sizes and look, file names, eviction by last use.
//! The files and the fetching live in `music-connectors` `art.rs`; this folder holds only what can be downloaded again
//! (the app's `covers/` folder, with the user's pictures and theme backgrounds, is another one and never goes through here).

use image::{DynamicImage, ImageFormat, codecs::jpeg::JpegEncoder, imageops::FilterType};
use std::io::Cursor;
use std::path::Path;
use std::time::{Duration, SystemTime};

/// Thumbnail sizes (short edge, px). Nothing else is served: no free-form resize on a URL.
pub const SIZES: [u32; 3] = [64, 256, 600];

/// Longest edge as a multiple of the size: a very wide picture does not make a huge "thumbnail".
const LONG_EDGE: f64 = 4.0;

/// A file is touched at most once a day: Windows often skips access times, and a write per hit would wear the disk.
const TOUCH_EVERY: Duration = Duration::from_secs(24 * 3600);

/// `s=64` in an `art` URL's query, only if it is one of `SIZES`.
pub fn size_of_query(query: Option<&str>) -> Option<u32> {
    let s: u32 = query?.split('&').find_map(|p| p.strip_prefix("s="))?.parse().ok()?;
    SIZES.contains(&s).then_some(s)
}

/// Where the thumbnail sits: next to its original (`<key>` → `<key>.64`).
pub fn file_name(key: &str, size: Option<u32>) -> String {
    size.map_or_else(|| key.to_string(), |s| format!("{key}.{s}"))
}

/// A name written by the cache: 16 hex digits, a size, a half-written `.tmp`. Anything else in the folder is not ours to delete.
pub fn is_cache_file(name: &str) -> bool {
    let name = name.strip_suffix(".tmp").unwrap_or(name);
    let (key, size) = name.split_once('.').map_or((name, None), |(k, s)| (k, Some(s)));
    key.len() == 16 && key.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) && size.is_none_or(|s| s.parse().is_ok_and(|n| SIZES.contains(&n)))
}

/// Size of the thumbnail: short edge = `size`, ratio kept. None = nothing to shrink (already that small): serve the original.
fn target(w: u32, h: u32, size: u32) -> Option<(u32, u32)> {
    let short = w.min(h);
    if short <= size {
        return None;
    }
    let f = f64::from(size) / f64::from(short);
    let (mut nw, mut nh) = (f64::from(w) * f, f64::from(h) * f);
    let long = nw.max(nh);
    if long > f64::from(size) * LONG_EDGE {
        let k = f64::from(size) * LONG_EDGE / long;
        (nw, nh) = (nw * k, nh * k);
    }
    Some((nw.round().max(1.0) as u32, nh.round().max(1.0) as u32))
}

/// Smaller copy of a picture (PNG stays PNG for transparency, the rest JPEG at 88) + its type.
/// None = serve the original: already small, a type we can't read (GIF, WebP), or a failed decode.
pub fn thumbnail(bytes: &[u8], size: u32) -> Option<(Vec<u8>, &'static str)> {
    let (w, h) = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format().ok()?.into_dimensions().ok()?;
    let (nw, nh) = target(w, h, size)?;
    let png = image::guess_format(bytes).ok()? == ImageFormat::Png;
    let small = image::load_from_memory(bytes).ok()?.resize_exact(nw, nh, FilterType::Triangle);
    let mut out = Vec::new();
    if png {
        small.write_to(&mut Cursor::new(&mut out), ImageFormat::Png).ok()?;
        Some((out, "image/png"))
    } else {
        JpegEncoder::new_with_quality(&mut out, 88).encode_image(&DynamicImage::ImageRgb8(small.to_rgb8())).ok()?;
        Some((out, "image/jpeg"))
    }
}

/// True when a file last used `modified` is due its once-a-day touch.
pub fn touch_due(modified: SystemTime, now: SystemTime) -> bool {
    now.duration_since(modified).is_ok_and(|d| d >= TOUCH_EVERY)
}

/// Marks a file as used now, if due. No write otherwise.
pub fn touch(path: &Path) {
    let due = std::fs::metadata(path).and_then(|m| m.modified()).is_ok_and(|m| touch_due(m, SystemTime::now()));
    if due {
        let _ = std::fs::File::options().write(true).open(path).and_then(|f| f.set_modified(SystemTime::now()));
    }
}

/// One file of the cache folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub len: u64,
    pub modified: SystemTime,
}

/// Over `cap`: the least recently used cache files out, oldest first, until 80 % of `cap` is left (so the next writes
/// don't prune again at once). Files that aren't the cache's are neither counted nor listed. Returns names to delete.
pub fn to_evict(files: &[Entry], cap: u64) -> Vec<String> {
    let mut ours: Vec<&Entry> = files.iter().filter(|f| is_cache_file(&f.name)).collect();
    let mut used: u64 = ours.iter().map(|f| f.len).sum();
    if used <= cap {
        return Vec::new();
    }
    ours.sort_by(|a, b| (a.modified, &a.name).cmp(&(b.modified, &b.name)));
    let goal = cap / 5 * 4;
    let mut out = Vec::new();
    for f in ours {
        if used <= goal {
            break;
        }
        used -= f.len;
        out.push(f.name.clone());
    }
    out
}

/// Files of the folder, no sub-folders.
pub fn list(dir: &Path) -> Vec<Entry> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    rd.flatten()
        .filter_map(|e| {
            let m = e.metadata().ok().filter(|m| m.is_file())?;
            Some(Entry { name: e.file_name().into_string().ok()?, len: m.len(), modified: m.modified().ok()? })
        })
        .collect()
}

/// Bytes the cache holds in `dir`.
pub fn used(dir: &Path) -> u64 {
    list(dir).iter().filter(|f| is_cache_file(&f.name)).map(|f| f.len).sum()
}

/// Evicts down to the goal if over `cap`. Returns the bytes left. Blocking: run it on a background thread.
pub fn prune(dir: &Path, cap: u64) -> u64 {
    let files = list(dir);
    let mut left: u64 = files.iter().filter(|f| is_cache_file(&f.name)).map(|f| f.len).sum();
    for name in to_evict(&files, cap) {
        if std::fs::remove_file(dir.join(&name)).is_ok() {
            left -= files.iter().find(|f| f.name == name).map_or(0, |f| f.len);
        }
    }
    left
}

/// Everything the cache holds out (Settings › Clear covers). Returns the bytes freed.
pub fn clear(dir: &Path) -> u64 {
    let before = used(dir);
    before - prune(dir, 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jpeg(w: u32, h: u32) -> Vec<u8> {
        let mut out = Vec::new();
        JpegEncoder::new_with_quality(&mut out, 80).encode_image(&DynamicImage::ImageRgb8(image::RgbImage::new(w, h))).unwrap();
        out
    }

    fn dims(bytes: &[u8]) -> (u32, u32) {
        image::ImageReader::new(Cursor::new(bytes)).with_guessed_format().unwrap().into_dimensions().unwrap()
    }

    fn at(secs: u64) -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(secs)
    }

    fn file(name: &str, len: u64, secs: u64) -> Entry {
        Entry { name: name.into(), len, modified: at(secs) }
    }

    #[test]
    fn only_the_three_sizes() {
        assert_eq!(size_of_query(Some("s=64")), Some(64));
        assert_eq!(size_of_query(Some("x=1&s=600")), Some(600));
        assert_eq!(size_of_query(Some("s=100")), None);
        assert_eq!(size_of_query(Some("s=0")), None);
        assert_eq!(size_of_query(Some("s=-1")), None);
        assert_eq!(size_of_query(Some("size=64")), None);
        assert_eq!(size_of_query(None), None);
    }

    #[test]
    fn names_the_cache_owns() {
        let key = "00ff00ff00ff00ff";
        assert!(is_cache_file(key));
        assert!(is_cache_file(&file_name(key, Some(256))));
        assert!(is_cache_file(&format!("{}.tmp", file_name(key, Some(64)))));
        assert!(!is_cache_file(&file_name(key, Some(99))));
        // Theme pictures and the user's covers: another folder, but even by mistake they are not matched.
        for other in ["bg-00ff00ff00ff00ff.png", "pl-12-1792176517.png", "notes.txt", "00FF00ff00ff00ff", "00ff", ""] {
            assert!(!is_cache_file(other), "{other}");
        }
    }

    #[test]
    fn short_edge_is_the_size_and_ratio_is_kept() {
        assert_eq!(target(640, 480, 64), Some((85, 64)));
        assert_eq!(target(1920, 1080, 256), Some((455, 256)));
        assert_eq!(target(500, 1000, 256), Some((256, 512)));
        // Already small: nothing to shrink, also at the edge.
        assert_eq!(target(64, 64, 64), None);
        assert_eq!(target(60, 300, 64), None);
        // Very wide: the long edge stops at 4 sizes.
        assert_eq!(target(4000, 100, 64), Some((256, 6)));
    }

    #[test]
    fn thumbnails_are_small_copies() {
        let big = jpeg(640, 480);
        for (s, want) in [(64, (85, 64)), (256, (341, 256))] {
            let (out, kind) = thumbnail(&big, s).unwrap();
            assert_eq!((kind, dims(&out)), ("image/jpeg", want));
            assert!(out.len() < big.len());
        }
        // 600 on a 640x480 picture: 800x600 would be bigger than the original, so the original is served.
        assert!(thumbnail(&big, 600).is_none());
        assert!(thumbnail(&jpeg(40, 40), 64).is_none());
        assert!(thumbnail(b"not a picture", 64).is_none());
        let mut png = Vec::new();
        DynamicImage::ImageRgba8(image::RgbaImage::new(300, 300)).write_to(&mut Cursor::new(&mut png), ImageFormat::Png).unwrap();
        let (out, kind) = thumbnail(&png, 64).unwrap();
        assert_eq!((kind, dims(&out)), ("image/png", (64, 64)));
    }

    #[test]
    fn touch_once_a_day() {
        let day = 24 * 3600;
        assert!(!touch_due(at(1000), at(1000 + day - 1)));
        assert!(touch_due(at(1000), at(1000 + day)));
        // Clock set back: no touch.
        assert!(!touch_due(at(5000), at(1000)));
    }

    #[test]
    fn evicts_oldest_down_to_eighty_percent() {
        let files = [file("0000000000000001", 30, 10), file("0000000000000002", 30, 30), file("0000000000000003", 30, 20), file("0000000000000003.64", 5, 40)];
        // 95 bytes, cap 100: fine.
        assert!(to_evict(&files, 100).is_empty());
        // Cap 90: goal 72, oldest (#1, 30) out leaves 65.
        assert_eq!(to_evict(&files, 90), ["0000000000000001"]);
        // Cap 60: goal 48, #1 and #3 out leaves 35.
        assert_eq!(to_evict(&files, 60), ["0000000000000001", "0000000000000003"]);
        // Cap 0 empties it.
        assert_eq!(to_evict(&files, 0).len(), 4);
    }

    #[test]
    fn leaves_foreign_files_alone() {
        let files = [file("bg-00ff00ff00ff00ff.png", 1000, 1), file("pl-1-2.jpg", 1000, 1), file("0000000000000001", 50, 5)];
        assert!(to_evict(&files, 100).is_empty(), "only 50 bytes are the cache's");
        assert_eq!(to_evict(&files, 0), ["0000000000000001"]);
    }

    #[test]
    fn prune_and_clear_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let put = |name: &str, len: usize, secs: u64| {
            let p = dir.path().join(name);
            std::fs::write(&p, vec![0u8; len]).unwrap();
            std::fs::File::options().write(true).open(&p).unwrap().set_modified(at(secs)).unwrap();
        };
        put("0000000000000001", 40, 100);
        put("0000000000000002", 40, 300);
        put("0000000000000002.256", 10, 200);
        put("bg-0000000000000001.png", 500, 1);
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        assert_eq!(used(dir.path()), 90);
        // Cap 80: goal 64: #1 out (oldest), 50 left.
        assert_eq!(prune(dir.path(), 80), 50);
        assert!(!dir.path().join("0000000000000001").exists() && dir.path().join("0000000000000002").exists());
        assert_eq!(prune(dir.path(), 80), 50, "under the cap: nothing");
        assert_eq!(clear(dir.path()), 50);
        assert_eq!(used(dir.path()), 0);
        assert!(dir.path().join("bg-0000000000000001.png").exists() && dir.path().join("sub").is_dir());
    }

    #[test]
    fn touch_writes_only_when_due() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("0000000000000001");
        std::fs::write(&p, b"x").unwrap();
        let fresh = std::fs::metadata(&p).unwrap().modified().unwrap();
        touch(&p);
        assert_eq!(std::fs::metadata(&p).unwrap().modified().unwrap(), fresh, "used today: untouched");
        std::fs::File::options().write(true).open(&p).unwrap().set_modified(at(1_000)).unwrap();
        touch(&p);
        assert!(std::fs::metadata(&p).unwrap().modified().unwrap() > at(1_000_000));
    }
}
