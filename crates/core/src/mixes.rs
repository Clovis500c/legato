//! Personalized mixes, computed locally from listening history + custom playlists. Pure: same input and seed = same mixes.
//! Track score = Σ play weight × decay (half-life 30 days) + bonus when in a custom playlist.
//! Daily mixes = artist clusters (label propagation on "listened in the same session / same playlist" graph).

use crate::history::{Play, Pref};
use crate::library::LibraryTrack;
use crate::matching::{first_artist, primary_artist};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

const DAY: i64 = 86_400;
const HALF_LIFE_DAYS: f64 = 30.0;
/// Under this = skipped (negative signal).
const SKIP_MS: u32 = 30_000;
const SESSION_GAP: i64 = 30 * 60;
const PLAYLIST_BONUS: f64 = 1.5;
const LESS: f64 = 0.3;
/// Skipped again and again: left out.
const FLOOR: f64 = -1.0;
const MIX_LEN: usize = 25;
const MIN_LEN: usize = 5;
const PER_ARTIST: usize = 4;
const DAILY_MIXES: usize = 6;
const REDISCOVER_AFTER: i64 = 60 * DAY;
/// Groups bigger than this only link their first artists (pairs grow quadratically).
const GROUP_CAP: usize = 60;

pub struct Input<'a> {
    pub tracks: &'a [LibraryTrack],
    /// Oldest first.
    pub plays: &'a [Play],
    pub playlists: &'a [Vec<i64>],
    pub prefs: &'a HashMap<i64, Pref>,
    /// Unix seconds.
    pub now: i64,
    /// Local time minus UTC, seconds (time-of-day mix).
    pub utc_offset: i64,
    /// Changes daily: small variation in picks, same day = same mixes.
    pub seed: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mix {
    pub id: String,
    pub title: String,
    /// Shown under the title: why these tracks.
    pub reason: String,
    pub track_ids: Vec<i64>,
}

/// Full listen > partial > skip (negative).
pub fn play_weight(p: &Play) -> f64 {
    if p.completed {
        1.0
    } else if p.listened_ms >= SKIP_MS {
        0.5
    } else {
        -0.7
    }
}

/// Halves every 30 days.
pub fn decay(age_s: i64) -> f64 {
    0.5f64.powf(age_s.max(0) as f64 / DAY as f64 / HALF_LIFE_DAYS)
}

/// splitmix64 → [0, 1). Deterministic per (seed, id).
fn noise(seed: u64, id: i64) -> f64 {
    let mut z = seed ^ (id as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
}

fn slot(hour: i64) -> &'static str {
    match hour {
        5..=11 => "morning",
        12..=17 => "afternoon",
        18..=22 => "evening",
        _ => "night",
    }
}

fn names(list: &[&str]) -> String {
    match list {
        [] => String::new(),
        [a] => a.to_string(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

struct Taste<'a> {
    input: &'a Input<'a>,
    /// Track id → artist key (normalized first artist).
    artist: HashMap<i64, String>,
    /// Artist key → name as written.
    display: HashMap<String, String>,
    score: HashMap<i64, f64>,
}

impl Taste<'_> {
    fn allowed(&self, id: i64) -> bool {
        self.input.prefs.get(&id) != Some(&Pref::Never) && self.score.get(&id).is_none_or(|s| *s > FLOOR)
    }

    /// Rank by score (Less dampened, + a little daily noise), then spread artists out.
    fn pick(&self, candidates: impl Iterator<Item = (i64, f64)>) -> Vec<i64> {
        let less = |id: i64, s: f64| if s > 0.0 && self.input.prefs.get(&id) == Some(&Pref::Less) { s * LESS } else { s };
        let mut ranked: Vec<(i64, f64)> = candidates.filter(|(id, _)| self.allowed(*id)).map(|(id, s)| (id, less(id, s) + 0.3 * noise(self.input.seed, id))).collect();
        ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        self.diversify(&ranked.into_iter().map(|(id, _)| id).collect::<Vec<_>>())
    }

    /// Best first, capped per artist, never the same artist twice in a row unless nothing else is left.
    fn diversify(&self, ranked: &[i64]) -> Vec<i64> {
        let distinct = ranked.iter().map(|id| &self.artist[id]).collect::<HashSet<_>>().len().max(1);
        let cap = PER_ARTIST.max(MIX_LEN.div_ceil(distinct));
        let mut left = ranked.to_vec();
        let mut count: HashMap<&str, usize> = HashMap::new();
        let mut out: Vec<i64> = Vec::new();
        while out.len() < MIX_LEN {
            let prev = out.last().map(|id| self.artist[id].as_str());
            let room = |id: &i64| count.get(self.artist[id].as_str()).copied().unwrap_or(0) < cap;
            let Some(pos) = left.iter().position(|id| room(id) && Some(self.artist[id].as_str()) != prev).or_else(|| left.iter().position(room)) else { break };
            let id = left.remove(pos);
            *count.entry(self.artist[&id].as_str()).or_default() += 1;
            out.push(id);
        }
        out
    }
}

/// Label propagation: each artist takes the label weighing most among its neighbours. Visit order from seed.
fn clusters(nodes: &[String], edges: &BTreeMap<(String, String), f64>, seed: u64) -> Vec<Vec<String>> {
    let idx: HashMap<&str, usize> = nodes.iter().enumerate().map(|(i, n)| (n.as_str(), i)).collect();
    let mut adj = vec![Vec::new(); nodes.len()];
    for ((a, b), w) in edges {
        if let (Some(&i), Some(&j)) = (idx.get(a.as_str()), idx.get(b.as_str())) {
            adj[i].push((j, *w));
            adj[j].push((i, *w));
        }
    }
    let mut label: Vec<usize> = (0..nodes.len()).collect();
    let mut order = label.clone();
    order.sort_by(|a, b| noise(seed, *a as i64).total_cmp(&noise(seed, *b as i64)));
    for _ in 0..20 {
        let mut changed = false;
        for &i in &order {
            let mut votes: BTreeMap<usize, f64> = BTreeMap::new();
            for &(j, w) in &adj[i] {
                *votes.entry(label[j]).or_default() += w;
            }
            // Ties: smallest label wins.
            if let Some((&best, _)) = votes.iter().max_by(|a, b| a.1.total_cmp(b.1).then(b.0.cmp(a.0)))
                && best != label[i]
            {
                label[i] = best;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    let mut groups: BTreeMap<usize, Vec<String>> = BTreeMap::new();
    for (i, l) in label.into_iter().enumerate() {
        groups.entry(l).or_default().push(nodes[i].clone());
    }
    groups.into_values().collect()
}

pub fn mixes(input: &Input) -> Vec<Mix> {
    let mut artist = HashMap::new();
    let mut display = HashMap::new();
    for t in input.tracks {
        let key = primary_artist(&t.track.artist);
        display.entry(key.clone()).or_insert_with(|| first_artist(&t.track.artist).to_string());
        artist.insert(t.id, key);
    }
    let plays: Vec<&Play> = input.plays.iter().filter(|p| artist.contains_key(&p.track_id)).collect();

    let mut score: HashMap<i64, f64> = HashMap::new();
    for p in &plays {
        *score.entry(p.track_id).or_default() += play_weight(p) * decay(input.now - p.started_at);
    }
    for id in input.playlists.iter().flatten().collect::<HashSet<_>>() {
        if artist.contains_key(id) {
            *score.entry(*id).or_default() += PLAYLIST_BONUS;
        }
    }
    let taste = Taste { input, artist, display, score };

    let mut affinity: BTreeMap<&str, f64> = BTreeMap::new();
    for (id, s) in &taste.score {
        if *s > 0.0 {
            *affinity.entry(taste.artist[id].as_str()).or_default() += s;
        }
    }

    // Artist graph: listened in the same session, or picked into the same playlist.
    let mut edges: BTreeMap<(String, String), f64> = BTreeMap::new();
    let mut link = |group: BTreeSet<&str>| {
        let v: Vec<&str> = group.into_iter().take(GROUP_CAP).collect();
        for i in 0..v.len() {
            for j in i + 1..v.len() {
                *edges.entry((v[i].to_string(), v[j].to_string())).or_default() += 1.0;
            }
        }
    };
    let mut session = BTreeSet::new();
    let mut last: Option<i64> = None;
    for p in plays.iter().filter(|p| play_weight(p) > 0.0) {
        if last.is_some_and(|l| p.started_at - l > SESSION_GAP) {
            link(std::mem::take(&mut session));
        }
        session.insert(taste.artist[&p.track_id].as_str());
        last = Some(p.started_at);
    }
    link(session);
    for pl in input.playlists {
        link(pl.iter().filter_map(|id| taste.artist.get(id).map(String::as_str)).collect());
    }

    let nodes: Vec<String> = affinity.keys().map(|a| a.to_string()).collect();
    let mut groups: Vec<(f64, Vec<String>)> = clusters(&nodes, &edges, input.seed).into_iter().map(|g| (g.iter().map(|a| affinity[a.as_str()]).sum(), g)).collect();
    groups.sort_by(|a, b| b.0.total_cmp(&a.0));

    let by_artists = |set: &HashSet<&str>| -> Vec<i64> {
        taste.pick(input.tracks.iter().filter(|t| set.contains(taste.artist[&t.id].as_str())).map(|t| (t.id, taste.score.get(&t.id).copied().unwrap_or(0.0))))
    };
    let reason = |artists: &[String]| {
        let mut top: Vec<&String> = artists.iter().collect();
        top.sort_by(|a, b| affinity[b.as_str()].total_cmp(&affinity[a.as_str()]));
        let shown: Vec<&str> = top.iter().take(3).map(|a| taste.display[a.as_str()].as_str()).collect();
        format!("Because you listen to {}", names(&shown))
    };

    let mut out = Vec::new();

    // Time of day: what you play in this slot.
    let local_hour = |t: i64| (t + input.utc_offset).rem_euclid(DAY) / 3600;
    let now_slot = slot(local_hour(input.now));
    let mut in_slot: HashMap<i64, f64> = HashMap::new();
    for p in plays.iter().filter(|p| slot(local_hour(p.started_at)) == now_slot && play_weight(p) > 0.0) {
        *in_slot.entry(p.track_id).or_default() += play_weight(p) * decay(input.now - p.started_at);
    }
    let ids = taste.pick(in_slot.into_iter());
    if ids.len() >= MIN_LEN {
        let when = if now_slot == "night" { "at night".to_string() } else { format!("in the {now_slot}") };
        out.push(Mix { id: "now".into(), title: format!("Your {now_slot}s"), reason: format!("What you usually play {when}"), track_ids: ids });
    }

    let mut daily: Vec<(Vec<String>, Vec<i64>)> = Vec::new();
    let mut leftovers: Vec<String> = Vec::new();
    for (_, g) in groups {
        if daily.len() == DAILY_MIXES {
            break;
        }
        let ids = by_artists(&g.iter().map(String::as_str).collect());
        if ids.len() >= MIN_LEN { daily.push((g, ids)) } else { leftovers.extend(g) }
    }
    if daily.len() < DAILY_MIXES && !leftovers.is_empty() {
        let ids = by_artists(&leftovers.iter().map(String::as_str).collect());
        if ids.len() >= MIN_LEN {
            daily.push((leftovers, ids));
        }
    }
    for (i, (g, ids)) in daily.into_iter().enumerate() {
        out.push(Mix { id: format!("daily-{}", i + 1), title: format!("Daily Mix {}", i + 1), reason: reason(&g), track_ids: ids });
    }

    // Rediscover: loved before (2+ full listens' worth), silent for 60 days.
    let mut past: HashMap<i64, f64> = HashMap::new();
    let mut last_play: HashMap<i64, i64> = HashMap::new();
    for p in &plays {
        *past.entry(p.track_id).or_default() += play_weight(p);
        last_play.insert(p.track_id, p.started_at);
    }
    let ids = taste.pick(past.into_iter().filter(|(id, s)| *s >= 2.0 && input.now - last_play[id] > REDISCOVER_AFTER));
    if ids.len() >= MIN_LEN {
        out.push(Mix { id: "rediscover".into(), title: "Rediscover".into(), reason: "Tracks you loved, not played for two months".into(), track_ids: ids });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Track;

    const NOW: i64 = 1_800_000_000;

    fn t(id: i64, artist: &str) -> LibraryTrack {
        LibraryTrack { id, added: id, track: Track { title: format!("Song {id}"), artist: artist.into(), ..Default::default() } }
    }

    fn play(id: i64, at: i64, completed: bool) -> Play {
        Play { track_id: id, started_at: at, listened_ms: if completed { 200_000 } else { 5_000 }, completed }
    }

    /// Artists A, B (ids 1..=6) listened together on day -2; C, D (ids 7..=12) together on day -1.
    fn library() -> (Vec<LibraryTrack>, Vec<Play>) {
        let tracks = (1..=12).map(|i| t(i, ["Alpha", "Bravo", "Charlie", "Delta"][((i - 1) / 3) as usize])).collect();
        let mut plays: Vec<Play> = (1..=6).map(|i| play(i, NOW - 2 * DAY + i * 240, true)).collect();
        plays.extend((7..=12).map(|i| play(i, NOW - DAY + i * 240, true)));
        (tracks, plays)
    }

    fn run(tracks: &[LibraryTrack], plays: &[Play], prefs: &HashMap<i64, Pref>, seed: u64) -> Vec<Mix> {
        mixes(&Input { tracks, plays, playlists: &[], prefs, now: NOW, utc_offset: 0, seed })
    }

    fn artists(tracks: &[LibraryTrack], m: &Mix) -> BTreeSet<String> {
        m.track_ids.iter().map(|id| tracks.iter().find(|t| t.id == *id).unwrap().track.artist.clone()).collect()
    }

    #[test]
    fn weights_and_decay() {
        let w = |completed, listened_ms| play_weight(&Play { track_id: 1, started_at: 0, listened_ms, completed });
        assert!(w(true, 200_000) > w(false, 60_000) && w(false, 60_000) > 0.0 && w(false, 5_000) < 0.0);
        assert!((decay(30 * DAY) - 0.5).abs() < 1e-9 && decay(0) == 1.0 && decay(-5) == 1.0);
    }

    #[test]
    fn daily_mixes_follow_listening_sessions() {
        let (tracks, plays) = library();
        let out = run(&tracks, &plays, &HashMap::new(), 7);
        let daily: Vec<&Mix> = out.iter().filter(|m| m.id.starts_with("daily")).collect();
        assert_eq!(daily.len(), 2, "{out:?}");
        let sets: BTreeSet<BTreeSet<String>> = daily.iter().map(|m| artists(&tracks, m)).collect();
        assert!(sets.contains(&BTreeSet::from(["Alpha".into(), "Bravo".into()])) && sets.contains(&BTreeSet::from(["Charlie".into(), "Delta".into()])), "{sets:?}");
        // Fresher session first.
        assert!(daily[0].reason.contains("Charlie") || daily[0].reason.contains("Delta"), "{}", daily[0].reason);
        for m in &daily {
            let a: Vec<String> = m.track_ids.iter().map(|id| tracks[*id as usize - 1].track.artist.clone()).collect();
            assert!(a.windows(2).all(|w| w[0] != w[1]), "same artist twice in a row: {a:?}");
        }
    }

    #[test]
    fn never_left_out_and_less_ranked_lower() {
        let (tracks, mut plays) = library();
        // Track 7 is the favourite: played twice more.
        plays.extend([play(7, NOW - 3600, true), play(7, NOW - 1800, true)]);
        let pos = |out: &[Mix], id: i64| out.iter().find(|m| m.track_ids.contains(&id)).and_then(|m| m.track_ids.iter().position(|x| *x == id));
        let base = run(&tracks, &plays, &HashMap::new(), 1);
        assert_eq!(pos(&base, 7), Some(0));
        let less = run(&tracks, &plays, &HashMap::from([(7, Pref::Less)]), 1);
        assert!(pos(&less, 7) > Some(0));
        let never = run(&tracks, &plays, &HashMap::from([(7, Pref::Never)]), 1);
        assert!(never.iter().all(|m| !m.track_ids.contains(&7)));
    }

    #[test]
    fn skipped_tracks_drop_out() {
        let (tracks, mut plays) = library();
        plays.extend((0..3).map(|i| play(8, NOW - 600 + i, false)));
        assert!(run(&tracks, &plays, &HashMap::new(), 1).iter().all(|m| !m.track_ids.contains(&8)));
    }

    #[test]
    fn same_seed_same_mixes() {
        let (tracks, plays) = library();
        assert_eq!(run(&tracks, &plays, &HashMap::new(), 42), run(&tracks, &plays, &HashMap::new(), 42));
    }

    #[test]
    fn rediscover_old_favourites() {
        let tracks: Vec<LibraryTrack> = (1..=7).map(|i| t(i, &format!("Artist {i}"))).collect();
        let mut plays: Vec<Play> = (1..=6).flat_map(|i| [play(i, NOW - 90 * DAY + i, true), play(i, NOW - 89 * DAY + i, true)]).collect();
        plays.extend([play(7, NOW - 90 * DAY, true), play(7, NOW - 89 * DAY, true), play(7, NOW - DAY, true)]);
        let out = run(&tracks, &plays, &HashMap::new(), 1);
        let r = out.iter().find(|m| m.id == "rediscover").expect("rediscover mix");
        assert_eq!(r.track_ids.iter().copied().collect::<BTreeSet<_>>(), (1..=6).collect());
    }

    #[test]
    fn time_of_day_mix() {
        let tracks: Vec<LibraryTrack> = (1..=6).map(|i| t(i, &format!("Artist {i}"))).collect();
        // Evenings 20:00 local (UTC+2 → 18:00 UTC) on past days; now = 21:00 local.
        let day0 = NOW - NOW.rem_euclid(DAY);
        let plays: Vec<Play> = (1..=6).map(|i| play(i, day0 - i * DAY + 18 * 3600, true)).collect();
        let out = mixes(&Input { tracks: &tracks, plays: &plays, playlists: &[], prefs: &HashMap::new(), now: day0 + 19 * 3600, utc_offset: 2 * 3600, seed: 1 });
        let m = out.iter().find(|m| m.id == "now").expect("time of day mix");
        assert_eq!((m.title.as_str(), m.track_ids.len()), ("Your evenings", 6));
    }

    #[test]
    fn custom_playlists_count_without_history() {
        let tracks: Vec<LibraryTrack> = (1..=6).map(|i| t(i, if i % 2 == 0 { "Even" } else { "Odd" })).collect();
        let out = mixes(&Input { tracks: &tracks, plays: &[], playlists: &[(1..=6).collect()], prefs: &HashMap::new(), now: NOW, utc_offset: 0, seed: 1 });
        assert_eq!(out.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["daily-1"]);
        assert_eq!(out[0].reason, "Because you listen to Even and Odd");
    }
}
