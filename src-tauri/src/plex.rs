//! Sign in with Plex (Settings › Accounts › Your music server): a PIN made on plex.tv, the user's own browser opened at
//! Plex's own page with it (the app never sees or types a password, never drives that page), the PIN read again every
//! few seconds until its token, its expiry or Cancel; then the account's servers, one picked (its best address that
//! answers as it), its own token kept with the other servers (`servers.rs`). The account's token stays in memory
//! only, until the pick or Cancel.

use crate::{AppState, CmdResult, err};
use music_connectors::plex::{self, PinState, PlexTv, Resource};
use music_core::server::{self, Account, Kind};
use serde::Serialize;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::State;

/// The PIN read again this often (Plex's page takes a few seconds to sign in).
const POLL: Duration = Duration::from_secs(3);
/// After a refusal from plex.tv (429): this long before the next read.
const BUSY: Duration = Duration::from_secs(30);
/// A PIN waits this long at most, whatever plex.tv said.
const LONGEST: Duration = Duration::from_secs(30 * 60);

/// A sign-in in progress.
struct Waiting {
    round: u64,
    client: String,
    pin: plex::Pin,
    user: String,
    servers: Vec<Resource>,
}

static WAIT: Mutex<Option<Waiting>> = Mutex::new(None);
/// Each sign-in (and Cancel) moves it on: a wait from an older one stops.
static ROUND: AtomicU64 = AtomicU64::new(0);

/// What the row shows while Plex's page waits for the user.
#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlexPin {
    /// The code on Plex's page.
    code: String,
    expires_in_s: u32,
    /// Plex's page again, for a browser tab closed too soon (no secret in it: the PIN's code and this sign-in's id).
    auth_url: String,
}

/// A server of the Plex account, for the picker. Never its token.
#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlexServer {
    id: String,
    name: String,
    /// The account's own (else shared with it).
    owned: bool,
}

/// Sign in with Plex: a PIN, and Plex's page opened in the user's browser with it.
#[tauri::command]
pub async fn plex_sign_in(state: State<'_, AppState>) -> CmdResult<PlexPin> {
    let client = plex::device_id();
    let tv = PlexTv::new(&client);
    let pin = tv.pin().await.map_err(err)?;
    let round = ROUND.fetch_add(1, Ordering::SeqCst) + 1;
    (state.open)(&tv.auth_url(&pin.code)).map_err(err)?;
    let shown = PlexPin { code: pin.code.clone(), expires_in_s: pin.expires_in.min(LONGEST.as_secs()) as u32, auth_url: tv.auth_url(&pin.code) };
    *WAIT.lock().unwrap() = Some(Waiting { round, client, pin, user: String::new(), servers: Vec::new() });
    Ok(shown)
}

fn current(round: u64) -> bool {
    ROUND.load(Ordering::SeqCst) == round
}

/// Waits for the user on Plex's page, then lists the account's servers (owned first).
#[tauri::command]
pub async fn plex_wait() -> CmdResult<Vec<PlexServer>> {
    let (round, client, pin) = {
        let w = WAIT.lock().unwrap();
        let w = w.as_ref().ok_or("Plex's sign-in code expired: sign in with Plex again")?;
        (w.round, w.client.clone(), w.pin.clone())
    };
    let tv = PlexTv::new(&client);
    let until = Instant::now() + Duration::from_secs(pin.expires_in).min(LONGEST);
    let token = loop {
        tokio::time::sleep(POLL).await;
        if !current(round) {
            return Err("Sign-in with Plex cancelled".into());
        }
        if Instant::now() > until {
            return Err("Plex's sign-in code expired: sign in with Plex again".into());
        }
        match tv.check(&pin).await {
            Ok(PinState::Done(t)) => break t,
            Ok(PinState::Waiting) => {}
            Ok(PinState::Expired) => return Err("Plex's sign-in code expired: sign in with Plex again".into()),
            // Never a quicker read after a refusal; a network blip waits for the next read.
            Err(e) if e.to_string().starts_with("Plex is busy") => tokio::time::sleep(BUSY).await,
            Err(e) if e.to_string().starts_with("Plex's sign-in doesn't answer") => {}
            Err(e) => return Err(err(e)),
        }
    };
    let user = tv.user(&token).await.map_err(err)?;
    let servers = tv.servers(&token).await.map_err(err)?;
    if servers.is_empty() {
        return Err("Your Plex account has no server: set one up in Plex, then sign in again".into());
    }
    let shown = servers.iter().map(|r| PlexServer { id: r.id.clone(), name: r.name.clone(), owned: r.owned }).collect();
    let mut w = WAIT.lock().unwrap();
    match w.as_mut() {
        // The account's token itself isn't kept: each server came with its own.
        Some(w) if w.round == round => (w.user, w.servers) = (user, servers),
        _ => return Err("Sign-in with Plex cancelled".into()),
    }
    Ok(shown)
}

/// Cancel: the wait stops, what it learnt is forgotten.
#[tauri::command]
pub async fn plex_cancel() -> CmdResult<()> {
    ROUND.fetch_add(1, Ordering::SeqCst);
    *WAIT.lock().unwrap() = None;
    Ok(())
}

/// The server picked: its best address that answers, its token in the keychain. The first sync is the interface's
/// next call.
#[tauri::command]
pub async fn plex_pick(state: State<'_, AppState>, id: String) -> CmdResult<crate::servers::ServerStatus> {
    let (round, client, user, r) = {
        let w = WAIT.lock().unwrap();
        let w = w.as_ref().ok_or("Plex's sign-in code expired: sign in with Plex again")?;
        let r = w.servers.iter().find(|r| r.id == id).cloned().ok_or("Your Plex account has no server: set one up in Plex, then sign in again")?;
        (w.round, w.client.clone(), w.user.clone(), r)
    };
    let (direct, relays) = plex::split(&r.connections);
    let clean = |all: Vec<String>| all.into_iter().filter_map(|c| server::normalize(&c).ok()).collect::<Vec<_>>();
    let (connections, relays) = (clean(direct), clean(relays));
    let tried: Vec<String> = connections.iter().chain(&relays).cloned().collect();
    let address = plex::pick(&tried, &r.token, &client, &r.id).await.map_err(err)?;
    if !current(round) {
        return Err("Sign-in with Plex cancelled".into());
    }
    let account = Account { kind: Kind::Plex, address, user, token: r.token, device: client, server_id: r.id, name: r.name, connections, relays, ..Default::default() };
    *WAIT.lock().unwrap() = None;
    if !account.complete() {
        return Err("Your music server doesn't answer: none of the addresses Plex gave for it answered (is it on?)".into());
    }
    crate::servers::add(&state, account)
}
