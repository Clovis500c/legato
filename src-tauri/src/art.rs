//! `art` URI scheme (http://art.localhost/… on Windows): images for the UI, served by Rust.
//! `/<encoded https URL>` = remote image through the cache (allowlisted hosts); `/local/<track id>` = cover embedded in a local file.

use crate::AppState;
use std::borrow::Cow;
use tauri::Manager;
use tauri::http::{Request, Response, StatusCode, header};

pub async fn respond(app: tauri::AppHandle, req: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let path = req.uri().path().trim_start_matches('/');
    if let Some(name) = path.strip_prefix("cover/").filter(|n| valid_cover_name(n) && (n.ends_with(".mp4") || n.ends_with(".webm"))) {
        let range = req.headers().get(header::RANGE).and_then(|v| v.to_str().ok());
        if let Some(res) = video(&app, name, range) {
            return res;
        }
    }
    match image(&app, req.uri().path()).await {
        Some((bytes, kind)) => Response::builder()
            .header(header::CONTENT_TYPE, kind)
            // Canvas reads pixels (ambient color): needs CORS.
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::CACHE_CONTROL, "max-age=86400")
            .body(Cow::Owned(bytes)),
        None => Response::builder().status(StatusCode::NOT_FOUND).header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*").body(Cow::Borrowed(&[][..])),
    }
    .expect("static response parts")
}

/// Largest piece of a video sent at once.
const VIDEO_PIECE: u64 = 2 << 20;

/// A theme's background video, in the byte ranges the player asks for (a whole 40 MB file per request would stall it).
fn video(app: &tauri::AppHandle, name: &str, range: Option<&str>) -> Option<Response<Cow<'static, [u8]>>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(covers_dir(app)?.join(name)).ok()?;
    let len = file.metadata().ok()?.len();
    let (start, end) = byte_range(range, len)?;
    let end = end.min(start + VIDEO_PIECE - 1);
    let mut buf = vec![0; (end - start + 1) as usize];
    file.seek(SeekFrom::Start(start)).ok()?;
    file.read_exact(&mut buf).ok()?;
    Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_TYPE, if name.ends_with(".webm") { "video/webm" } else { "video/mp4" })
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
        .body(Cow::Owned(buf))
        .ok()
}

/// `Range: bytes=a-b` (or `a-`, `-n`, none) → first and last byte, inclusive. Out of the file: None.
fn byte_range(range: Option<&str>, len: u64) -> Option<(u64, u64)> {
    let last = len.checked_sub(1)?;
    let Some(spec) = range.and_then(|r| r.strip_prefix("bytes=")) else { return Some((0, last)) };
    let (a, b) = spec.split(',').next()?.trim().split_once('-')?;
    let (start, end) = match (a.parse::<u64>().ok(), b.parse::<u64>().ok()) {
        (Some(s), e) => (s, e.unwrap_or(last).min(last)),
        (None, Some(n)) => (len.saturating_sub(n), last),
        (None, None) => return None,
    };
    (start <= end).then_some((start, end))
}

/// Image for an art scheme path (percent-encoded, leading slash allowed).
pub async fn image(app: &tauri::AppHandle, path: &str) -> Option<(Vec<u8>, String)> {
    let path = percent_encoding::percent_decode_str(path.trim_start_matches('/')).decode_utf8().ok()?.into_owned();
    if let Some(name) = path.strip_prefix("cover/") {
        return cover(app, name);
    }
    match path.strip_prefix("local/") {
        // "<id>~<version>": same cover, asked again after an edit (art.ts coverRewritten).
        Some(id) => local(app, id.split('~').next()?.parse().ok()?).await,
        None => remote(app, &path).await,
    }
}

/// Folder of playlist images the user picked (copied in, the original can move).
pub fn covers_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    Some(app.path().app_data_dir().ok()?.join("covers"))
}

/// Name as written by `save_cover` only: no path tricks.
pub fn valid_cover_name(name: &str) -> bool {
    let (stem, ext) = name.rsplit_once('.').unwrap_or(("", ""));
    !stem.is_empty() && stem.len() <= 80 && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && ["png", "jpg", "webp", "gif", "mp4", "webm"].contains(&ext)
}

fn cover(app: &tauri::AppHandle, name: &str) -> Option<(Vec<u8>, String)> {
    if !valid_cover_name(name) {
        return None;
    }
    let bytes = std::fs::read(covers_dir(app)?.join(name)).ok()?;
    let kind = music_connectors::art::sniff(&bytes).to_string();
    Some((bytes, kind))
}

/// Cover embedded in a library track's local file.
pub async fn local(app: &tauri::AppHandle, track_id: i64) -> Option<(Vec<u8>, String)> {
    let file = app.try_state::<AppState>()?.lib().local_path(track_id).ok()??;
    tauri::async_runtime::spawn_blocking(move || music_core::local::picture(std::path::Path::new(&file))).await.ok()?
}

/// Remote image through the cache (allowlisted hosts only).
pub async fn remote(app: &tauri::AppHandle, url: &str) -> Option<(Vec<u8>, String)> {
    let (bytes, kind) = app.try_state::<AppState>()?.art.get(url).await.ok()?;
    Some((bytes, kind.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{byte_range, valid_cover_name};

    #[test]
    fn video_ranges() {
        assert_eq!(byte_range(None, 100), Some((0, 99)));
        assert_eq!(byte_range(Some("bytes=0-"), 100), Some((0, 99)));
        assert_eq!(byte_range(Some("bytes=10-19"), 100), Some((10, 19)));
        assert_eq!(byte_range(Some("bytes=90-500"), 100), Some((90, 99)));
        assert_eq!(byte_range(Some("bytes=-30"), 100), Some((70, 99)));
        assert_eq!(byte_range(Some("bytes=100-"), 100), None);
        assert_eq!(byte_range(Some("bytes=x"), 100), None);
        assert_eq!(byte_range(None, 0), None);
    }

    #[test]
    fn cover_names_are_plain_files() {
        assert!(valid_cover_name("pl-12-1792176517.png"));
        assert!(!valid_cover_name("../library.db"));
        assert!(!valid_cover_name("a/b.png"));
        assert!(!valid_cover_name("x.exe"));
        assert!(!valid_cover_name(".png"));
    }
}
