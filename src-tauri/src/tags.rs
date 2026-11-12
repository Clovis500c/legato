//! Edit song info (right-click on local files, one song or several): their tags rewritten (title, artist, album, album
//! artist, genre, year, track and disc numbers, front cover), their library rows following. A song's lyrics too (Now
//! Playing › Lyrics). Other services' songs aren't files of the user's: not offered.

use crate::{AppState, CmdResult, err};
use music_core::local::{FileTags, TagEdit, file_tags, read_song, write_tags};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

/// Songs edited at once, at most (a box set; whole folders change in their own app).
const MAX_SONGS: usize = 5_000;

#[derive(Debug, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "SongTags")]
pub struct Tags {
    /// None = as it is (several songs: only what the user changed comes); empty text or 0 = taken off.
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    album_artist: Option<String>,
    genre: Option<String>,
    year: Option<u32>,
    track: Option<u32>,
    disc: Option<u32>,
    bpm: Option<u32>,
    key: Option<String>,
    /// Numbered 1, 2, 3… in the order given, their count as the total.
    #[serde(default)]
    number: bool,
    /// Picture file picked for the new front cover.
    cover_path: Option<String>,
    #[serde(default)]
    remove_cover: bool,
}

/// What came of an edit: songs saved, the files not written and why the first one wasn't.
#[derive(Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "TagsSaved")]
pub struct Saved {
    saved: u32,
    failed: Vec<String>,
    reason: Option<String>,
}

/// Each song's file, in the order asked. Refused unless every one is a local file.
fn files(state: &AppState, track_ids: &[i64]) -> Result<Vec<PathBuf>, String> {
    if track_ids.is_empty() || track_ids.len() > MAX_SONGS {
        return Err(format!("1 to {MAX_SONGS} songs at a time"));
    }
    let lib = state.lib();
    track_ids.iter().map(|&id| lib.local_path(id).map_err(err)?.map(PathBuf::from).ok_or_else(|| "Only your own music files can be edited".to_string())).collect()
}

/// The chapters of a book in the library (an `.m4b`, `.m4a` or `.mp4` file of this PC); none for any other song. Reads the file's
/// header boxes only.
#[tauri::command]
pub async fn track_chapters(state: State<'_, AppState>, track_id: i64) -> CmdResult<Vec<music_core::chapters::Chapter>> {
    let Some(path) = state.lib().local_path(track_id).map_err(err)?.map(PathBuf::from) else { return Ok(Vec::new()) };
    if !path.extension().and_then(|e| e.to_str()).is_some_and(|e| ["m4b", "m4a", "mp4"].iter().any(|k| e.eq_ignore_ascii_case(k))) {
        return Ok(Vec::new());
    }
    tauri::async_runtime::spawn_blocking(move || Ok(std::fs::File::open(path).map(|f| music_core::chapters::read_chapters(&mut std::io::BufReader::new(f))).unwrap_or_default())).await.map_err(err)?
}

/// What Edit song info starts from: each song's tags, in the order asked.
#[tauri::command]
pub async fn read_tags(state: State<'_, AppState>, track_ids: Vec<i64>) -> CmdResult<Vec<FileTags>> {
    let files = files(&state, &track_ids)?;
    tauri::async_runtime::spawn_blocking(move || files.iter().map(|f| file_tags(f)).collect()).await.map_err(err)
}

#[tauri::command]
pub async fn edit_tags(state: State<'_, AppState>, track_ids: Vec<i64>, tags: Tags) -> CmdResult<Saved> {
    // Trust boundary: text that goes into the files and the library, bounded; numbers bounded; a picture file, bounded.
    let text = |v: Option<String>| v.map(|s| s.trim().to_string());
    let (title, artist) = (text(tags.title), text(tags.artist));
    let (album, album_artist, genre) = (text(tags.album), text(tags.album_artist), text(tags.genre));
    let key = text(tags.key);
    if key.as_deref().is_some_and(|k| k.chars().count() > 12) || tags.bpm.is_some_and(|b| b != 0 && !(30..=400).contains(&b)) {
        return Err("A tempo is 30 to 400 BPM, a key 12 characters at most".into());
    }
    if [&title, &artist, &album, &album_artist, &genre].iter().any(|v| v.as_deref().is_some_and(|s| s.chars().count() > 500)) {
        return Err("500 characters at most".into());
    }
    if [&title, &artist].iter().any(|v| v.as_deref() == Some("")) {
        return Err("A title and an artist are needed".into());
    }
    if [tags.year, tags.track, tags.disc].iter().flatten().any(|n| *n > 9999) {
        return Err("Numbers go up to 9999".into());
    }
    let files = files(&state, &track_ids)?;
    let cover = match &tags.cover_path {
        Some(p) if std::fs::metadata(p).map_err(err)?.len() > music_core::themefile::MAX_IMAGE as u64 => return Err("Picture too big (15 MB max)".into()),
        Some(p) => Some(std::fs::read(p).map_err(err)?),
        None => None,
    };
    let mut edit = TagEdit { title, artist, album, album_artist, genre, year: tags.year, track: tags.track, track_total: None, disc: tags.disc, bpm: tags.bpm, key, cover, remove_cover: tags.remove_cover };
    let (count, number) = (files.len() as u32, tags.number);
    // Each file read back as the scan would read it: its library row follows what the file now says.
    let done = tauri::async_runtime::spawn_blocking(move || {
        let mut done = Vec::with_capacity(files.len());
        for (i, file) in files.into_iter().enumerate() {
            if number {
                (edit.track, edit.track_total) = (Some(i as u32 + 1), Some(count));
            }
            let written = write_tags(&file, &edit).map(|()| read_song(&file));
            done.push((file, written));
        }
        done
    })
    .await
    .map_err(err)?;
    let lib = state.lib();
    let mut out = Saved { saved: 0, failed: Vec::new(), reason: None };
    for (&id, (file, written)) in track_ids.iter().zip(done) {
        match written {
            Ok(s) => {
                let t = &s.track;
                lib.set_details(id, &t.title, &t.artist, t.album.as_deref()).map_err(err)?;
                lib.set_genre_year(id, s.genre.as_deref(), s.year).map_err(err)?;
                lib.set_tempo_key(id, s.bpm, s.key.as_deref()).map_err(err)?;
                out.saved += 1;
            }
            Err(e) => {
                out.reason.get_or_insert_with(|| e.to_string());
                out.failed.push(file.file_name().map_or_else(|| file.to_string_lossy(), |n| n.to_string_lossy()).into_owned());
            }
        }
    }
    Ok(out)
}

/// Edit song info › Look up on MusicBrainz (one click, one request): the releases the song is on, to pick from. Only its
/// title and artist leave the PC; nothing is written until the user saves.
#[tauri::command]
pub async fn song_releases(title: String, artist: String, album: String, duration_ms: Option<u64>) -> CmdResult<Vec<music_connectors::musicbrainz::SongRelease>> {
    music_connectors::musicbrainz::MusicBrainz::default().song_releases(&title, &artist, &album, duration_ms).await.map_err(err)
}

/// Now Playing › Lyrics › Edit lyrics, or the timing fixed: the text (LRC or plain) saved into the song's own file.
#[tauri::command]
pub async fn write_lyrics(state: State<'_, AppState>, track_id: i64, text: String) -> CmdResult<()> {
    // Trust boundary: text into the file, bounded.
    let text = text.trim().to_string();
    if text.is_empty() || text.len() > music_core::local::LYRICS_MAX {
        return Err("Lyrics are needed (256 kB at most)".into());
    }
    let path = state.lib().local_path(track_id).map_err(err)?.ok_or("Only your own music files can be edited")?;
    let file = PathBuf::from(path);
    tauri::async_runtime::spawn_blocking(move || music_core::local::write_lyrics(&file, &text)).await.map_err(err)?.map_err(err)
}
