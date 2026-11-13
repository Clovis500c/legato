//! YouTube Music accounts: sign-out, which accounts sync, and each source's sync direction.

use super::*;

/// Signs every Google account out of the app; library kept.
#[tauri::command]
pub async fn ytm_sign_out(state: State<'_, AppState>) -> CmdResult<()> {
    ytm::sign_out(&state.app).map_err(err)?;
    state.cache.youtube.clear();
    state.cache.home.clear();
    state.cache.status.clear();
    state.lib().set_setting("ytm_accounts", &serde_json::json!([])).map_err(err)
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct YtmAccounts {
    signed_in: bool,
    /// Every Google account and channel in the session.
    accounts: Vec<Account>,
    /// Keys of accounts synced into the library.
    picked: Vec<String>,
}

#[tauri::command]
pub async fn ytm_accounts(state: State<'_, AppState>) -> CmdResult<YtmAccounts> {
    let Some(cookie) = ytm::session(&state.app) else { return Ok(YtmAccounts { signed_in: false, accounts: Vec::new(), picked: Vec::new() }) };
    let accounts = YouTubeMusic::new(&cookie).map_err(err)?.accounts().await.map_err(err)?;
    let picked = state.ytm_picked();
    let picked = if picked.is_empty() { vec!["0".to_string()] } else { picked.iter().map(Account::key).collect() };
    Ok(YtmAccounts { signed_in: true, accounts, picked })
}

/// Accounts to sync (first one also gets exports).
#[tauri::command]
pub async fn set_ytm_accounts(state: State<'_, AppState>, accounts: Vec<Account>) -> CmdResult<()> {
    // Trust boundary: values end up in request headers.
    let ok = accounts.len() <= 20 && accounts.iter().all(|a| a.authuser < 10 && a.name.chars().count() <= 200 && a.page_id.as_ref().is_none_or(|p| p.len() <= 40 && p.bytes().all(|b| b.is_ascii_digit())) && a.photo.as_ref().is_none_or(|p| p.len() <= 500));
    if !ok {
        return Err("Invalid accounts".into());
    }
    state.cache.youtube.clear();
    state.cache.home.clear();
    state.lib().save_shared_setting("ytm_accounts", &serde_json::json!(accounts), music_core::library::now_ms()).map_err(err)
}

pub const NOT_SENT: &str = "Changes made here aren't sent to this YouTube Music account (Settings › Accounts › Sync)";

pub fn ytm_key(y: &YouTubeMusic) -> String {
    format!("youtube:{}", y.account_key())
}

/// Each account's sync direction; missing = both ways.
#[tauri::command]
pub async fn sync_directions(state: State<'_, AppState>) -> CmdResult<serde_json::Value> {
    Ok(state.lib().setting(DIRECTIONS).map_err(err)?.unwrap_or_else(|| serde_json::json!({})))
}

#[tauri::command]
pub async fn set_sync_direction(state: State<'_, AppState>, key: String, direction: Direction) -> CmdResult<()> {
    let lib = state.lib();
    let saved = service_sync::with_direction(lib.setting(DIRECTIONS).map_err(err)?.as_ref(), &key, direction);
    lib.save_shared_setting(DIRECTIONS, &saved, music_core::library::now_ms()).map_err(err)
}
