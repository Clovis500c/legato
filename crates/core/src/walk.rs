//! A walk between two artists (Plexamp's "Sonic Adventure", from what is in the library): the artists you listen to
//! together (same session, same playlist) make a graph; the strongest chain of such links from one artist to the other
//! is the path, and a few of each artist's best songs on the way make the list. No sound analysis: the links are yours.

use crate::history::{Play, Pref};
use crate::library::LibraryTrack;
use crate::matching::{first_artist, normalize, primary_artist};
use crate::mixes::{decay, play_weight, song_key, Input};
use crate::musicness::Musicness;
use serde::Serialize;
use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet, BinaryHeap, HashMap, HashSet};

/// Plays this close are one listening session.
const SESSION_GAP: i64 = 30 * 60;
/// Groups bigger than this only link their first artists (pairs grow quadratically).
const GROUP_CAP: usize = 60;
/// Songs taken from each artist on the way.
const PER_ARTIST: usize = 3;
/// Most artists in a walk: a longer chain is not a walk but a tour of the library.
const MAX_STEPS: usize = 12;

#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ArtistPath {
    /// The artists on the way, as written, from the first to the last.
    pub artists: Vec<String>,
    /// Library songs, artist after artist.
    pub track_ids: Vec<i64>,
}

/// The library artist a typed name means: the same name once folded, else the shortest name that contains it.
fn find(names: &BTreeMap<String, String>, typed: &str) -> Option<String> {
    let key = primary_artist(typed);
    if names.contains_key(&key) {
        return Some(key);
    }
    let folded = normalize(typed);
    if folded.is_empty() {
        return None;
    }
    names.keys().filter(|k| k.contains(&folded)).min_by_key(|k| (k.len(), (*k).clone())).cloned()
}

fn link(edges: &mut BTreeMap<(String, String), f64>, group: BTreeSet<&str>) {
    let v: Vec<&str> = group.into_iter().take(GROUP_CAP).collect();
    for (i, a) in v.iter().enumerate() {
        for b in &v[i + 1..] {
            *edges.entry((a.to_string(), b.to_string())).or_default() += 1.0;
        }
    }
}

/// The walk from `from` to `to` (typed names), None when an artist is not in the library, they are the same one, no
/// chain of listened-together artists joins them, or it is longer than MAX_STEPS.
pub fn artist_path(input: &Input, from: &str, to: &str) -> Option<ArtistPath> {
    let tracks: Vec<&LibraryTrack> = input.tracks.iter().filter(|t| t.track.musicness != Some(Musicness::NotMusic)).collect();
    let mut artist: HashMap<i64, String> = HashMap::new();
    let mut song: HashMap<i64, String> = HashMap::new();
    let mut names: BTreeMap<String, String> = BTreeMap::new();
    for t in &tracks {
        let (key, s) = song_key(&t.track);
        names.entry(key.clone()).or_insert_with(|| first_artist(&t.track.artist).to_string());
        artist.insert(t.id, key);
        song.insert(t.id, s);
    }
    let (a, b) = (find(&names, from)?, find(&names, to)?);
    if a == b {
        return None;
    }

    let length: HashMap<i64, u32> = tracks.iter().filter_map(|t| Some((t.id, t.track.duration_ms?))).collect();
    let mut score: HashMap<i64, f64> = HashMap::new();
    let mut edges: BTreeMap<(String, String), f64> = BTreeMap::new();
    let (mut session, mut last): (BTreeSet<&str>, Option<i64>) = (BTreeSet::new(), None);
    let plays: Vec<&Play> = input.plays.iter().filter(|p| artist.contains_key(&p.track_id)).collect();
    for p in plays.iter().filter(|p| play_weight(p, length.get(&p.track_id).copied()) > 0.0) {
        *score.entry(p.track_id).or_default() += play_weight(p, length.get(&p.track_id).copied()) * decay(input.now - p.started_at);
        if last.is_some_and(|l| p.started_at - l > SESSION_GAP) {
            link(&mut edges, std::mem::take(&mut session));
        }
        session.insert(artist[&p.track_id].as_str());
        last = Some(p.started_at);
    }
    link(&mut edges, session);
    for list in input.playlists.iter().chain(input.saved) {
        link(&mut edges, list.iter().filter_map(|id| artist.get(id).map(String::as_str)).collect());
        for id in list {
            if song.contains_key(id) {
                *score.entry(*id).or_default() += 1.0;
            }
        }
    }
    for id in input.liked {
        if song.contains_key(id) {
            *score.entry(*id).or_default() += 2.0;
        }
    }

    // Dijkstra: a strong link is a short one.
    let mut next: HashMap<&str, Vec<(&str, u64)>> = HashMap::new();
    for ((x, y), w) in &edges {
        let cost = (1_000_000.0 / w) as u64;
        next.entry(x).or_default().push((y, cost));
        next.entry(y).or_default().push((x, cost));
    }
    let mut dist: HashMap<&str, (u64, &str)> = HashMap::from([(a.as_str(), (0, ""))]);
    let mut heap = BinaryHeap::from([Reverse((0u64, a.as_str()))]);
    while let Some(Reverse((d, at))) = heap.pop() {
        if at == b || dist.get(at).is_some_and(|(best, _)| d > *best) {
            continue;
        }
        for &(to, cost) in next.get(at).into_iter().flatten() {
            let nd = d + cost;
            if dist.get(to).is_none_or(|(best, _)| nd < *best) {
                dist.insert(to, (nd, at));
                heap.push(Reverse((nd, to)));
            }
        }
    }
    dist.get(b.as_str())?;
    let mut path = vec![b.as_str()];
    while let Some((_, from)) = dist.get(path[path.len() - 1]).filter(|(_, f)| !f.is_empty()) {
        path.push(from);
    }
    path.reverse();
    if path.len() > MAX_STEPS {
        return None;
    }

    let mut track_ids = Vec::new();
    for key in &path {
        let mut seen = HashSet::new();
        let mut mine: Vec<&&LibraryTrack> = tracks.iter().filter(|t| artist[&t.id] == *key && input.prefs.get(&t.id) != Some(&Pref::Never)).collect();
        mine.sort_by(|x, y| score.get(&y.id).unwrap_or(&0.0).total_cmp(score.get(&x.id).unwrap_or(&0.0)).then(x.id.cmp(&y.id)));
        track_ids.extend(mine.into_iter().filter(|t| seen.insert(&song[&t.id])).take(PER_ARTIST).map(|t| t.id));
    }
    Some(ArtistPath { artists: path.iter().map(|k| names[*k].clone()).collect(), track_ids })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Track;

    const NOW: i64 = 1_800_000_000;

    fn t(id: i64, artist: &str) -> LibraryTrack {
        LibraryTrack { id, added: id, added_at: None, genre: None, year: None, bpm: None, key: None, track: Track { title: format!("Song {id}"), artist: artist.into(), ..Default::default() } }
    }

    /// Alpha and Bravo heard together, Bravo and Charlie too, Delta alone: Alpha → Charlie goes through Bravo.
    fn library() -> (Vec<LibraryTrack>, Vec<Play>) {
        let artists = ["Alpha", "Alpha", "Bravo", "Bravo", "Charlie", "Charlie", "Delta"];
        let tracks = artists.iter().enumerate().map(|(i, a)| t(i as i64 + 1, a)).collect();
        let play = |id: i64, day: i64| Play { track_id: id, started_at: NOW - day * 86_400 + id * 240, listened_ms: 200_000, completed: true };
        let plays = vec![play(7, 9), play(1, 5), play(3, 5), play(4, 3), play(5, 3)];
        (tracks, plays)
    }

    fn input<'a>(tracks: &'a [LibraryTrack], plays: &'a [Play], prefs: &'a HashMap<i64, Pref>) -> Input<'a> {
        Input { tracks, plays, playlists: &[], saved: &[], liked: &[], prefs, now: NOW, utc_offset: 0, seed: 1, found: &[] }
    }

    #[test]
    fn walks_through_the_artist_heard_between() {
        let (tracks, plays) = library();
        let prefs = HashMap::new();
        let walk = artist_path(&input(&tracks, &plays, &prefs), "alpha", "Charlie").unwrap();
        assert_eq!(walk.artists, ["Alpha", "Bravo", "Charlie"]);
        // Each artist's songs, in turn, the ones heard more recently first.
        assert_eq!(walk.track_ids, [1, 2, 4, 3, 5, 6]);
        // A partial name finds the artist; the other way round is the same walk reversed.
        let back = artist_path(&input(&tracks, &plays, &prefs), "Char", "Alpha").unwrap();
        assert_eq!(back.artists, ["Charlie", "Bravo", "Alpha"]);
    }

    #[test]
    fn no_walk_when_nothing_joins_them_or_a_name_is_unknown() {
        let (tracks, plays) = library();
        let prefs = HashMap::new();
        let i = input(&tracks, &plays, &prefs);
        assert_eq!(artist_path(&i, "Alpha", "Delta"), None);
        assert_eq!(artist_path(&i, "Alpha", "Nobody"), None);
        assert_eq!(artist_path(&i, "Alpha", "alpha"), None);
        assert_eq!(artist_path(&i, "", "Alpha"), None);
    }

    #[test]
    fn songs_said_never_stay_out_and_the_stronger_chain_wins() {
        let (mut tracks, mut plays) = library();
        // A second way Alpha → Charlie through Echo, met once only.
        tracks.push(t(8, "Echo"));
        plays.extend([Play { track_id: 1, started_at: NOW - 20 * 86_400, listened_ms: 200_000, completed: true }, Play { track_id: 8, started_at: NOW - 20 * 86_400 + 240, listened_ms: 200_000, completed: true }, Play { track_id: 5, started_at: NOW - 30 * 86_400, listened_ms: 200_000, completed: true }, Play { track_id: 8, started_at: NOW - 30 * 86_400 + 240, listened_ms: 200_000, completed: true }]);
        plays.sort_by_key(|p| p.started_at);
        let prefs = HashMap::from([(3, Pref::Never)]);
        let walk = artist_path(&input(&tracks, &plays, &prefs), "Alpha", "Charlie").unwrap();
        assert_eq!(walk.artists, ["Alpha", "Bravo", "Charlie"]);
        assert_eq!(walk.track_ids, [1, 2, 4, 5, 6]);
    }
}
