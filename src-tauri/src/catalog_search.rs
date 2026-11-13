//! Search: the catalogs (YouTube Music, YouTube, Apple Music), the suggestions as one types.

use super::*;

/// UTC day number (mix seed).
pub fn today() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() / 86_400)
}

/// YouTube Music song search, cached for the session. Signed out: its public catalog (2026-10-30: imports and
/// fallbacks found nothing without a Google sign-in).
pub async fn yt_search(state: &AppState, query: &str) -> Result<Vec<Track>, String> {
    let key = query.trim().to_lowercase();
    if let Some(hit) = state.cache.youtube.get(&key) {
        return Ok((*hit).clone());
    }
    let found = state.ytm_or_public().search_songs(query).await.map_err(err)?;
    state.cache.youtube.put(&key, found.clone());
    Ok(found)
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SearchHit {
    #[serde(flatten)]
    hit: Hit,
    /// Library row when already added.
    library_id: Option<i64>,
}

/// Normal YouTube search (session if signed in, anonymous otherwise), cached 30 min.
pub async fn video_search(state: &AppState, query: &str) -> Result<Vec<(Track, Musicness)>, String> {
    let key = query.trim().to_lowercase();
    if let Some(hit) = state.cache.videos.get(&key) {
        return Ok((*hit).clone());
    }
    let web = YouTubeWeb::with_api(hosts::get().youtube, ytm::session(&state.app).as_deref());
    let found: Vec<(Track, Musicness)> = web.search(query).await.map_err(err)?.into_iter().map(|v| {
        let m = v.musicness();
        (v.track, m)
    }).collect();
    state.cache.videos.put(&key, found.clone());
    Ok(found)
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SearchResults {
    hits: Vec<SearchHit>,
    errors: Vec<String>,
}

/// Trust boundary: ISO 3166 store code from UI locale.
pub fn store(country: &str) -> String {
    if country.len() == 2 && country.chars().all(|c| c.is_ascii_alphabetic()) { country.to_uppercase() } else { "US".into() }
}

/// Normal YouTube + YouTube Music songs + Apple catalog, merged (same recording = one hit with every id). Each hit says
/// whether it looks like music; the UI hides the clear "not music" ones until asked.
#[tauri::command]
pub async fn search_catalogs(state: State<'_, AppState>, query: String, country: String) -> CmdResult<SearchResults> {
    // Trust boundary: free text from UI.
    let query = query.trim().to_string();
    if query.is_empty() || query.chars().count() > 200 {
        return Err("Search: 1 to 200 characters".into());
    }
    let country = store(&country);
    let apple_key = format!("{country}:{}", query.to_lowercase());
    let known = state.cache.apple.get(&apple_key);
    let apple = tauri::async_runtime::spawn({
        let q = query.clone();
        async move {
            match known {
                Some(hit) => Ok((*hit).clone()),
                None => music_connectors::itunes::search(hosts::get().itunes, &q, &country).await,
            }
        }
    });
    let mut errors = Vec::new();
    let (videos, songs) = tokio::join!(video_search(&state, &query), yt_search(&state, &query));
    let videos = videos.unwrap_or_else(|e| {
        errors.push(format!("YouTube: {e}"));
        Vec::new()
    });
    let songs = songs.unwrap_or_else(|e| {
        errors.push(format!("YouTube Music: {e}"));
        Vec::new()
    });
    let apple = match apple.await.map_err(err)? {
        Ok(found) => {
            state.cache.apple.put(&apple_key, found.clone());
            found
        }
        Err(e) => {
            errors.push(format!("Apple Music: {}", err(e)));
            Vec::new()
        }
    };
    let lib = state.lib();
    let hits = search::merge(videos, songs, apple).into_iter().map(|hit| SearchHit { library_id: lib.find(&hit.track).ok().flatten(), hit }).collect();
    Ok(SearchResults { hits, errors })
}

/// What YouTube's search box would suggest for this text (top bar, as you type; off in Settings › General).
#[tauri::command]
pub async fn search_suggestions(query: String, lang: String, country: String) -> CmdResult<Vec<String>> {
    // Trust boundary: free text from UI.
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 100 {
        return Ok(Vec::new());
    }
    let lang = if lang.len() == 2 && lang.bytes().all(|b| b.is_ascii_lowercase()) { lang } else { "en".into() };
    music_connectors::ytweb::suggestions(hosts::get().suggest, query, &lang, &store(&country)).await.map_err(err)
}
