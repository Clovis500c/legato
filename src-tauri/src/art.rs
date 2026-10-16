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

async fn image(app: &tauri::AppHandle, path: &str) -> Option<(Vec<u8>, String)> {
    let path = percent_encoding::percent_decode_str(path.trim_start_matches('/')).decode_utf8().ok()?.into_owned();
    match path.strip_prefix("local/") {
        Some(id) => local(app, id.parse().ok()?).await,
        None => remote(app, &path).await,
    }
}

/// Cover embedded in a library track's local file.
pub async fn local(app: &tauri::AppHandle, track_id: i64) -> Option<(Vec<u8>, String)> {
    let file = app.try_state::<AppState>()?.lib.lock().unwrap().local_path(track_id).ok()??;
    tauri::async_runtime::spawn_blocking(move || music_core::local::picture(std::path::Path::new(&file))).await.ok()?
}

/// Remote image through the cache (allowlisted hosts only).
pub async fn remote(app: &tauri::AppHandle, url: &str) -> Option<(Vec<u8>, String)> {
    let (bytes, kind) = app.try_state::<AppState>()?.art.get(url).await.ok()?;
    Some((bytes, kind.to_string()))
}
