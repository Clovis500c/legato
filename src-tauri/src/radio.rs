//! Internet radio (the Radio page): stations searched in Radio Browser's open directory, and the ones the user keeps
//! (this PC's library settings, `radioStations`). A station plays through the engine's endless stream
//! (`server:radio:<address>`, docs/playback.md). Only when the user searches does the app talk to the directory.

use crate::{AppState, CmdResult, err};
use music_connectors::radio_browser::{RadioBrowser, Station};
use tauri::State;

const KEY: &str = "radioStations";
/// Kept stations: a list, not a library.
const MAX_KEPT: usize = 200;

fn kept(state: &AppState) -> Vec<Station> {
    state.lib().setting(KEY).ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

/// Trust boundary (a station comes back from the interface): an http(s) address, a name, bounded text.
fn clean(s: Station) -> Option<Station> {
    let ok = s.url.len() <= 2_000 && (s.url.starts_with("https://") || s.url.starts_with("http://")) && !s.url.chars().any(char::is_control);
    let name = s.name.trim().chars().take(200).collect::<String>();
    (ok && !name.is_empty() && s.id.len() <= 100).then(|| Station {
        name,
        country: s.country.chars().take(100).collect(),
        tags: s.tags.into_iter().take(10).map(|t| t.chars().take(50).collect()).collect(),
        codec: s.codec.chars().take(10).collect(),
        ..s
    })
}

#[tauri::command]
pub async fn radio_search(query: String) -> CmdResult<Vec<Station>> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 100 {
        return Err("Type a station's name".into());
    }
    RadioBrowser::default().search(query, 30).await.map_err(err)
}

#[tauri::command]
pub fn radio_kept(state: State<'_, AppState>) -> Vec<Station> {
    kept(&state)
}

/// Keeps a station (once), or lets it go.
#[tauri::command]
pub fn radio_keep(state: State<'_, AppState>, station: Station, keep: bool) -> CmdResult<Vec<Station>> {
    let mut all = kept(&state);
    all.retain(|s| s.id != station.id);
    if keep {
        let s = clean(station).ok_or("Not a station")?;
        if all.len() >= MAX_KEPT {
            return Err("You keep 200 stations already".into());
        }
        all.insert(0, s);
    }
    state.lib().set_setting(KEY, &serde_json::to_value(&all).map_err(err)?).map_err(err)?;
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn station(url: &str, name: &str) -> Station {
        Station { id: "a1".into(), name: name.into(), url: url.into(), codec: "MP3".into(), bitrate: 128, country: "France".into(), tags: vec!["jazz".into(); 20] }
    }

    #[test]
    fn only_a_named_http_stream_is_kept_and_text_is_bounded() {
        assert!(clean(station("https://x.example/live", "Jazz")).is_some_and(|s| s.tags.len() == 10));
        assert!(clean(station("file:///C:/x", "Jazz")).is_none());
        assert!(clean(station("https://x.example/a\nb", "Jazz")).is_none());
        assert!(clean(station("https://x.example/a\u{7}b", "Jazz")).is_none());
        assert!(clean(station("https://x.example/live", "  ")).is_none());
        assert_eq!(clean(station("http://x.example/live", &"n".repeat(500))).unwrap().name.len(), 200);
    }
}
