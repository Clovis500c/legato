//! Library edits: a song's flags, rating and preferences, history cleared, removals and merges, exports to YouTube.

use super::*;

/// "It's music" (true) / "Not music" (false) from the user, None = back to the app's guess.
#[tauri::command]
pub async fn set_music(state: State<'_, AppState>, track_ids: Vec<i64>, music: Option<bool>) -> CmdResult<()> {
    // Trust boundary: a selection, not the whole world.
    if track_ids.len() > 10_000 {
        return Err("Too many tracks".into());
    }
    state.lib().set_music(&track_ids, music).map_err(err)
}

/// "Not explicit" (true) on songs a source marked explicit, or back (false): the filter then shows them.
#[tauri::command]
pub async fn set_explicit(state: State<'_, AppState>, track_ids: Vec<i64>, ok: bool) -> CmdResult<()> {
    if track_ids.len() > 10_000 {
        return Err("Too many tracks".into());
    }
    state.lib().set_explicit_ok(&track_ids, ok).map_err(err)
}

/// None clears it.
#[tauri::command]
pub async fn set_track_pref(state: State<'_, AppState>, track_id: i64, pref: Option<Pref>) -> CmdResult<()> {
    state.lib().set_pref(track_id, pref).map_err(err)
}

/// Your rating of a song in half stars (1..=10); 0 takes it off.
#[tauri::command]
pub async fn set_rating(state: State<'_, AppState>, track_id: i64, stars: u8) -> CmdResult<()> {
    state.lib().set_rating(track_id, stars).map_err(err)
}

#[tauri::command]
pub async fn clear_history(state: State<'_, AppState>) -> CmdResult<()> {
    state.lib().clear_history().map_err(err)
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExportReport {
    url: String,
    added: usize,
    /// Already in the YouTube playlist (earlier export).
    already: usize,
    /// Tracks with no YouTube version (Find full versions can fix that).
    no_youtube: usize,
}

/// Playlist → private YouTube playlist. Same playlist exported again = same YouTube playlist, only missing videos added.
#[tauri::command]
pub async fn export_youtube(state: State<'_, AppState>, id: i64) -> CmdResult<ExportReport> {
    let yt = state.ytm().ok_or("Sign in to YouTube Music first (Settings › Accounts)")?;
    let key = format!("ytm_export_{id}");
    let (name, videos, no_youtube, existing) = {
        let lib = state.lib();
        let p = lib.playlists().map_err(err)?.into_iter().find(|p| p.id == id).ok_or("Playlist not found")?;
        if p.source == Source::Youtube && !p.custom {
            return Err("Already a YouTube playlist".into());
        }
        let tracks = lib.playlist_tracks(id).map_err(err)?;
        let mut seen = HashSet::new();
        let videos: Vec<String> = tracks.iter().filter_map(|t| t.track.ids.get(&Source::Youtube).cloned()).filter(|v| seen.insert(v.clone())).collect();
        let no_youtube = tracks.iter().filter(|t| !t.track.ids.contains_key(&Source::Youtube)).count();
        (p.name, videos, no_youtube, lib.setting(&key).ok().flatten().and_then(|v| v.as_str().map(String::from)))
    };
    let url = |remote: &str| format!("https://music.youtube.com/playlist?list={remote}");
    // Exported before: add what's missing. Playlist deleted on YouTube (or any error): make a new one.
    if let Some(remote) = existing
        && let Ok(have) = yt.playlist_videos(&remote).await
    {
        let have: HashSet<String> = have.into_iter().collect();
        let todo: Vec<String> = videos.iter().filter(|v| !have.contains(*v)).cloned().collect();
        if yt.add_videos(&remote, &todo).await.is_ok() {
            return Ok(ExportReport { url: url(&remote), added: todo.len(), already: videos.len() - todo.len(), no_youtube });
        }
    }
    let remote = yt.create_playlist(&name, &videos).await.map_err(err)?;
    state.lib().set_setting(&key, &serde_json::json!(remote)).map_err(err)?;
    Ok(ExportReport { url: url(&remote), added: videos.len(), already: 0, no_youtube })
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct AddReport {
    pub(crate) added: usize,
    /// Already in the playlist (YouTube refuses duplicates).
    pub(crate) already: usize,
    /// No YouTube version: can't go into a YouTube playlist. A server's playlist: not a song of that server.
    pub(crate) no_youtube: usize,
}

/// Liked Music's account key ("0" = signed-in default), None for another playlist.
pub fn liked_key(source_id: &str) -> Option<String> {
    source_id.strip_prefix("LM").map(|k| k.strip_prefix('~').unwrap_or("0").to_string())
}

/// YouTube's own words when it gave them, else a hint (a bare status: likely not the user's playlist).
pub fn refusal(why: Option<String>, hint: &str) -> String {
    let why = why.unwrap_or_else(|| "YouTube Music refused".into());
    if why.starts_with("YouTube Music: ") { why } else { format!("{why}. {hint}") }
}

/// Right-click › Remove from a playlist, every occurrence. Custom: here. YouTube Music: here at once, then on the
/// account in the background (push.rs: the owner account accepts, others refuse; Liked Music = take the like back),
/// put back if it refuses. Spotify imports are read-only.
#[tauri::command]
pub async fn remove_from_playlist(state: State<'_, AppState>, id: i64, track_id: i64) -> CmdResult<()> {
    let (playlist, videos) = {
        let lib = state.lib();
        let p = lib.playlists().map_err(err)?.into_iter().find(|p| p.id == id).ok_or("Playlist not found")?;
        if p.custom {
            lib.edit_playlist(PlaylistEdit::RemoveTrack { id, track_id }).map_err(err)?;
            return Ok(());
        }
        (p, lib.source_ids(track_id, Source::Youtube).map_err(err)?)
    };
    if playlist.source != Source::Youtube {
        return Err("Imported Spotify playlists are read-only here: change them in Spotify.".into());
    }
    // Signed out, sending off: said at once, nothing changed.
    let accounts = state.ytm_senders()?;
    let like = liked_key(&playlist.source_id);
    if let Some(key) = &like
        && !state.direction(&format!("youtube:{key}")).pushes()
    {
        return Err(NOT_SENT.into());
    }
    state.lib().remove_from_imported(id, track_id).map_err(err)?;
    let app = state.app.clone();
    push::later(async move {
        let st = app.state::<AppState>();
        let sent = match &like {
            Some(key) => with_ytm(&st, |accounts| {
                let videos = &videos;
                async move { accounts.into_iter().find(|y| y.account_key() == *key).context("That Google account isn't synced any more")?.unlike(videos).await }
            })
            .await
            .map_err(err),
            None => {
                // Playlist id carries no account: try each, the owner takes it.
                let remote = playlist.source_id.split('~').next().unwrap_or(&playlist.source_id).to_string();
                let mut last = None;
                let mut done = false;
                for yt in accounts {
                    match yt.remove_videos(&remote, &videos).await {
                        Ok(_) => {
                            done = true;
                            break;
                        }
                        Err(e) => last = Some(err(e)),
                    }
                }
                if done { Ok(()) } else { Err(refusal(last, "Only playlists you own on YouTube Music can be changed.")) }
            }
        };
        if let Err(reason) = sent {
            let _ = st.lib().append_to_imported(id, &[track_id]);
            push::failed(&app, push::Failed { kind: if like.is_some() { push::Kind::Unlike } else { push::Kind::Remove }, playlist: playlist.name, songs: 1, reason });
        }
    });
    Ok(())
}

/// Right-click › Remove from library: out of every playlist here and kept out of syncs and folder scans (the services'
/// own playlists and the files on disk stay as they are).
#[tauri::command]
pub async fn remove_from_library(state: State<'_, AppState>, track_id: i64) -> CmdResult<()> {
    state.lib().remove_track(track_id).map_err(err)
}

/// Duplicates finder: `others` folded into `keep` (sources, playlist spots, plays).
#[tauri::command]
pub async fn merge_duplicates(state: State<'_, AppState>, keep: i64, others: Vec<i64>) -> CmdResult<()> {
    state.lib().merge_tracks(keep, &others).map_err(err)
}

/// Add to an imported YouTube Music playlist: here at once, then on YouTube in the background (push.rs: owner account
/// accepts, others refuse). Liked Music = like the songs with that account. Refused: taken back out here; a like of
/// the main account stays in your own Liked Music instead (liked at the next sync).
#[tauri::command]
pub async fn add_to_youtube(state: State<'_, AppState>, id: i64, track_ids: Vec<i64>) -> CmdResult<AddReport> {
    let (playlist, videos, there) = {
        let lib = state.lib();
        let p = lib.playlists().map_err(err)?.into_iter().find(|p| p.id == id).ok_or("Playlist not found")?;
        if p.source != Source::Youtube || p.custom {
            return Err("Not a YouTube Music playlist".into());
        }
        let tracks = lib.tracks().map_err(err)?;
        let videos: Vec<(i64, String)> = track_ids.iter().filter_map(|t| tracks.iter().find(|x| x.id == *t).and_then(|x| x.track.ids.get(&Source::Youtube).map(|v| (*t, v.clone())))).collect();
        let there: HashSet<String> = lib.playlist_tracks(id).map_err(err)?.into_iter().filter_map(|t| t.track.ids.get(&Source::Youtube).cloned()).collect();
        (p, videos, there)
    };
    let no_youtube = track_ids.len() - videos.len();
    // Already in the mirror: YouTube would refuse them anyway.
    let mut seen = HashSet::new();
    let (videos, dup): (Vec<_>, Vec<_>) = videos.into_iter().filter(|(_, v)| seen.insert(v.clone())).partition(|(_, v)| !there.contains(v));
    let mut report = AddReport { added: 0, already: dup.len(), no_youtube };
    if videos.is_empty() {
        return Ok(report);
    }
    // Signed out, sending off: said at once, nothing changed.
    let accounts = state.ytm_senders()?;
    let like = liked_key(&playlist.source_id);
    if let Some(key) = &like
        && !state.direction(&format!("youtube:{key}")).pushes()
    {
        return Err(NOT_SENT.into());
    }
    let added: Vec<i64> = videos.iter().map(|(t, _)| *t).collect();
    state.lib().append_to_imported(id, &added).map_err(err)?;
    report.added = added.len();
    let app = state.app.clone();
    push::later(async move {
        let st = app.state::<AppState>();
        let ids: Vec<String> = videos.iter().map(|(_, v)| v.clone()).collect();
        // Taken by YouTube (added, or there already), and why the others weren't.
        let (taken, reason): (HashSet<String>, Option<String>) = match &like {
            Some(key) => {
                let liked = with_ytm(&st, |accounts| {
                    let ids = &ids;
                    async move { accounts.into_iter().find(|y| y.account_key() == *key).context("That Google account isn't synced any more")?.like(ids).await }
                })
                .await;
                match liked {
                    Ok(()) => (ids.iter().cloned().collect(), None),
                    Err(e) => (HashSet::new(), Some(err(e))),
                }
            }
            None => {
                // Playlist id carries no account: try each, the owner takes it.
                let remote = playlist.source_id.split('~').next().unwrap_or(&playlist.source_id).to_string();
                let mut last = None;
                let mut done = None;
                for yt in accounts {
                    match yt.add_videos(&remote, &ids).await {
                        Ok(r) => {
                            done = Some(r);
                            break;
                        }
                        Err(e) => last = Some(err(e)),
                    }
                }
                match done {
                    Some(r) => (r.added.into_iter().chain(r.already).collect(), r.refused),
                    None => (HashSet::new(), Some(refusal(last, "Only playlists you own on YouTube Music can take new songs."))),
                }
            }
        };
        let lost: Vec<i64> = videos.iter().filter(|(_, v)| !taken.contains(v)).map(|(t, _)| *t).collect();
        if lost.is_empty() {
            return;
        }
        let kept = {
            let lib = st.lib();
            for t in &lost {
                let _ = lib.remove_from_imported(id, *t);
            }
            // The main account's like: into your own Liked Music, liked there at the next sync (push_own_likes).
            like.as_deref() == Some("0") && lib.keep_in_own_likes(&lost).is_ok()
        };
        let kind = match (&like, kept) {
            (Some(_), true) => push::Kind::Like,
            (Some(_), false) => push::Kind::LikeLost,
            (None, _) => push::Kind::Add,
        };
        push::failed(&app, push::Failed { kind, playlist: playlist.name, songs: lost.len(), reason: reason.unwrap_or_else(|| "YouTube Music refused".into()) });
    });
    Ok(report)
}
