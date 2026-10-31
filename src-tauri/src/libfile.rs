//! Add music › From iTunes or MusicBee: the app's library file (`iTunes Music Library.xml`, read by
//! `music_core::itunes_xml`), its playlists ticked, then the import screen. A song the library has as a file comes as it
//! is, the rest is found on YouTube at its pace (`links::find_on_youtube`). Each list becomes a playlist of yours; songs
//! not found stay in it, listed in Songs not found.

use crate::spotify_web::{SpotifyLibraryImport, SpotifyPick, SpotifyProgress, SpotifySong};
use crate::{AppState, CmdResult, err, links, songlist};
use music_connectors::youtube;
use music_core::itunes_xml::{self, List};
use music_core::library::PlaylistEdit;
use music_core::model::Track;
use music_core::playfile::{self, Plan};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// Read, at most: a library of some 100,000 songs.
const MAX_FILE: u64 = 256 << 20;

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileList {
    id: String,
    name: String,
    songs: u32,
    /// A smart playlist: offered unticked.
    smart: bool,
}

fn read(path: &str) -> CmdResult<Vec<List>> {
    // Trust boundary: a file the user picked, bounded.
    if std::fs::metadata(path).map_err(err)?.len() > MAX_FILE {
        return Err("File too big for a library file (256 MB max)".into());
    }
    let text = String::from_utf8_lossy(&std::fs::read(path).map_err(err)?).into_owned();
    match itunes_xml::read(&text) {
        Some(lists) if !lists.is_empty() => Ok(lists),
        Some(_) => Err("No playlists in that library file".into()),
        None => Err("Not a library file: pick iTunes Music Library.xml (from iTunes, or the copy MusicBee writes for other apps)".into()),
    }
}

/// The file's playlists, to tick.
#[tauri::command]
pub async fn library_file_lists(path: String) -> CmdResult<Vec<FileList>> {
    Ok(read(&path)?.into_iter().map(|l| FileList { songs: u32::try_from(l.songs.len()).unwrap_or(u32::MAX), id: l.id, name: l.name, smart: l.smart }).collect())
}

/// A song of a list: the library's own file, or its place among the songs looked for on YouTube.
enum Slot {
    Own(i64),
    Find(usize),
}

/// A playlist of yours, the songs in the file's order.
fn save(state: &AppState, name: &str, slots: &[Slot], found: &[Track]) -> CmdResult<i64> {
    let lib = state.lib();
    let id = lib.edit_playlist(PlaylistEdit::Create { name: name.chars().take(100).collect() }).map_err(err)?.ok_or("Playlist not created")?;
    let mut ids = Vec::with_capacity(slots.len());
    for slot in slots {
        ids.push(match slot {
            Slot::Own(id) => *id,
            Slot::Find(i) => {
                // Asked for by hand: a song removed earlier comes back.
                lib.unremove(&found[*i]).map_err(err)?;
                lib.upsert_track(&found[*i]).map_err(err)?
            }
        });
    }
    lib.edit_playlist(PlaylistEdit::Add { id, track_ids: ids }).map_err(err)?;
    Ok(id)
}

#[tauri::command]
pub async fn library_file_import(app: AppHandle, state: State<'_, AppState>, path: String, picks: Vec<SpotifyPick>) -> CmdResult<SpotifyLibraryImport> {
    if picks.is_empty() || picks.len() > itunes_xml::MAX_LISTS {
        return Err("Invalid lists".into());
    }
    // The file read again: picks are ids in it.
    let picked: Vec<List> = read(&path)?.into_iter().filter(|l| picks.iter().any(|p| p.id == l.id)).collect();
    let _running = links::begin()?;
    let own = songlist::own_files(&state)?;
    let lists = picked.len();
    let mut report = SpotifyLibraryImport { playlist_id: None, lists: 0, songs: 0, playable: 0, failed: Vec::new(), unsearched: 0 };
    for (n, list) in picked.iter().enumerate() {
        if links::stopped() {
            break;
        }
        let total = list.songs.len();
        let tell = |done, playable, wait_secs, song: Option<&Track>| {
            let _ = app.emit_to("main", "spotify-import", SpotifyProgress { name: list.name.clone(), list: n + 1, lists, matching: true, done, total, all_done: 0, all_total: 0, playable, searched: 0, to_search: 0, wait_secs, song: song.map(SpotifySong::from) });
        };
        let (mut slots, mut asked) = (Vec::with_capacity(total), Vec::new());
        for e in &list.songs {
            let track = match playfile::plan(e, None, &own, youtube::video_id) {
                Some(Plan::Own(id)) => {
                    slots.push(Slot::Own(id));
                    continue;
                }
                Some(Plan::Video(t)) => t,
                Some(Plan::Search(w)) => Track { title: w.title, artist: w.artist, duration_ms: e.secs.map(|s| s.saturating_mul(1000)), ..Default::default() },
                // A link without names: not what these files hold.
                Some(Plan::Link(_)) | None => continue,
            };
            slots.push(Slot::Find(asked.len()));
            asked.push(track);
        }
        let (before, mine) = (report.playable, slots.len() - asked.len());
        tell(mine, before + mine, 0, None);
        let Some(links::Found { tracks, unsearched }) = links::find_on_youtube(&app, &asked, |step| tell(mine + step.done, before + mine + step.found, step.wait_secs, step.song)).await? else { break };
        let id = save(&state, &list.name, &slots, &tracks)?;
        report.unsearched += unsearched;
        // Saved only now, so remembered only now. YouTube's refusals left some unsearched: can't tell which.
        if unsearched == 0 {
            for song in tracks.iter().filter(|t| !links::has_version(t) && !state.lib().not_found_lately(t).unwrap_or(true)) {
                links::note_search(&state, song);
            }
        }
        report.playlist_id.get_or_insert(id);
        report.lists += 1;
        report.songs += slots.len();
        report.playable += mine + tracks.iter().filter(|t| links::has_version(t)).count();
    }
    if links::stopped() {
        return Err("canceled".into());
    }
    Ok(report)
}
