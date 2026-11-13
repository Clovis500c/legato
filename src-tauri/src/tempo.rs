//! Estimated tempo (Settings › Playback › Estimate tempo, off by default): for local songs whose tags carry none, a few
//! files at a time are decoded for their first 90 seconds (`music_player::tempo`) and the guess fills the song's empty
//! tempo (Songs' BPM column, Mixes). Never over a tag. The answers are kept by file and modified time (library setting
//! `tempoGuesses`), so a rescan that empties the field gets it back without decoding again.

use crate::{AppState, CmdResult, err};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::UNIX_EPOCH;
use tauri::State;

const KEY: &str = "tempoGuesses";
/// Answers kept at most (path → modified, tempo; 0 = no beat found).
const KEEP: usize = 50_000;

type Guesses = BTreeMap<String, (i64, u32)>;
/// A song to fill now (id, tempo), and one to decode (id, file, modified).
type Split = (Vec<(i64, u32)>, Vec<(i64, String, i64)>);

fn modified(path: &str) -> Option<i64> {
    Some(std::fs::metadata(Path::new(path)).ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis() as i64)
}

/// One file's tempo, 0 when none. A decoder that panics on a broken file counts as no beat: kept as such, the scan
/// moves past it instead of failing on it every time.
fn tempo_of(detect: impl FnOnce() -> anyhow::Result<Option<u32>>) -> u32 {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(detect)).ok().and_then(|r| r.ok().flatten()).unwrap_or(0)
}

/// Songs with a kept answer (to fill now) and those still to decode (id, file, modified).
fn split(files: Vec<(i64, String)>, kept: &Guesses, modified: impl Fn(&str) -> Option<i64>) -> Split {
    let (mut fill, mut todo) = (Vec::new(), Vec::new());
    for (id, path) in files {
        let Some(m) = modified(&path) else { continue };
        match kept.get(&path) {
            Some(&(at, bpm)) if at == m => {
                if bpm > 0 {
                    fill.push((id, bpm));
                }
            }
            _ => todo.push((id, path, m)),
        }
    }
    (fill, todo)
}

/// The answers, read from the library once and kept here: a call writes them back only now and then (they can run to
/// a few megabytes, and a call comes every 15 seconds while songs wait).
static KEPT: Mutex<Option<Guesses>> = Mutex::new(None);
static CALLS: AtomicUsize = AtomicUsize::new(0);
/// Calls between two writes (the last call of a run always writes).
const WRITE_EVERY: usize = 10;

fn kept() -> MutexGuard<'static, Option<Guesses>> {
    KEPT.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Fills what is known, then decodes up to `limit` files. Returns how many are still waiting.
#[tauri::command]
pub async fn tempo_scan(state: State<'_, AppState>, limit: usize) -> CmdResult<usize> {
    let files = state.lib().untimed_local().map_err(err)?;
    let (fill, todo) = {
        let mut k = kept();
        let all = k.get_or_insert_with(|| state.lib().setting(KEY).ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default());
        split(files, all, modified)
    };
    {
        let lib = state.lib();
        for (id, bpm) in fill {
            lib.guess_tempo(id, bpm).map_err(err)?;
        }
    }
    let take = limit.min(5);
    let left = todo.len().saturating_sub(take);
    let batch: Vec<_> = todo.into_iter().take(take).collect();
    let found = tauri::async_runtime::spawn_blocking(move || batch.into_iter().map(|(id, path, m)| (id, tempo_of(|| music_player::tempo::detect(Path::new(&path))), path, m)).collect::<Vec<_>>())
        .await
        .map_err(err)?;
    let changed = !found.is_empty();
    {
        // The same order as above (answers, then library): two calls at once can't lock each other out.
        let mut k = kept();
        let lib = state.lib();
        let all = k.get_or_insert_with(Guesses::new);
        for (id, bpm, path, m) in found {
            if bpm > 0 {
                lib.guess_tempo(id, bpm).map_err(err)?;
            }
            all.insert(path, (m, bpm));
        }
        while all.len() > KEEP {
            all.pop_first();
        }
        if changed && (left == 0 || CALLS.fetch_add(1, Ordering::Relaxed) % WRITE_EVERY == WRITE_EVERY - 1) {
            lib.set_setting(KEY, &serde_json::to_value(&*all).map_err(err)?).map_err(err)?;
        }
    }
    Ok(left)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_that_breaks_the_decoder_is_no_beat() {
        assert_eq!(tempo_of(|| panic!("bad frame")), 0);
        assert_eq!(tempo_of(|| anyhow::bail!("unreadable")), 0);
        assert_eq!(tempo_of(|| Ok(Some(128))), 128);
    }

    #[test]
    fn kept_answers_fill_and_changed_or_new_files_wait() {
        let kept: Guesses = [("a".to_string(), (5, 120)), ("b".to_string(), (5, 0)), ("c".to_string(), (4, 100))].into();
        let files = vec![(1, "a".to_string()), (2, "b".to_string()), (3, "c".to_string()), (4, "d".to_string()), (5, "gone".to_string())];
        let (fill, todo) = split(files, &kept, |p| (p != "gone").then_some(5));
        assert_eq!(fill, vec![(1, 120)]);
        // `b` had no beat (kept as such, not decoded again); `c` changed; `d` is new; `gone` can't be read.
        assert_eq!(todo, vec![(3, "c".to_string(), 5), (4, "d".to_string(), 5)]);
    }
}
