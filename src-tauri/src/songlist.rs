//! Add › Import a list of songs: pasted text or a file (.txt / .csv from SoundCloud, Deezer, a friend…; a playlist file:
//! M3U / M3U8 / XSPF), each song found on YouTube (YouTube Music songs first), the ones found in a new playlist of yours.
//! A playlist file's library files and YouTube links come as they are (`music_core::playfile`). No service's API involved.
//! Out: a playlist of yours as such a file (`export_playlist_file`).

use crate::{AppState, CmdResult, err, video_search, yt_search};
use music_connectors::youtube;
use music_core::library::PlaylistEdit;
use music_core::model::{Source, Track};
use music_core::musicness::Musicness;
use music_core::playfile::{self, Plan};
use music_core::songlist::{self, Wanted};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
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

enum Got {
    Own(i64),
    Track(Track),
    /// What to show for it.
    Missing(String),
}

async fn resolve(state: &AppState, plan: Plan) -> Got {
    match plan {
        Plan::Own(id) => Got::Own(id),
        Plan::Video(t) => Got::Track(t),
        Plan::Link(url) => youtube::track_from_link(&url, youtube::OEMBED).await.map_or(Got::Missing(url), Got::Track),
        Plan::Search(w) => match find(state, &w).await {
            Some(t) => Got::Track(t),
            None if w.artist.is_empty() => Got::Missing(w.title),
            None => Got::Missing(format!("{} – {}", w.artist, w.title)),
        },
    }
}

/// The library's own files, by `playfile::path_key`.
fn own_files(state: &AppState) -> CmdResult<HashMap<String, i64>> {
    let tracks = state.lib().tracks().map_err(err)?;
    Ok(tracks.into_iter().filter_map(|t| t.track.ids.get(&Source::Local).map(|p| (playfile::path_key(Path::new(p)), t.id))).collect())
}

#[tauri::command]
pub async fn import_song_list(app: tauri::AppHandle, state: State<'_, AppState>, name: String, text: Option<String>, path: Option<String>) -> CmdResult<ListImport> {
    // Trust boundary: free text or a file the user picked, bounded.
    let (text, file) = match (text, path) {
        (Some(t), _) => (t, None),
        (None, Some(p)) => {
            if std::fs::metadata(&p).map_err(err)?.len() > MAX_TEXT {
                return Err("File too big for a list of songs (1 MB max)".into());
            }
            (String::from_utf8_lossy(&std::fs::read(&p).map_err(err)?).into_owned(), Some(PathBuf::from(p)))
        }
        (None, None) => return Err("Nothing to import".into()),
    };
    if text.len() as u64 > MAX_TEXT {
        return Err("Text too long for a list of songs (1 MB max)".into());
    }
    // A playlist file (M3U, XSPF, a CSV with links): its places first. Else one song per line.
    let plans: Vec<Plan> = match playfile::read(&text).or_else(|| playfile::csv_with_links(&text)) {
        Some(entries) => {
            let base = file.as_deref().and_then(Path::parent);
            let files = entries.iter().any(|e| e.location.as_deref().is_some_and(|l| playfile::file_path(l, base).is_some()));
            let own = if files { own_files(&state)? } else { HashMap::new() };
            entries.iter().filter_map(|e| playfile::plan(e, base, &own, youtube::video_id)).collect()
        }
        None => songlist::parse(&text).into_iter().map(Plan::Search).collect(),
    };
    if plans.is_empty() {
        return Err("No songs in that text: one per line, like “Artist - Title”".into());
    }
    // Name: typed, else the file's own (#PLAYLIST, <title>), else its file name.
    let stem = file.as_deref().and_then(Path::file_stem).map(|s| s.to_string_lossy().into_owned());
    let name = Some(name.trim().to_string()).filter(|n| !n.is_empty()).or_else(|| playfile::title(&text)).or(stem).map_or_else(|| "Imported songs".to_string(), |n| n.chars().take(100).collect());
    let (mut found, mut missing) = (Vec::new(), Vec::new());
    // 6 searches at a time: quick, still polite.
    for chunk in plans.chunks(6) {
        let jobs: Vec<_> = chunk
            .iter()
            .cloned()
            .map(|p| {
                let app = app.clone();
                tauri::async_runtime::spawn(async move { resolve(&app.state::<AppState>(), p).await })
            })
            .collect();
        for job in jobs {
            match job.await.map_err(err)? {
                Got::Missing(label) => missing.push(label),
                got => found.push(got),
            }
        }
    }
    let songs = plans.len();
    let report = |playlist_id, found| ListImport { playlist_id, name: name.clone(), songs, found, missing: missing.iter().take(20).cloned().collect() };
    if found.is_empty() {
        return Ok(report(None, 0));
    }
    let lib = state.lib();
    let id = lib.edit_playlist(PlaylistEdit::Create { name: name.clone() }).map_err(err)?.ok_or("Playlist not created")?;
    let mut ids = Vec::with_capacity(found.len());
    for got in &found {
        match got {
            Got::Own(id) => ids.push(*id),
            Got::Track(t) => {
                // Asked for by hand: a song removed earlier comes back.
                lib.unremove(t).map_err(err)?;
                ids.push(lib.upsert_track(t).map_err(err)?);
            }
            Got::Missing(_) => {}
        }
    }
    lib.edit_playlist(PlaylistEdit::Add { id, track_ids: ids }).map_err(err)?;
    Ok(report(Some(id), found.len()))
}

/// Where a song lives, for a file: its path, else its page (YouTube, Spotify, Apple Music).
fn location(t: &Track) -> Option<String> {
    let page = |s, url: &str| t.ids.get(&s).map(|id| format!("{url}{id}"));
    t.ids.get(&Source::Local).cloned().or_else(|| page(Source::Youtube, "https://www.youtube.com/watch?v=")).or_else(|| page(Source::Spotify, "https://open.spotify.com/track/")).or_else(|| page(Source::Apple, "https://music.apple.com/song/"))
}

/// A playlist as a file the user picked: M3U / M3U8, XSPF or CSV by its extension.
#[tauri::command]
pub async fn export_playlist_file(state: State<'_, AppState>, playlist_id: i64, path: String) -> CmdResult<()> {
    let format = playfile::Format::of(Path::new(&path)).ok_or("Pick an M3U, XSPF or CSV file")?;
    let (name, tracks) = {
        let lib = state.lib();
        let name = lib.playlists().map_err(err)?.into_iter().find(|p| p.id == playlist_id).map(|p| p.name).ok_or("Playlist not found")?;
        (name, lib.playlist_tracks(playlist_id).map_err(err)?)
    };
    let rows: Vec<playfile::Row> = tracks
        .into_iter()
        .map(|t| playfile::Row { location: location(&t.track), secs: t.track.duration_ms.map(|ms| (ms + 500) / 1000), title: t.track.title, artist: t.track.artist, album: t.track.album })
        .collect();
    std::fs::write(&path, playfile::write(format, &name, &rows)).map_err(err)
}
