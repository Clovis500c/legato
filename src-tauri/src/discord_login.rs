//! Optional sign-in with Discord (Settings › Accounts, off by default): who shared a playlist, shown on the share page.
//! The tokens are in the keychain; the profile (name and id, from the `identify` scope) is a library setting, carried in
//! the links this PC makes (`sharing.rs`). Desktop only.

use crate::{AppState, CmdResult, err};
use music_connectors::discord_login::DiscordLogin;
use music_core::share::Profile;
use tauri::State;

/// Library setting holding the signed-in profile.
pub const PROFILE: &str = "discordProfile";

fn login(state: &AppState) -> DiscordLogin {
    DiscordLogin::new(state.store.clone(), state.open.clone())
}

fn saved(state: &AppState) -> Option<Profile> {
    state.lib().setting(PROFILE).ok().flatten().and_then(|v| serde_json::from_value::<Profile>(v).ok()).filter(Profile::valid)
}

/// The signed-in profile (None = not signed in).
#[tauri::command]
pub async fn discord_login_status(state: State<'_, AppState>) -> CmdResult<Option<Profile>> {
    Ok(saved(&state).filter(|_| login(&state).is_connected()))
}

/// Discord's page opens in the browser; the answer comes back on `REDIRECT` (5 minutes to allow it).
#[tauri::command]
pub async fn discord_login_connect(state: State<'_, AppState>) -> CmdResult<Profile> {
    let profile = login(&state).connect().await.map_err(err)?;
    state.lib().set_setting(PROFILE, &serde_json::to_value(&profile).map_err(err)?).map_err(err)?;
    Ok(profile)
}

/// Tokens and profile forgotten here (the app stays listed in the user's Discord settings until they remove it there).
#[tauri::command]
pub async fn discord_login_disconnect(state: State<'_, AppState>) -> CmdResult<()> {
    login(&state).disconnect().map_err(err)?;
    state.lib().set_setting(PROFILE, &serde_json::Value::Null).map_err(err)
}
