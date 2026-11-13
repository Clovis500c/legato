//! Last.fm scrobbling (Settings › Accounts): the user's own API key and shared secret, sign-in on last.fm through a
//! loopback callback, session key in the keychain. Listens that couldn't go (offline) wait in memory and go with the
//! next one, oldest first.

use crate::{AppState, CmdResult, err};
use music_connectors::lastfm::{BATCH, INVALID_SESSION, LastFm, LastFmError, Scrobble};
use music_connectors::oauth::loopback_param;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::State;

const KEY: &str = "lastfm";
/// Waiting listens kept at most (a long offline stretch): the oldest go first.
const KEEP: usize = 500;

#[derive(Default, Clone, Serialize, Deserialize)]
struct Saved {
    key: String,
    secret: String,
    session: Option<String>,
    user: Option<String>,
}

#[derive(Default)]
pub struct Pending(Mutex<Vec<Scrobble>>);

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "LastfmStatus")]
pub struct Status {
    /// Key and secret entered.
    configured: bool,
    /// Signed in as (None = not signed in).
    user: Option<String>,
    /// Listens waiting to be sent.
    waiting: usize,
}

fn saved(state: &AppState) -> Saved {
    state.store.load(KEY).unwrap_or_default()
}

fn save(state: &AppState, s: &Saved) -> CmdResult<()> {
    state.store.set(KEY, Some(serde_json::to_value(s).map_err(err)?)).map_err(err)
}

#[tauri::command]
pub async fn lastfm_status(state: State<'_, AppState>, pending: State<'_, Pending>) -> CmdResult<Status> {
    let s = saved(&state);
    Ok(Status { configured: !s.key.is_empty(), user: s.session.as_ref().and(s.user.clone()), waiting: pending.0.lock().unwrap().len() })
}

/// Key and secret from last.fm/api/account/create, then the user allows the app on last.fm (browser, 5 minutes).
#[tauri::command]
pub async fn lastfm_connect(state: State<'_, AppState>, key: String, secret: String) -> CmdResult<String> {
    // Trust boundary: 32 hex characters each.
    let (key, secret) = (key.trim().to_lowercase(), secret.trim().to_lowercase());
    if !LastFm::valid_key(&key) || !LastFm::valid_key(&secret) {
        return Err("The API key and the shared secret are 32 characters each (letters a–f and digits), from last.fm/api".into());
    }
    let fm = LastFm::new(&key, &secret);
    let open = state.open.clone();
    // Our state rides in the callback's query; Last.fm adds `token` to it.
    let (token, _) = loopback_param("token", |redirect, st| fm.auth_url(&format!("{redirect}?state={st}")).unwrap_or_default(), |url| open(url), Duration::from_secs(300)).await.map_err(err)?;
    let (session, user) = fm.session(&token).await.map_err(err)?;
    save(&state, &Saved { key, secret, session: Some(session), user: Some(user.clone()) })?;
    Ok(user)
}

#[tauri::command]
pub async fn lastfm_disconnect(state: State<'_, AppState>, pending: State<'_, Pending>) -> CmdResult<()> {
    pending.0.lock().unwrap().clear();
    state.store.set(KEY, None).map_err(err)
}

fn client(state: &AppState) -> Option<(LastFm, String)> {
    let s = saved(state);
    Some((LastFm::new(&s.key, &s.secret), s.session?))
}

/// Session revoked on last.fm: forget it (the card asks to sign in again).
fn revoked(state: &AppState, e: &anyhow::Error) -> bool {
    if e.downcast_ref::<LastFmError>().is_some_and(|e| e.code == INVALID_SESSION) {
        let mut s = saved(state);
        s.session = None;
        let _ = save(state, &s);
        return true;
    }
    false
}

/// What plays now, on the profile. Failures are dropped (Last.fm: never retried).
#[tauri::command]
pub async fn lastfm_now_playing(state: State<'_, AppState>, scrobble: Scrobble) -> CmdResult<()> {
    let Some((fm, sk)) = client(&state) else { return Ok(()) };
    if let Err(e) = fm.now_playing(&sk, &clean(scrobble)).await {
        revoked(&state, &e);
    }
    Ok(())
}

/// Trust boundary: names kept short, as Last.fm wants them.
fn clean(mut s: Scrobble) -> Scrobble {
    let cut = |t: &str| t.chars().take(300).collect::<String>();
    s.artist = cut(&s.artist);
    s.track = cut(&s.track);
    s.album = s.album.as_deref().map(cut);
    s
}

/// One finished listen (the UI checked Last.fm's rule: half the song or 4 minutes). Sent with any waiting ones.
#[tauri::command]
pub async fn lastfm_scrobble(state: State<'_, AppState>, pending: State<'_, Pending>, scrobble: Scrobble) -> CmdResult<usize> {
    if scrobble.artist.trim().is_empty() || scrobble.track.trim().is_empty() {
        return Err("A scrobble needs an artist and a title".into());
    }
    let Some((fm, sk)) = client(&state) else { return Ok(0) };
    let batch: Vec<Scrobble> = {
        let mut p = pending.0.lock().unwrap();
        p.push(clean(scrobble));
        let over = p.len().saturating_sub(KEEP);
        p.drain(..over);
        p.iter().take(BATCH).cloned().collect()
    };
    match fm.scrobble(&sk, &batch).await {
        Ok(()) => {
            let mut p = pending.0.lock().unwrap();
            let n = batch.len().min(p.len());
            p.drain(..n);
            Ok(p.len())
        }
        Err(e) => {
            if revoked(&state, &e) {
                return Err("Last.fm signed you out: sign in again in Settings › Accounts".into());
            }
            Ok(pending.0.lock().unwrap().len())
        }
    }
}

const DISCOVERIES: &str = "lastfmDiscoveries";
const FRESH_S: i64 = 86_400;
/// Favourites asked about, similar artists asked for each, artists kept, songs taken from each.
const FAVOURITES: usize = 3;
const SIMILAR: u32 = 10;
const NEW_ARTISTS: usize = 10;
const PER_ARTIST: u32 = 2;
const GAP: Duration = Duration::from_millis(300);

#[derive(Serialize, Deserialize)]
struct Found {
    at: i64,
    tracks: Vec<music_core::model::Track>,
}

/// Today's answer (or today's ask that found nothing): Last.fm is asked once a day, 13 requests at most.
fn asked_today(kept: Option<Found>, now: i64) -> Option<CmdResult<Vec<music_core::model::Track>>> {
    let f = kept.filter(|f| (0..FRESH_S).contains(&(now - f.at)))?;
    Some(if f.tracks.is_empty() { Err("Last.fm was already asked today: new suggestions tomorrow".into()) } else { Ok(f.tracks) })
}

/// Mixes › Last.fm discoveries (Settings › Playback › Last.fm discoveries, off; needs the user's own Last.fm key): songs by
/// artists close to the three you play most and not in the library. 13 requests with the key (the favourites' names go to
/// Last.fm, nothing else), once a day, the answer kept in this PC's library. The songs carry no ids: they are found on
/// YouTube as they come up in the queue.
#[tauri::command]
pub async fn lastfm_discoveries(state: State<'_, AppState>) -> CmdResult<Vec<music_core::model::Track>> {
    let s = saved(&state);
    if s.key.is_empty() {
        return Err("Connect Last.fm in Settings › Accounts first (your own API key)".into());
    }
    let now = crate::unix_now();
    let (favourites, known) = {
        let lib = state.lib();
        let kept = lib.setting(DISCOVERIES).ok().flatten().and_then(|v| serde_json::from_value::<Found>(v).ok());
        if let Some(r) = asked_today(kept, now) {
            return r;
        }
        let stats = lib.play_stats().map_err(err)?;
        let tracks = lib.tracks().map_err(err)?;
        let favourites = music_core::discover::top_artists(tracks.iter().map(|t| (t.track.artist.as_str(), stats.get(&t.id).map_or(0, |s| s.0))), FAVOURITES);
        (favourites, tracks.iter().map(|t| music_core::matching::first_artist(&t.track.artist).to_string()).collect::<Vec<_>>())
    };
    if favourites.is_empty() {
        return Err("Play some songs first: the discoveries start from the artists you play most".into());
    }
    // The day's ask noted before it is made: an error or an empty answer is not asked again before tomorrow either.
    if let Ok(json) = serde_json::to_value(Found { at: now, tracks: Vec::new() }) {
        state.lib().set_setting(DISCOVERIES, &json).map_err(err)?;
    }
    let fm = LastFm::new(&s.key, &s.secret);
    let mut lists = Vec::new();
    for artist in &favourites {
        lists.push(fm.similar_artists(artist, SIMILAR).await.map_err(err)?);
        tokio::time::sleep(GAP).await;
    }
    let mut tracks = Vec::new();
    for artist in music_core::discover::fresh_artists(&lists, known.iter().map(String::as_str), NEW_ARTISTS) {
        tokio::time::sleep(GAP).await;
        for title in fm.top_tracks(&artist, PER_ARTIST).await.map_err(err)? {
            tracks.push(music_core::model::Track { title, artist: artist.clone(), ..Default::default() });
        }
    }
    if tracks.is_empty() {
        return Err("Last.fm found no new artist close to yours".into());
    }
    if let Ok(json) = serde_json::to_value(Found { at: now, tracks: tracks.clone() }) {
        let _ = state.lib().set_setting(DISCOVERIES, &json);
    }
    Ok(tracks)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_fm_is_asked_once_a_day_even_when_the_ask_failed() {
        let song = music_core::model::Track { title: "t".into(), artist: "a".into(), ..Default::default() };
        let found = |at, tracks: Vec<music_core::model::Track>| Some(Found { at, tracks });
        assert_eq!(asked_today(found(1_000, vec![song.clone()]), 2_000).unwrap().unwrap()[0].title, "t");
        // Asked today, nothing came (an error, no new artist): not asked again.
        assert!(asked_today(found(1_000, Vec::new()), 2_000).unwrap().is_err());
        // A day later, or never asked: ask.
        assert!(asked_today(found(1_000, vec![song]), 1_000 + FRESH_S).is_none());
        assert!(asked_today(None, 2_000).is_none());
    }
}
