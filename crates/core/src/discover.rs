//! Home's "New from your artists": whose releases to look for, and since when. Pure; the lookups are the shell's
//! (`src-tauri/src/discover.rs`, MusicBrainz).

use crate::diag::civil;
use crate::matching::first_artist;
use std::collections::HashMap;

/// Artists asked about at each refresh: one request each, a second apart.
pub const ARTISTS: usize = 10;
/// How far back a release still counts as new.
pub const DAYS: i64 = 60;

/// A unix time's day, `YYYY-MM-DD` (UTC).
pub fn day(unix_s: i64) -> String {
    let (y, m, d) = civil(unix_s.div_euclid(86_400));
    format!("{y:04}-{m:02}-{d:02}")
}

/// The `n` artists listened to most, from each song's artist and listens: the first credited artist, as first
/// written, songs never played and untagged ones aside; most listens first, then by name.
pub fn top_artists<'a>(songs: impl IntoIterator<Item = (&'a str, u32)>, n: usize) -> Vec<String> {
    let mut by: HashMap<String, (String, u32)> = HashMap::new();
    for (artist, listens) in songs {
        let name = first_artist(artist);
        if listens == 0 || name.is_empty() || name == "Unknown artist" {
            continue;
        }
        by.entry(name.to_lowercase()).or_insert_with(|| (name.to_string(), 0)).1 += listens;
    }
    let mut all: Vec<(String, u32)> = by.into_values().collect();
    all.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    all.into_iter().take(n).map(|(name, _)| name).collect()
}

/// Last.fm's Discoveries: artists the library does not have, from the lists of artists close to each favourite (`lists`, each
/// closest first). The ones close to the most favourites first, then the closest; a name counts once, however it is written
/// (`primary_artist`). `known`: every artist of the library. At most `n`.
pub fn fresh_artists<'a>(lists: &[Vec<String>], known: impl IntoIterator<Item = &'a str>, n: usize) -> Vec<String> {
    let known: std::collections::HashSet<String> = known.into_iter().map(crate::matching::primary_artist).collect();
    let mut seen: HashMap<String, (String, usize, usize)> = HashMap::new();
    for list in lists {
        for (rank, name) in list.iter().enumerate() {
            let key = crate::matching::primary_artist(name);
            if key.is_empty() || known.contains(&key) {
                continue;
            }
            let e = seen.entry(key).or_insert_with(|| (name.clone(), 0, rank));
            e.1 += 1;
            e.2 = e.2.min(rank);
        }
    }
    let mut all: Vec<(String, usize, usize)> = seen.into_values().collect();
    all.sort_by(|a, b| b.1.cmp(&a.1).then(a.2.cmp(&b.2)).then(a.0.cmp(&b.0)));
    all.into_iter().take(n).map(|(name, _, _)| name).collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn discoveries_skip_what_the_library_has_and_rank_by_how_many_favourites_name_them() {
        let lists = vec![vec!["Own".to_string(), "Both".into(), "Solo A".into()], vec!["Both".into(), "solo b".into(), "OWN".into()]];
        let got = super::fresh_artists(&lists, ["Own", "Other"], 2);
        assert_eq!(got, ["Both", "solo b"]);
        assert!(super::fresh_artists(&[], ["x"], 5).is_empty());
    }

    use super::*;

    #[test]
    fn days_are_utc_dates() {
        assert_eq!(day(0), "1970-01-01");
        assert_eq!(day(1_794_355_200), "2026-11-11");
        assert_eq!(day(1_794_355_200 - DAYS * 86_400), "2026-09-12");
    }

    #[test]
    fn top_artists_count_listens_by_first_artist() {
        let songs = [("Daft Punk, Pharrell Williams", 3), ("daft punk", 2), ("M83", 4), ("Unknown artist", 99), ("Never Played", 0), ("Air", 4)];
        assert_eq!(top_artists(songs, 2), ["Daft Punk", "Air"]);
        assert_eq!(top_artists(songs, 10), ["Daft Punk", "Air", "M83"]);
        assert!(top_artists([], 5).is_empty());
    }
}
