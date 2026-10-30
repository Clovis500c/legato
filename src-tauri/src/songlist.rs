//! Add › Import a list of songs: pasted text or a .txt / .csv file (from SoundCloud, Deezer, a friend…), each song
//! found on YouTube (YouTube Music songs first), the ones found in a new playlist of yours. No service's API involved.

use crate::{AppState, CmdResult, err, video_search, yt_search};
use music_core::library::PlaylistEdit;
use music_core::model::Track;
use music_core::musicness::Musicness;
use music_core::songlist::{self, Wanted};
use serde::Serialize;
use tauri::{Manager, State};

/// Text read, at most (2,000 songs fit well under).
const MAX_TEXT: u64 = 1 << 20;

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ListImport {
    /// None: nothing was found, no playlist made.
    playlist_id: Option<i64>,
    name: String,
    songs: usize,
    found: usize,
    /// The first songs not found ("Artist – Title"), to show.
    missing: Vec<String>,
}

/// The song on YouTube Music, else among YouTube videos (music only).
async fn find(state: &AppState, w: &Wanted) -> Option<Track> {
    let query = format!("{} {}", w.artist, w.title).trim().to_string();
    if let Ok(songs) = yt_search(state, &query).await
        && let Some(hit) = songlist::pick(w, &songs)
    {
        return Some(hit.clone());
    }
    let videos: Vec<Track> = video_search(state, &query).await.ok()?.into_iter().filter(|(_, m)| *m != Musicness::NotMusic).map(|(t, _)| t).collect();
    songlist::pick(w, &videos).cloned()
}

#[tauri::command]
pub async fn import_song_list(app: tauri::AppHandle, state: State<'_, AppState>, name: String, text: Option<String>, path: Option<String>) -> CmdResult<ListImport> {
    // Trust boundary: free text or a file the user picked, bounded.
    let text = match (text, path) {
        (Some(t), _) => t,
        (None, Some(p)) => {
            if std::fs::metadata(&p).map_err(err)?.len() > MAX_TEXT {
                return Err("File too big for a list of songs (1 MB max)".into());
            }
            String::from_utf8_lossy(&std::fs::read(&p).map_err(err)?).into_owned()
        }
        (None, None) => return Err("Nothing to import".into()),
    };
    if text.len() as u64 > MAX_TEXT {
        return Err("Text too long for a list of songs (1 MB max)".into());
    }
    let wanted = songlist::parse(&text);
    if wanted.is_empty() {
        return Err("No songs in that text: one per line, like “Artist - Title”".into());
    }
    let name = Some(name.trim()).filter(|n| !n.is_empty()).map_or_else(|| "Imported songs".to_string(), |n| n.chars().take(100).collect());
    let (mut found, mut missing) = (Vec::new(), Vec::new());
    // 6 searches at a time: quick, still polite.
    for chunk in wanted.chunks(6) {
        let jobs: Vec<_> = chunk
            .iter()
            .cloned()
            .map(|w| {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let hit = find(&app.state::<AppState>(), &w).await;
                    (w, hit)
                })
            })
            .collect();
        for job in jobs {
            match job.await.map_err(err)? {
                (_, Some(t)) => found.push(t),
                (w, None) => missing.push(if w.artist.is_empty() { w.title } else { format!("{} – {}", w.artist, w.title) }),
            }
        }
    }
    let songs = wanted.len();
    let report = |playlist_id, found| ListImport { playlist_id, name: name.clone(), songs, found, missing: missing.iter().take(20).cloned().collect() };
    if found.is_empty() {
        return Ok(report(None, 0));
    }
    let lib = state.lib();
    let id = lib.edit_playlist(PlaylistEdit::Create { name: name.clone() }).map_err(err)?.ok_or("Playlist not created")?;
    let mut ids = Vec::with_capacity(found.len());
    for t in &found {
        // Asked for by hand: a song removed earlier comes back.
        lib.unremove(t).map_err(err)?;
        ids.push(lib.upsert_track(t).map_err(err)?);
    }
    lib.edit_playlist(PlaylistEdit::Add { id, track_ids: ids }).map_err(err)?;
    Ok(report(Some(id), found.len()))
}
