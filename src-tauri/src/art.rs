//! `art` URI scheme (http://art.localhost/… on Windows): images for the UI, served by Rust.
//! `/<encoded https URL>` = remote image through the cache (allowlisted hosts); `/local/<track id>` = cover embedded in a local file.

use crate::AppState;
use std::borrow::Cow;
use tauri::Manager;
use tauri::http::{Request, Response, StatusCode, header};

pub async fn respond(app: tauri::AppHandle, req: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
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

/// Image for an art scheme path (percent-encoded, leading slash allowed).
pub async fn image(app: &tauri::AppHandle, path: &str) -> Option<(Vec<u8>, String)> {
    let path = percent_encoding::percent_decode_str(path.trim_start_matches('/')).decode_utf8().ok()?.into_owned();
    if let Some(name) = path.strip_prefix("cover/") {
        return cover(app, name);
    }
    match path.strip_prefix("local/") {
        Some(id) => local(app, id.parse().ok()?).await,
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
    !stem.is_empty() && stem.len() <= 80 && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && ["png", "jpg", "webp", "gif"].contains(&ext)
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
    use super::valid_cover_name;

    #[test]
    fn cover_names_are_plain_files() {
        assert!(valid_cover_name("pl-12-1792176517.png"));
        assert!(!valid_cover_name("../library.db"));
        assert!(!valid_cover_name("a/b.png"));
        assert!(!valid_cover_name("x.exe"));
        assert!(!valid_cover_name(".png"));
    }
}
