//! Music Detector: 10 s from the microphone or from what the PC plays (`music_player::mic`, memory only), named by
//! AudD with the user's own token (keychain, never sent back to the interface).

use crate::{AppState, CmdResult, err};
use music_connectors::audd::{AudD, Offline, Refused};
use music_core::model::Track;
use music_player::mic::{self, MicError};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, State};

/// Music Detector: the user's AudD token is set (keychain; never sent back to the UI).
#[tauri::command]
pub fn detector_status(state: State<AppState>) -> bool {
    state.store.load::<String>(AUDD_TOKEN).is_some()
}

/// Trust boundary: an AudD token is letters and digits.
fn audd_token_ok(t: &str) -> bool {
    (8..=128).contains(&t.len()) && t.chars().all(|c| c.is_ascii_alphanumeric())
}

/// None = forget it.
#[tauri::command]
pub fn set_detector_token(state: State<AppState>, token: Option<String>) -> CmdResult<()> {
    let token = token.map(|t| t.trim().to_string());
    if token.as_deref().is_some_and(|t| !audd_token_ok(t)) {
        return Err("That doesn't look like an AudD token (letters and digits, from dashboard.audd.io)".into());
    }
    state.store.set(AUDD_TOKEN, token.map(serde_json::Value::String)).map_err(err)
}

pub const AUDD_TOKEN: &str = "audd_token";

/// Listening this long: enough for AudD, short to wait.
const DETECT_SECONDS: f32 = 10.0;

static DETECT_STOP: AtomicBool = AtomicBool::new(false);

/// What the Music Detector got. `Miss`: why not, worded by the UI.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Detection {
    Found { track: Track },
    Unknown,
    Miss { miss: DetectMiss, detail: Option<String> },
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DetectMiss {
    NoMic,
    MicBlocked,
    MicBusy,
    /// No sound output to listen to (This PC).
    NoOutput,
    /// Too quiet to recognize: muted or far mic, nothing playing on the PC.
    Silent,
    /// AudD heard it but couldn't make it out (#300).
    Unclear,
    Canceled,
    BadToken,
    Limit,
    /// No token, and AudD's free recognitions are used up (#901): a token of one's own now.
    FreeLimit,
    Offline,
    Failed,
}

fn missed(miss: DetectMiss) -> Detection {
    Detection::Miss { miss, detail: None }
}

/// Music Detector: listens through the default microphone or to what the PC plays (memory only, never written; the
/// interface pauses the app's own playback first), AudD names the song. Progress: "detect" events [seconds, level 0..1].
#[tauri::command]
pub async fn detect_song(app: tauri::AppHandle, state: State<'_, AppState>, market: String, input: mic::Input) -> CmdResult<Detection> {
    // No token: AudD's few free recognitions (user's request 2026-10-22: no account needed to try).
    let token = state.store.load::<String>(AUDD_TOKEN);
    // Trust boundary: a two-letter country.
    let market = if market.len() == 2 && market.chars().all(|c| c.is_ascii_alphabetic()) { market } else { "US".into() };
    DETECT_STOP.store(false, Ordering::Relaxed);
    let clip = tauri::async_runtime::spawn_blocking(move || {
        mic::record(input, DETECT_SECONDS, &DETECT_STOP, |seconds, level| {
            let _ = app.emit_to("main", "detect", (seconds, level));
        })
    })
    .await
    .map_err(err)?;
    let clip = match clip {
        Ok(c) => c,
        Err(e) => {
            return Ok(missed(match e {
                MicError::NoMic => DetectMiss::NoMic,
                MicError::NoOutput => DetectMiss::NoOutput,
                MicError::Blocked => DetectMiss::MicBlocked,
                MicError::Busy => DetectMiss::MicBusy,
                MicError::Failed => DetectMiss::Failed,
            }));
        }
    };
    if DETECT_STOP.load(Ordering::Relaxed) {
        return Ok(missed(DetectMiss::Canceled));
    }
    if clip.silent() {
        return Ok(missed(DetectMiss::Silent));
    }
    let wav = clip.wav();
    drop(clip);
    Ok(match AudD::default().recognize(token.as_deref(), wav, &market).await {
        Ok(Some(track)) => Detection::Found { track },
        Ok(None) => Detection::Unknown,
        Err(e) => match e.downcast_ref::<Refused>() {
            Some(Refused::BadToken) => missed(DetectMiss::BadToken),
            Some(Refused::Limit) if token.is_none() => missed(DetectMiss::FreeLimit),
            Some(Refused::Limit) => missed(DetectMiss::Limit),
            Some(Refused::Unclear) => missed(DetectMiss::Unclear),
            Some(Refused::Other(m)) => Detection::Miss { miss: DetectMiss::Failed, detail: Some(m.clone()) },
            None if e.is::<Offline>() => missed(DetectMiss::Offline),
            None => Detection::Miss { miss: DetectMiss::Failed, detail: Some(e.to_string()) },
        },
    })
}

/// Stops listening: nothing is sent.
#[tauri::command]
pub fn detect_stop() {
    DETECT_STOP.store(true, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audd_tokens_are_letters_and_digits() {
        assert!(audd_token_ok("0123456789abcdef0123456789abcdef"));
        assert!(!audd_token_ok("short"));
        assert!(!audd_token_ok("abc def 12345"));
        assert!(!audd_token_ok("abc\"; rm -rf; \"def"));
    }
}
