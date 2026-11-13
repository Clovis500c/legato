//! Sources: each one's status, connect and disconnect, the sync of all of them, our own likes pushed back.

use super::*;

#[derive(Serialize, Clone, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SourceStatus {
    configured: bool,
    connected: bool,
}

#[tauri::command]
pub async fn sources_status(state: State<'_, AppState>) -> CmdResult<Vec<(Source, SourceStatus)>> {
    if let Some(known) = state.cache.status.get("") {
        return Ok((*known).clone());
    }
    let spotify = state.spotify();
    let youtube = ytm::session(&state.app).is_some();
    let status = vec![
        (Source::Spotify, SourceStatus { configured: spotify.is_some(), connected: spotify.is_some_and(|c| c.is_connected()) }),
        (Source::Youtube, SourceStatus { configured: youtube, connected: youtube }),
    ];
    Ok((*state.cache.status.put("", status)).clone())
}

#[tauri::command]
pub async fn connect(state: State<'_, AppState>, source: Source, credentials: Credentials) -> CmdResult<()> {
    let merged = state.credentials().merged_with(credentials);
    state.store.save("credentials", &merged).map_err(err)?;
    state.cache.status.clear();
    let c = state.connector(source).ok_or("Missing credentials")?;
    c.connect().await.map_err(err)
}

#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>, source: Source) -> CmdResult<()> {
    state.cache.status.clear();
    state.connector(source).map_or(Ok(()), |c| c.disconnect()).map_err(err)
}

#[tauri::command]
pub async fn sync_all(state: State<'_, AppState>) -> CmdResult<SyncReport> {
    let mut report = sync_once(&state).await;
    // Stale Google session: refreshed, then the whole sync once more.
    if report.errors.iter().any(|e| e.contains(music_connectors::ytmusic::SIGNED_OUT)) && ytm::refresh(&state.app).await {
        report = sync_once(&state).await;
    }
    // Your music servers, when not read for a while.
    let (lists, errors) = servers::sync_due(&state).await;
    report.playlists += lists;
    report.errors.extend(errors);
    if let Err(e) = push_own_likes(&state).await {
        report.errors.push(format!("Liked Music: {e:#}"));
    }
    log_sync_errors(&report);
    Ok(report)
}

/// A sync's failures in the diagnostics log: the part that failed in the message, the text (it names playlists and
/// songs) as the detail. Five at most, the rest counted.
pub fn log_sync_errors(report: &SyncReport) {
    for e in report.errors.iter().take(5) {
        diag::warn("sync", &format!("{} failed", music_core::diag::failing_part(e)), e);
    }
    if report.errors.len() > 5 {
        diag::warn("sync", &format!("{} more errors", report.errors.len() - 5), "");
    }
}

pub async fn sync_once(state: &AppState) -> SyncReport {
    // Accounts set to send only (or off) bring nothing in; Spotify off = no linking either.
    let spotify = state.spotify().filter(|_| state.direction("spotify").pulls());
    let youtube: Vec<_> = state.ytm_all().into_iter().filter(|y| state.direction(&ytm_key(y)).pulls()).collect();
    let mut all: Vec<&dyn Connector> = Vec::new();
    all.extend(spotify.as_ref().map(|c| c as &dyn Connector));
    all.extend(youtube.iter().map(|c| c as &dyn Connector));
    sync(&state.lib, &all, spotify.as_ref().map(|c| c as &dyn Connector)).await
}

/// Likes made here while YouTube Music was out of reach wait in your own "Liked Music" (like.ts): liked on the account,
/// then moved into its Liked Music. Nothing dropped on either side (user's choice 2026-10-28).
pub async fn push_own_likes(state: &AppState) -> anyhow::Result<()> {
    // Account set not to take changes: likes stay in your own list.
    if !state.direction("youtube:0").pushes() {
        return Ok(());
    }
    let (own, liked, todo) = {
        let lib = state.lib();
        let playlists = lib.playlists()?;
        let own = playlists.iter().find(|p| p.custom && p.name == "Liked Music");
        let liked = playlists.iter().find(|p| p.source == Source::Youtube && !p.custom && p.source_id == "LM");
        let (Some(own), Some(liked)) = (own, liked) else { return Ok(()) };
        let there: HashSet<i64> = lib.playlist_tracks(liked.id)?.into_iter().map(|t| t.id).collect();
        // Already liked there: only out of your list. No YouTube version: stays.
        let todo: Vec<(i64, Option<String>)> = lib.playlist_tracks(own.id)?.into_iter().filter_map(|t| Some((t.id, t.track.ids.get(&Source::Youtube)?.clone()))).map(|(id, v)| (id, (!there.contains(&id)).then_some(v))).collect();
        (own.id, liked.id, todo)
    };
    let videos: Vec<String> = todo.iter().filter_map(|(_, v)| v.clone()).collect();
    if !videos.is_empty() {
        let videos = &videos;
        with_ytm(state, |accounts| async move { accounts.into_iter().find(|y| y.account_key() == "0").context("Sign in to YouTube Music first (Settings › Accounts)")?.like(videos).await }).await?;
    }
    let lib = state.lib();
    lib.append_to_imported(liked, &todo.iter().filter(|(_, v)| v.is_some()).map(|(id, _)| *id).collect::<Vec<_>>())?;
    for (id, _) in &todo {
        lib.edit_playlist(PlaylistEdit::RemoveTrack { id: own, track_id: *id })?;
    }
    Ok(())
}
