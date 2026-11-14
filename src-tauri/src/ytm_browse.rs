//! YouTube Music's pages in the app: home, an album, a list, an artist.

use super::*;

/// YouTube Music's home shelves (its recommendations for the first picked account) and its mood chips; `mood` = a
/// chip's params, the home filtered to it. Empty when signed out.
#[tauri::command]
pub async fn ytm_home(state: State<'_, AppState>, mood: Option<String>) -> CmdResult<Home> {
    // Trust boundary: params go into a YouTube request.
    let key = mood.unwrap_or_default();
    if !key.is_empty() && !valid_mood(&key) {
        return Err("Invalid mood".into());
    }
    if let Some(hit) = state.cache.home.get(&key) {
        return Ok((*hit).clone());
    }
    let Some(yt) = state.ytm() else { return Ok(Home { shelves: Vec::new(), moods: Vec::new() }) };
    let home = yt.home((!key.is_empty()).then_some(key.as_str())).await.map_err(err)?;
    Ok((*state.cache.home.put(&key, home)).clone())
}

/// One slot of an album page: catalog song, and your copy when you have it.
#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AlbumSlot {
    disc: u8,
    number: u16,
    track: Track,
    library_id: Option<i64>,
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AlbumInfo {
    year: Option<u16>,
    slots: Vec<AlbumSlot>,
}

/// Album page details from the Apple catalog: year, every song in order, which ones you have (`track_ids` = your songs
/// of this album). None = not found in the store.
#[tauri::command]
pub async fn album_info(state: State<'_, AppState>, artist: String, album: String, track_ids: Vec<i64>, country: String) -> CmdResult<Option<AlbumInfo>> {
    use music_connectors::itunes;
    // Trust boundary: names go into an Apple search.
    if artist.trim().is_empty() || album.trim().is_empty() || artist.len() > 300 || album.len() > 300 {
        return Err("Invalid album".into());
    }
    let country = store(&country);
    let key = format!("{artist}\0{album}\0{country}");
    let found = match state.cache.albums.get(&key) {
        Some(hit) => hit,
        None => state.cache.albums.put(&key, itunes::album(hosts::get().itunes, hosts::get().itunes_lookup, &artist, &album, &country).await.map_err(err)?),
    };
    let Some(a) = found.as_ref() else { return Ok(None) };
    let mine: Vec<_> = state.lib().tracks().map_err(err)?.into_iter().filter(|t| track_ids.contains(&t.id)).collect();
    let catalog: Vec<Track> = a.songs.iter().map(|s| s.track.clone()).collect();
    let copies: Vec<Track> = mine.iter().map(|t| t.track.clone()).collect();
    let slots = music_core::matching::album_slots(&catalog, &copies);
    Ok(Some(AlbumInfo {
        year: a.year,
        slots: a.songs.iter().zip(slots).map(|(s, j)| AlbumSlot { disc: s.disc, number: s.number, track: s.track.clone(), library_id: j.map(|j| mine[j].id) }).collect(),
    }))
}

/// Songs of a home card's playlist, album or radio: played without importing it.
#[tauri::command]
pub async fn ytm_list(state: State<'_, AppState>, list: ListRef) -> CmdResult<Vec<Track>> {
    // Trust boundary: ids go into YouTube requests.
    if !list.valid() {
        return Err("Invalid list".into());
    }
    let key = list.key();
    if let Some(hit) = state.cache.lists.get(&key) {
        return Ok((*hit).clone());
    }
    // Signed out: public lists (an artist's albums and playlists) still open.
    let yt = state.ytm_or_public();
    let tracks = yt.list_tracks(&list).await.map_err(err)?;
    Ok((*state.cache.lists.put(&key, tracks)).clone())
}

/// An artist's YouTube Music page (top songs, albums, singles, playlists); None: no artist of that name there. Public
/// page: asked without the account, signed in or not.
#[tauri::command]
pub async fn ytm_artist(state: State<'_, AppState>, name: String, titles: Option<Vec<String>>) -> CmdResult<Option<Artist>> {
    // Trust boundary: free text goes into a YouTube search.
    let name = name.trim().to_string();
    if name.is_empty() || name.chars().count() > 200 {
        return Err("Invalid artist".into());
    }
    let key = name.to_lowercase();
    if let Some(hit) = state.cache.artists.get(&key) {
        return Ok((*hit).clone());
    }
    let page = public_ytm().artist(&name, &crate::song_titles(titles)).await.map_err(err)?;
    Ok((*state.cache.artists.put(&key, page)).clone())
}
