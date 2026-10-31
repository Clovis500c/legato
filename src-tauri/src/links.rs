//! Pasted Deezer and Apple Music playlist / album links: the connectors read a name, a cover and the songs (metadata
//! only), then each song gets its YouTube version like a Spotify import, and the ones found go in a new playlist.

use crate::{AppState, CmdResult, err, hosts, with_youtube};
use music_connectors::{deezer, itunes, linklist::LinkList};
use music_core::library::PlaylistEdit;
use music_core::model::Source;
use serde::Serialize;
use tauri::{Manager, State};

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LinkImport {
    /// None: no song was found on YouTube, no playlist made.
    playlist_id: Option<i64>,
    name: String,
    /// Songs read from the link.
    songs: usize,
    /// Of those, the ones found on YouTube (they play in full).
    found: usize,
    /// Songs the service says the list has: more than `songs` when its page showed only the first ones.
    total: usize,
    /// The first songs not found ("Artist – Title"), to show.
    missing: Vec<String>,
}

/// Is it a Deezer link? Else an Apple Music one. Pasted text only picks the service; the hosts are ours.
async fn read(url: &str) -> anyhow::Result<LinkList> {
    let h = hosts::get();
    // By host, not by a good path: a Deezer link with a typo says "Not a Deezer link", not an Apple Music error.
    if deezer::is_deezer(url) {
        deezer::Deezer::with_urls(h.deezer, h.deezer_link).fetch(url).await
    } else {
        itunes::link_list(h.apple_page, h.itunes_lookup, url).await
    }
}

/// Deezer or Apple Music playlist / album link → a playlist of yours, no account. Same flow as a Spotify link.
#[tauri::command]
pub async fn import_link(app: tauri::AppHandle, state: State<'_, AppState>, url: String) -> CmdResult<LinkImport> {
    // Trust boundary: clipboard / typed text.
    if url.len() > 2048 {
        return Err("Link too long".into());
    }
    let list = read(url.trim()).await.map_err(err)?;
    let (mut found, mut missing) = (Vec::new(), Vec::new());
    // 6 searches at a time: quick, still polite.
    for chunk in list.tracks.chunks(6) {
        let jobs: Vec<_> = chunk
            .iter()
            .cloned()
            .map(|t| {
                let app = app.clone();
                tauri::async_runtime::spawn(async move { with_youtube(&app.state::<AppState>(), t).await })
            })
            .collect();
        for job in jobs {
            let t = job.await.map_err(err)?;
            if t.ids.contains_key(&Source::Youtube) {
                found.push(t);
            } else {
                missing.push(format!("{} – {}", t.artist, t.title));
            }
        }
    }
    let name: String = list.name.trim().chars().take(100).collect();
    let report = |playlist_id, found| LinkImport { playlist_id, name: name.clone(), songs: list.tracks.len(), found, total: list.total, missing: missing.iter().take(20).cloned().collect() };
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
