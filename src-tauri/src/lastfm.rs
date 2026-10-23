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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
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
