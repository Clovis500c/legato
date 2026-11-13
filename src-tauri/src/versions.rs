//! A song's versions: the YouTube video for it, picked or found again, covers backfilled, a refused embed's alternatives, Apple's preview.

use super::*;

/// No YouTube id yet: try to find one (1 search) so the track plays in full.
pub async fn with_youtube(state: &AppState, track: Track) -> Track {
    youtube_version(state, &track).await.map_or(track, |answer| answer.song)
}

/// What a search said: the song, with its YouTube version when it has one, and everything it brought back.
pub struct Answer {
    pub song: Track,
    pub seen: Vec<Track>,
    /// A doubtful match (Against Liner 9): the video picked, then up to 3 other YouTube results. Empty: sure, or none.
    pub doubt: Vec<Track>,
}

/// `hit`, and what else could be the song, when the match is doubtful (`matching::doubtful`).
pub fn doubts(track: &Track, hit: &Track, found: &[Track]) -> Vec<Track> {
    if !music_core::matching::doubtful(track, hit) {
        return Vec::new();
    }
    let others = found.iter().filter(|t| !std::ptr::eq(*t, hit) && t.ids.contains_key(&Source::Youtube)).take(3);
    std::iter::once(hit).chain(others).cloned().collect()
}

/// None: YouTube refused the search, nothing learned.
pub async fn youtube_version(state: &AppState, track: &Track) -> Option<Answer> {
    if track.ids.contains_key(&Source::Youtube) {
        return Some(Answer { song: track.clone(), seen: Vec::new(), doubt: Vec::new() });
    }
    let mut seen = Vec::new();
    let query = format!("{} {}", track.artist, track.title);
    // YouTube Music songs first (clean metadata), then normal YouTube.
    match yt_search(state, &query).await {
        Ok(found) => {
            if let Some(hit) = music_core::matching::best_match(track, &found) {
                let doubt = doubts(track, hit, &found);
                return Some(Answer { song: merge_tracks(track, hit), seen: found, doubt });
            }
            seen = found;
        }
        Err(e) if music_connectors::refused(&e) => return None,
        Err(_) => {}
    }
    match video_search(state, &query).await {
        Ok(found) => {
            let videos: Vec<Track> = found.into_iter().filter(|(_, m)| *m != Musicness::NotMusic).map(|(t, _)| t).collect();
            let hit = music_core::matching::best_match(track, &videos);
            let (song, doubt) = (hit.map(|hit| merge_tracks(track, hit)), hit.map_or_else(Vec::new, |hit| doubts(track, hit, &videos)));
            seen.extend(videos);
            if let Some(song) = song {
                return Some(Answer { song, seen, doubt });
            }
        }
        Err(e) if music_connectors::refused(&e) => return None,
        Err(_) => {}
    }
    Some(Answer { song: track.clone(), seen, doubt: Vec::new() })
}

/// Trust boundary: a search hit from the UI. Catalog ids only (none yet: a song the Music Detector named without a
/// catalog link), bounded text, https art.
pub fn checked_hit(track: Track) -> Result<Track, String> {
    let ok_text = |s: &str| !s.trim().is_empty() && s.chars().count() <= 300;
    if !ok_text(&track.title) || !ok_text(&track.artist) || track.ids.len() > 8 || track.ids.iter().any(|(s, id)| *s == Source::Local || id.is_empty() || id.len() > 64) {
        return Err("Invalid title".into());
    }
    Ok(Track { art: track.art.filter(|a| a.len() <= 500 && a.starts_with("https://")), ..track })
}

/// Hit with its YouTube version looked up; still no source at all = nothing to play it from.
pub async fn playable_hit(state: &AppState, track: Track) -> CmdResult<Track> {
    let track = with_youtube(state, checked_hit(track)?).await;
    if track.ids.is_empty() {
        return Err(format!("“{}” wasn't found on YouTube or Apple Music: nothing to play it from", track.title));
    }
    Ok(track)
}

/// Search hit with its YouTube version when one exists, nothing written: plays in full without joining the library.
#[tauri::command]
pub async fn resolve_track(state: State<'_, AppState>, track: Track) -> CmdResult<Track> {
    playable_hit(&state, track).await
}

/// Add search hit, with its YouTube version when one exists.
#[tauri::command]
pub async fn add_track(state: State<'_, AppState>, track: Track) -> CmdResult<i64> {
    let track = playable_hit(&state, track).await?;
    // Added by hand: a song removed earlier comes back.
    let lib = state.lib();
    lib.unremove(&track).map_err(err)?;
    lib.upsert_track(&track).map_err(err)
}

/// Songs not found › a version picked by hand: it joins the song's own row, so its playlists play it. A hit with no
/// YouTube version is refused: it would still play nothing in full.
#[tauri::command]
pub async fn pick_version(state: State<'_, AppState>, track_id: i64, track: Track) -> CmdResult<()> {
    let track = playable_hit(&state, track).await?;
    if !track.ids.contains_key(&Source::Youtube) {
        return Err(format!("“{}” has no YouTube version: pick another one", track.title));
    }
    let lib = state.lib();
    lib.unremove(&track).map_err(err)?;
    lib.set_version(track_id, &track).map_err(err)
}

/// Apple tracks with no real cover: one batched lookup. Returns tracks given a cover.
#[tauri::command]
pub async fn backfill_art(state: State<'_, AppState>, country: String) -> CmdResult<usize> {
    use music_connectors::itunes;
    let ids: Vec<u64> = {
        let tracks = state.lib().tracks().map_err(err)?;
        tracks.into_iter().filter(|t| t.track.art.as_deref().is_none_or(music_core::model::video_frame)).filter_map(|t| t.track.ids.get(&Source::Apple)?.parse().ok()).collect()
    };
    if ids.is_empty() {
        return Ok(0);
    }
    let found: Vec<Track> = itunes::lookup(hosts::get().itunes_lookup, &ids, &store(&country)).await.map_err(err)?.into_iter().filter(|t| t.art.is_some()).collect();
    let lib = state.lib();
    for t in &found {
        lib.upsert_track(t).map_err(err)?;
    }
    Ok(found.len())
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FindReport {
    /// Tracks that got a YouTube version.
    found: usize,
    /// Tracks still without full playback (no match).
    missing: usize,
}

/// Searches per "Find versions" run: polite to YouTube Music.
pub const FIND_MAX: usize = 150;

/// "Find versions": YouTube match for tracks with no full source (Apple / Spotify only). 1 search each, cached.
#[tauri::command]
pub async fn find_versions(state: State<'_, AppState>, ids: Vec<i64>) -> CmdResult<FindReport> {
    let todo: Vec<Track> = {
        let lib = state.lib();
        let tracks = lib.tracks().map_err(err)?;
        tracks.into_iter().filter(|t| ids.contains(&t.id) && !t.track.ids.contains_key(&Source::Youtube) && !t.track.ids.contains_key(&Source::Local)).map(|t| t.track).take(FIND_MAX).collect()
    };
    let mut found = 0;
    for t in &todo {
        let candidates = yt_search(&state, &format!("{} {}", t.artist, t.title)).await?;
        if let Some(hit) = music_core::matching::best_match(t, &candidates) {
            state.lib().upsert_track(&merge_tracks(t, hit)).map_err(err)?;
            found += 1;
        }
    }
    Ok(FindReport { found, missing: todo.len() - found })
}

/// Of these videos (the one starting and the next ones), those whose owner turned embedding off: they go to their
/// watch page at once instead of failing in the embed first. Checked once a day each, all at the same time.
#[tauri::command]
pub async fn embed_refused(state: State<'_, AppState>, videos: Vec<String>) -> CmdResult<Vec<String>> {
    // Trust boundary: video ids only, a few.
    let videos: Vec<String> = videos.into_iter().filter(|v| v.len() == 11 && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')).take(5).collect();
    let jobs: Vec<_> = videos
        .into_iter()
        .map(|v| match state.cache.embeds.get(&v) {
            Some(ok) => (v, None, *ok),
            None => {
                let id = v.clone();
                (v, Some(tauri::async_runtime::spawn(async move { music_connectors::youtube::embeddable(&id, music_connectors::youtube::OEMBED).await })), true)
            }
        })
        .collect();
    let mut refused = Vec::new();
    for (v, job, known) in jobs {
        let ok = match job {
            None => known,
            Some(job) => match job.await {
                Ok(Ok(ok)) => *state.cache.embeds.put(&v, ok),
                // Unknown: the embed decides.
                _ => true,
            },
        };
        if !ok {
            refused.push(v);
        }
    }
    Ok(refused)
}

/// Video whose owner turned embedding off (error 101 / 150): other uploads of the same song, best first, at most 5.
/// Never the blocked ones (`exclude`). Empty = nothing else plays it.
#[tauri::command]
pub async fn alternative_videos(state: State<'_, AppState>, track_id: i64, exclude: Vec<String>) -> CmdResult<Vec<String>> {
    let t = state.lib().tracks().map_err(err)?.into_iter().find(|t| t.id == track_id).ok_or("Track not found")?.track;
    let yt = state.ytm_or_public();
    let mut out: Vec<String> = Vec::new();
    // Official song first, then uploads of it.
    let songs = yt.search_songs(&format!("{} {}", t.artist, t.title)).await.unwrap_or_default();
    let videos = yt.search_videos(&t.title).await.unwrap_or_default();
    for c in songs.iter().chain(&videos) {
        let Some(v) = c.ids.get(&Source::Youtube) else { continue };
        if !exclude.contains(v) && !out.contains(v) && music_core::matching::same_song_upload(&t, c) {
            out.push(v.clone());
        }
    }
    out.truncate(5);
    Ok(out)
}

/// Apple 30 s preview into the local engine. Returns store page (shown as "Listen on Apple Music").
#[tauri::command]
pub async fn play_preview(state: State<'_, AppState>, id: String, country: String) -> CmdResult<String> {
    let p = music_connectors::itunes::preview(hosts::get().itunes_lookup, &id, &store(&country)).await.map_err(err)?;
    let bytes = music_connectors::itunes::preview_audio(&p).await.map_err(err)?;
    state.player.send(Command::PlayMemory { label: format!("apple:{id}").into(), bytes: bytes.into() });
    Ok(p.page)
}
