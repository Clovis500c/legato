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

/// What a saved profile is worth: it counts only while the keychain still holds the sign-in. Without it (the entry was
/// removed, another Windows account) the profile is forgotten: the second value says so.
fn standing(saved: Option<Profile>, connected: bool) -> (Option<Profile>, bool) {
    match (saved, connected) {
        (Some(p), true) => (Some(p), false),
        (Some(_), false) => (None, true),
        (None, _) => (None, false),
    }
}

/// The signed-in profile now, for the links this PC makes and for Settings; a stale one is cleared on the way.
pub fn current(state: &AppState) -> Option<Profile> {
    let saved = saved(state);
    // The keychain is asked only when there is a profile (a share with no sign-in reads nothing).
    let connected = saved.is_some() && login(state).is_connected();
    let (profile, forget) = standing(saved, connected);
    if forget {
        let _ = state.lib().set_setting(PROFILE, &serde_json::Value::Null);
    }
    profile
}

/// The signed-in profile (None = not signed in).
#[tauri::command]
pub async fn discord_login_status(state: State<'_, AppState>) -> CmdResult<Option<Profile>> {
    Ok(current(&state))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_profile_counts_only_while_the_keychain_holds_the_sign_in() {
        let p = Profile { id: "1".into(), name: "Nelly".into() };
        assert_eq!(standing(Some(p.clone()), true), (Some(p.clone()), false));
        assert_eq!(standing(Some(p), false), (None, true));
        assert_eq!(standing(None, true), (None, false));
        assert_eq!(standing(None, false), (None, false));
    }
}
