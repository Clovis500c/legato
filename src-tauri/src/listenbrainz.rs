//! ListenBrainz scrobbling (Settings › Accounts): the user's token from listenbrainz.org, checked once, kept in the
//! keychain. Listens that couldn't go (offline, too fast) wait in memory and go with the next one, oldest first.

use crate::{AppState, CmdResult, err};
use music_connectors::listenbrainz::{BATCH, Listen, ListenBrainz, Refused};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, State};

const KEY: &str = "listenbrainz";
/// Waiting listens kept at most (a long offline stretch): the oldest go first.
const KEEP: usize = 500;

#[derive(Clone, Serialize, Deserialize)]
struct Saved {
    token: String,
    user: String,
}

#[derive(Default)]
pub struct Pending(Mutex<Vec<Listen>>);

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "ListenbrainzStatus")]
pub struct Status {
    /// Sending as (None = no token).
    user: Option<String>,
    /// Listens waiting to be sent.
    waiting: usize,
}

fn saved(state: &AppState) -> Option<Saved> {
    state.store.load(KEY)
}

fn client(app: &AppHandle, state: &AppState) -> Option<ListenBrainz> {
    saved(state).map(|s| ListenBrainz::new(&s.token, &app.package_info().version.to_string()))
}

#[tauri::command]
pub async fn listenbrainz_status(state: State<'_, AppState>, pending: State<'_, Pending>) -> CmdResult<Status> {
    Ok(Status { user: saved(&state).map(|s| s.user), waiting: pending.0.lock().unwrap().len() })
}

/// Token from listenbrainz.org › Settings: ListenBrainz says whose it is, then it's kept.
#[tauri::command]
pub async fn listenbrainz_connect(app: AppHandle, state: State<'_, AppState>, token: String) -> CmdResult<String> {
    let token = token.trim().to_string();
    if !ListenBrainz::valid_token(&token) {
        return Err("A ListenBrainz token is the long code under Settings › User token on listenbrainz.org".into());
    }
    let user = ListenBrainz::new(&token, &app.package_info().version.to_string()).user().await.map_err(err)?;
    let Some(user) = user else { return Err("ListenBrainz does not know this token: copy it again from listenbrainz.org › Settings".into()) };
    state.store.set(KEY, Some(serde_json::to_value(Saved { token, user: user.clone() }).map_err(err)?)).map_err(err)?;
    Ok(user)
}

#[tauri::command]
pub async fn listenbrainz_disconnect(state: State<'_, AppState>, pending: State<'_, Pending>) -> CmdResult<()> {
    pending.0.lock().unwrap().clear();
    state.store.set(KEY, None).map_err(err)
}

/// Token refused (reset on listenbrainz.org): forget it, the card asks for it again. Waiting listens stay.
fn refused(state: &AppState, e: &anyhow::Error) -> bool {
    let token = e.downcast_ref::<Refused>() == Some(&Refused::Token);
    if token {
        let _ = state.store.set(KEY, None);
    }
    token
}

/// Trust boundary: names kept short (a listen is 10 kB at most).
fn clean(mut l: Listen) -> Listen {
    let cut = |t: &str| t.chars().take(300).collect::<String>();
    l.artist = cut(&l.artist);
    l.track = cut(&l.track);
    l.album = l.album.as_deref().map(cut);
    l
}

/// What plays now, on the profile. Failures are dropped.
#[tauri::command]
pub async fn listenbrainz_now_playing(app: AppHandle, state: State<'_, AppState>, listen: Listen) -> CmdResult<()> {
    let Some(lb) = client(&app, &state) else { return Ok(()) };
    if let Err(e) = lb.playing_now(&clean(listen)).await {
        refused(&state, &e);
    }
    Ok(())
}

/// One finished listen (the UI checked the rule: half the song or 4 minutes). Sent with any waiting ones; a refusal
/// (offline, too fast) keeps them for the next listen, never a quicker retry.
#[tauri::command]
pub async fn listenbrainz_submit(app: AppHandle, state: State<'_, AppState>, pending: State<'_, Pending>, listen: Listen) -> CmdResult<usize> {
    if listen.artist.trim().is_empty() || listen.track.trim().is_empty() {
        return Err("A listen needs an artist and a title".into());
    }
    let Some(lb) = client(&app, &state) else { return Ok(0) };
    let batch: Vec<Listen> = {
        let mut p = pending.0.lock().unwrap();
        p.push(clean(listen));
        let over = p.len().saturating_sub(KEEP);
        p.drain(..over);
        p.iter().take(BATCH).cloned().collect()
    };
    // Out of the queue: accepted, or never accepted as they are (400). Offline or too fast: they wait.
    let gone = match lb.submit(&batch).await {
        Ok(()) => true,
        Err(e) if refused(&state, &e) => return Err("ListenBrainz refused your token: paste it again in Settings › Accounts".into()),
        Err(e) => matches!(e.downcast_ref::<Refused>(), Some(Refused::Listen(_))),
    };
    let mut p = pending.0.lock().unwrap();
    if gone {
        let n = batch.len().min(p.len());
        p.drain(..n);
    }
    Ok(p.len())
}
