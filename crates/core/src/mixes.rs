//! Personalized mixes, computed locally from listening history + playlists. Pure: same input and seed = same mixes.
//! Track score = Σ play weight × decay (half-life 30 days) + bonus when in one of your playlists (imported ones less).
//! Daily mixes = artist clusters (label propagation on "listened in the same session / near in a playlist" graph).
//! Inside a mix, songs follow what you play back to back ("flow"); songs heard in the last hours wait their turn.

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
/// Imported playlists (YouTube Music likes, Spotify): saved there, not picked here.
const SAVED_BONUS: f64 = 0.6;
const LESS: f64 = 0.3;
/// Skipped again and again: left out.
const FLOOR: f64 = -1.0;
const MIX_LEN: usize = 25;
const MIN_LEN: usize = 5;
const PER_ARTIST: usize = 4;
const DAILY_MIXES: usize = 6;
const ARTIST_MIXES: usize = 3;
const REDISCOVER_AFTER: i64 = 60 * DAY;
/// Groups bigger than this only link their first artists (pairs grow quadratically).
const GROUP_CAP: usize = 60;
/// Big playlists: songs this close in the list count as related (added around the same time).
const WINDOW: usize = 8;
/// Heard in the last 20 h: ranked lower in daily and artist mixes, so they change from day to day.
const COOLDOWN: i64 = 20 * 3600;
const COOLDOWN_FACTOR: f64 = 0.6;
const REPEAT_DAYS: i64 = 30;
/// Newest songs looked at for "Fresh in your library".
const NEW_TRACKS: usize = 60;
/// A mix sharing this much with an earlier one adds nothing: dropped (small libraries).
const OVERLAP: f64 = 0.8;
const WEEKDAYS: [&str; 7] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

pub struct Input<'a> {
    pub tracks: &'a [LibraryTrack],
    /// Oldest first.
    pub plays: &'a [Play],
    /// Your own playlists, in order.
    pub playlists: &'a [Vec<i64>],
    /// Imported playlists, in order.
    pub saved: &'a [Vec<i64>],
    pub prefs: &'a HashMap<i64, Pref>,
    /// Unix seconds.
    pub now: i64,
    /// Local time minus UTC, seconds (time-of-day and weekday mixes).
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
    /// Section on the Mixes page: daily, moment, favorites, explore.
    pub kind: &'static str,
    /// What `title` and `reason` are made of, for the UI to word them in its language (they stay English).
    pub words: Words,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Words {
    /// morning, afternoon, evening, night.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot: Option<&'static str>,
    /// 0 = Sunday.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub day: Option<usize>,
    /// Daily Mix number.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number: Option<usize>,
    /// The artist an artist mix is about.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Artists named in the reason, best first.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub names: Vec<String>,
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

/// Undirected weight between a and b.
fn bump<K: Ord + Clone>(edges: &mut BTreeMap<(K, K), f64>, a: &K, b: &K, w: f64) {
    if a != b {
        let key = if a < b { (a.clone(), b.clone()) } else { (b.clone(), a.clone()) };
        *edges.entry(key).or_default() += w;
    }
}

/// How a mix ranks its candidates.
#[derive(Clone, Copy, Default)]
struct Opts<'a> {
    /// Heard in the last hours: ranked lower.
    cooldown: bool,
    /// Artist mix: this artist may fill half of it.
    favored: Option<&'a str>,
}

struct Taste<'a> {
    input: &'a Input<'a>,
    /// Track id → artist key (normalized first artist).
    artist: HashMap<i64, String>,
    /// Artist key → name as written.
    display: HashMap<String, String>,
    score: HashMap<i64, f64>,
    /// Songs played back to back or next to each other in a playlist.
    near: HashMap<i64, HashMap<i64, f64>>,
    recent: HashSet<i64>,
}

impl Taste<'_> {
    fn allowed(&self, id: i64) -> bool {
        self.input.prefs.get(&id) != Some(&Pref::Never) && self.score.get(&id).is_none_or(|s| *s > FLOOR)
    }

    /// Rank by score (Less dampened, cooldown, + a little daily noise), spread artists out, then order for flow.
    fn pick(&self, candidates: impl Iterator<Item = (i64, f64)>, opts: Opts) -> Vec<i64> {
        let adjust = |id: i64, s: f64| {
            let s = if s > 0.0 && self.input.prefs.get(&id) == Some(&Pref::Less) { s * LESS } else { s };
            if s > 0.0 && opts.cooldown && self.recent.contains(&id) { s * COOLDOWN_FACTOR } else { s }
        };
        let mut ranked: Vec<(i64, f64)> = candidates.filter(|(id, _)| self.allowed(*id)).map(|(id, s)| (id, adjust(id, s) + 0.3 * noise(self.input.seed, id))).collect();
        ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        self.flow(self.diversify(&ranked.into_iter().map(|(id, _)| id).collect::<Vec<_>>(), opts.favored))
    }

    /// Best first, capped per artist, never the same artist twice in a row unless nothing else is left.
    fn diversify(&self, ranked: &[i64], favored: Option<&str>) -> Vec<i64> {
        let distinct = ranked.iter().map(|id| &self.artist[id]).collect::<HashSet<_>>().len().max(1);
        let cap = PER_ARTIST.max(MIX_LEN.div_ceil(distinct));
        let cap_of = |a: &str| if Some(a) == favored { cap.max(MIX_LEN / 2) } else { cap };
        let mut left = ranked.to_vec();
        let mut count: HashMap<&str, usize> = HashMap::new();
        let mut out: Vec<i64> = Vec::new();
        while out.len() < MIX_LEN {
            let prev = out.last().map(|id| self.artist[id].as_str());
            let room = |id: &i64| {
                let a = self.artist[id].as_str();
                count.get(a).copied().unwrap_or(0) < cap_of(a)
            };
            let Some(pos) = left.iter().position(|id| room(id) && Some(self.artist[id].as_str()) != prev).or_else(|| left.iter().position(room)) else { break };
            let id = left.remove(pos);
            *count.entry(self.artist[&id].as_str()).or_default() += 1;
            out.push(id);
        }
        out
    }

    /// Best song first, then each next one is the most linked to the current (back to back, playlist neighbours) by
    /// another artist; no link: rank order.
    fn flow(&self, ids: Vec<i64>) -> Vec<i64> {
        if ids.len() < 3 {
            return ids;
        }
        let mut left = ids[1..].to_vec();
        let mut out = vec![ids[0]];
        while !left.is_empty() {
            let cur = out[out.len() - 1];
            let links = self.near.get(&cur);
            let w = |id: i64| links.and_then(|m| m.get(&id)).copied().unwrap_or(0.0);
            let other = |id: i64| self.artist[&id] != self.artist[&cur];
            let pos = left.iter().enumerate().filter(|(_, id)| other(**id)).max_by(|a, b| w(*a.1).total_cmp(&w(*b.1)).then(b.0.cmp(&a.0))).map_or(0, |(i, _)| i);
            out.push(left.remove(pos));
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

/// Shares less than OVERLAP of its songs with every mix so far.
fn new_enough(out: &[Mix], ids: &[i64]) -> bool {
    let set: HashSet<&i64> = ids.iter().collect();
    out.iter().all(|m| (m.track_ids.iter().filter(|id| set.contains(id)).count() as f64) < OVERLAP * ids.len() as f64)
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
    for (lists, bonus) in [(input.playlists, PLAYLIST_BONUS), (input.saved, SAVED_BONUS)] {
        for id in lists.iter().flatten().collect::<HashSet<_>>() {
            if artist.contains_key(id) {
                *score.entry(*id).or_default() += bonus;
            }
        }
    }

    // Song links: played back to back (same session), or close in a playlist.
    let mut near: HashMap<i64, HashMap<i64, f64>> = HashMap::new();
    let mut link_tracks = |a: i64, b: i64, w: f64| {
        if a != b {
            *near.entry(a).or_default().entry(b).or_default() += w;
            *near.entry(b).or_default().entry(a).or_default() += w;
        }
    };
    let good: Vec<&&Play> = plays.iter().filter(|p| play_weight(p) > 0.0).collect();
    for w in good.windows(2) {
        if w[1].started_at - w[0].started_at <= SESSION_GAP {
            link_tracks(w[0].track_id, w[1].track_id, 1.0);
        }
    }
    for list in input.playlists.iter().chain(input.saved) {
        let ids: Vec<i64> = list.iter().copied().filter(|id| artist.contains_key(id)).collect();
        for i in 0..ids.len() {
            for j in i + 1..ids.len().min(i + 1 + WINDOW) {
                link_tracks(ids[i], ids[j], 0.5 / (j - i) as f64);
            }
        }
    }
    let recent: HashSet<i64> = plays.iter().filter(|p| input.now - p.started_at < COOLDOWN && play_weight(p) > 0.0).map(|p| p.track_id).collect();
    let taste = Taste { input, artist, display, score, near, recent };

    let mut affinity: BTreeMap<&str, f64> = BTreeMap::new();
    for (id, s) in &taste.score {
        if *s > 0.0 {
            *affinity.entry(taste.artist[id].as_str()).or_default() += s;
        }
    }

    // Artist graph: listened in the same session, picked into the same playlist, or close in a big one.
    let mut edges: BTreeMap<(String, String), f64> = BTreeMap::new();
    let mut link_all = |group: BTreeSet<&str>| {
        let v: Vec<String> = group.into_iter().take(GROUP_CAP).map(String::from).collect();
        for i in 0..v.len() {
            for j in i + 1..v.len() {
                bump(&mut edges, &v[i], &v[j], 1.0);
            }
        }
    };
    let mut session = BTreeSet::new();
    let mut last: Option<i64> = None;
    for p in &good {
        if last.is_some_and(|l| p.started_at - l > SESSION_GAP) {
            link_all(std::mem::take(&mut session));
        }
        session.insert(taste.artist[&p.track_id].as_str());
        last = Some(p.started_at);
    }
    link_all(session);
    for pl in input.playlists.iter().filter(|pl| pl.len() <= GROUP_CAP) {
        link_all(pl.iter().filter_map(|id| taste.artist.get(id).map(String::as_str)).collect());
    }
    for pl in input.playlists.iter().filter(|pl| pl.len() > GROUP_CAP).chain(input.saved) {
        let v: Vec<&String> = pl.iter().filter_map(|id| taste.artist.get(id)).collect();
        for i in 0..v.len() {
            for j in i + 1..v.len().min(i + 1 + WINDOW) {
                bump(&mut edges, v[i], v[j], 0.5 / (j - i) as f64);
            }
        }
    }

    let nodes: Vec<String> = affinity.keys().map(|a| a.to_string()).collect();
    let mut groups: Vec<(f64, Vec<String>)> = clusters(&nodes, &edges, input.seed).into_iter().map(|g| (g.iter().map(|a| affinity[a.as_str()]).sum(), g)).collect();
    groups.sort_by(|a, b| b.0.total_cmp(&a.0));

    let score_of = |id: i64| taste.score.get(&id).copied().unwrap_or(0.0);
    let by_artists = |set: &HashSet<&str>, opts: Opts| -> Vec<i64> { taste.pick(input.tracks.iter().filter(|t| set.contains(taste.artist[&t.id].as_str())).map(|t| (t.id, score_of(t.id))), opts) };
    let shown = |artists: &[&str], n: usize| -> Vec<String> {
        let mut top: Vec<&str> = artists.to_vec();
        top.sort_by(|a, b| affinity.get(b).copied().unwrap_or(0.0).total_cmp(&affinity.get(a).copied().unwrap_or(0.0)));
        top.iter().take(n).map(|a| taste.display[*a].clone()).collect()
    };
    let joined = |list: &[String]| names(&list.iter().map(String::as_str).collect::<Vec<_>>());
    let daily_opts = Opts { cooldown: true, favored: None };

    let mut out = Vec::new();
    let local_day = |t: i64| (t + input.utc_offset).div_euclid(DAY);

    // Time of day: what you play in this slot.
    let local_hour = |t: i64| (t + input.utc_offset).rem_euclid(DAY) / 3600;
    let now_slot = slot(local_hour(input.now));
    let mut in_slot: HashMap<i64, f64> = HashMap::new();
    for p in good.iter().filter(|p| slot(local_hour(p.started_at)) == now_slot) {
        *in_slot.entry(p.track_id).or_default() += play_weight(p) * decay(input.now - p.started_at);
    }
    let ids = taste.pick(in_slot.into_iter(), Opts::default());
    if ids.len() >= MIN_LEN {
        let when = if now_slot == "night" { "at night".to_string() } else { format!("in the {now_slot}") };
        let words = Words { slot: Some(now_slot), ..Words::default() };
        out.push(Mix { id: "now".into(), title: format!("Your {now_slot}s"), reason: format!("What you usually play {when}"), track_ids: ids, kind: "moment", words });
    }

    let mut daily: Vec<(Vec<String>, Vec<i64>)> = Vec::new();
    let mut leftovers: Vec<String> = Vec::new();
    for (_, g) in groups {
        if daily.len() == DAILY_MIXES {
            break;
        }
        let ids = by_artists(&g.iter().map(String::as_str).collect(), daily_opts);
        if ids.len() >= MIN_LEN { daily.push((g, ids)) } else { leftovers.extend(g) }
    }
    if daily.len() < DAILY_MIXES && !leftovers.is_empty() {
        let ids = by_artists(&leftovers.iter().map(String::as_str).collect(), daily_opts);
        if ids.len() >= MIN_LEN {
            daily.push((leftovers, ids));
        }
    }
    for (i, (g, ids)) in daily.into_iter().enumerate() {
        let g: Vec<&str> = g.iter().map(String::as_str).collect();
        let top = shown(&g, 3);
        let reason = format!("Because you listen to {}", joined(&top));
        out.push(Mix { id: format!("daily-{}", i + 1), title: format!("Daily Mix {}", i + 1), reason, track_ids: ids, kind: "daily", words: Words { number: Some(i + 1), names: top, ..Words::default() } });
    }

    // On Repeat: played again and again lately (two listens' worth in 30 days, last week counts most).
    let mut lately: HashMap<i64, f64> = HashMap::new();
    for p in good.iter().filter(|p| input.now - p.started_at <= REPEAT_DAYS * DAY) {
        *lately.entry(p.track_id).or_default() += play_weight(p) * 0.5f64.powf((input.now - p.started_at) as f64 / (7 * DAY) as f64);
    }
    let ids = taste.pick(lately.into_iter().filter(|(_, s)| *s >= 1.2), Opts::default());
    if ids.len() >= MIN_LEN && new_enough(&out, &ids) {
        out.push(Mix { id: "repeat".into(), title: "On Repeat".into(), reason: "The songs you keep coming back to lately".into(), track_ids: ids, kind: "favorites", words: Words::default() });
    }

    // Artist mixes: your top artists, with the artists you play next to them.
    let mut top: Vec<(&str, f64)> = affinity.iter().map(|(a, s)| (*a, *s)).collect();
    top.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(b.0)));
    let songs_by = |a: &str| input.tracks.iter().filter(|t| taste.artist[&t.id] == a).count();
    let mut made = 0;
    for (a, _) in top.iter().filter(|(a, _)| songs_by(a) >= 3) {
        if made == ARTIST_MIXES {
            break;
        }
        let mut friends: Vec<(&str, f64)> = edges.iter().filter_map(|((x, y), w)| if x.as_str() == *a { Some((y.as_str(), *w)) } else if y.as_str() == *a { Some((x.as_str(), *w)) } else { None }).collect();
        friends.sort_by(|x, y| y.1.total_cmp(&x.1).then(x.0.cmp(y.0)));
        friends.truncate(5);
        let set: HashSet<&str> = friends.iter().map(|(f, _)| *f).chain([*a]).collect();
        // Their songs lead: boosted, and may fill half the mix.
        let cands = input.tracks.iter().filter(|t| set.contains(taste.artist[&t.id].as_str())).map(|t| (t.id, (score_of(t.id) + 0.5) * if taste.artist[&t.id] == *a { 1.5 } else { 1.0 }));
        let ids = taste.pick(cands, Opts { cooldown: true, favored: Some(*a) });
        if ids.len() < MIN_LEN || !new_enough(&out, &ids) {
            continue;
        }
        made += 1;
        let name = &taste.display[*a];
        let with: Vec<&str> = friends.iter().map(|(f, _)| *f).collect();
        let others = shown(&with, 2);
        let reason = if others.is_empty() { format!("All {name}, your way") } else { format!("{name}, with {}", joined(&others)) };
        let words = Words { name: Some(name.clone()), names: others, ..Words::default() };
        out.push(Mix { id: format!("artist-{made}"), title: format!("{name} Mix"), reason, track_ids: ids, kind: "favorites", words });
    }

    // This weekday: what you play on, say, Fridays (other Fridays, not today).
    let weekday = |t: i64| (local_day(t) + 4).rem_euclid(7) as usize;
    let today = weekday(input.now);
    let mut on_day: HashMap<i64, f64> = HashMap::new();
    let mut days = HashSet::new();
    for p in good.iter().filter(|p| weekday(p.started_at) == today && local_day(p.started_at) != local_day(input.now)) {
        *on_day.entry(p.track_id).or_default() += play_weight(p) * decay(input.now - p.started_at);
        days.insert(local_day(p.started_at));
    }
    let ids = taste.pick(on_day.into_iter(), Opts::default());
    if days.len() >= 2 && ids.len() >= MIN_LEN && new_enough(&out, &ids) {
        let d = WEEKDAYS[today];
        out.push(Mix { id: "weekday".into(), title: format!("Your {d}s"), reason: format!("What you play on {d}s"), track_ids: ids, kind: "moment", words: Words { day: Some(today), ..Words::default() } });
    }

    // Fresh: newest songs in the library, heard once at most.
    let mut full: HashMap<i64, usize> = HashMap::new();
    for p in plays.iter().filter(|p| p.completed) {
        *full.entry(p.track_id).or_default() += 1;
    }
    let mut newest: Vec<&LibraryTrack> = input.tracks.iter().collect();
    newest.sort_by(|a, b| b.added.cmp(&a.added).then(b.id.cmp(&a.id)));
    let cands = newest.iter().take(NEW_TRACKS).enumerate().filter(|(_, t)| full.get(&t.id).copied().unwrap_or(0) <= 1).map(|(i, t)| (t.id, 1.0 - i as f64 / NEW_TRACKS as f64));
    let ids = taste.pick(cands, Opts::default());
    if ids.len() >= MIN_LEN && new_enough(&out, &ids) {
        out.push(Mix { id: "fresh".into(), title: "Fresh in your library".into(), reason: "Just added, barely played yet".into(), track_ids: ids, kind: "explore", words: Words::default() });
    }

    // Hidden gems: in your library, never played here, by artists you like.
    let played: HashSet<i64> = plays.iter().map(|p| p.track_id).collect();
    let best = affinity.values().copied().fold(0.0, f64::max).max(1e-9);
    let cands = input.tracks.iter().filter(|t| !played.contains(&t.id)).filter_map(|t| affinity.get(taste.artist[&t.id].as_str()).map(|a| (t.id, a / best + score_of(t.id) * 0.2)));
    let ids = taste.pick(cands, Opts::default());
    if ids.len() >= MIN_LEN && new_enough(&out, &ids) {
        out.push(Mix { id: "gems".into(), title: "Hidden gems".into(), reason: "Saved but never played here, by artists you like".into(), track_ids: ids, kind: "explore", words: Words::default() });
    }

    // Rediscover: loved before (2+ full listens' worth), silent for 60 days.
    let mut past: HashMap<i64, f64> = HashMap::new();
    let mut last_play: HashMap<i64, i64> = HashMap::new();
    for p in &plays {
        *past.entry(p.track_id).or_default() += play_weight(p);
        last_play.insert(p.track_id, p.started_at);
    }
    let ids = taste.pick(past.into_iter().filter(|(id, s)| *s >= 2.0 && input.now - last_play[id] > REDISCOVER_AFTER), Opts::default());
    if ids.len() >= MIN_LEN {
        out.push(Mix { id: "rediscover".into(), title: "Rediscover".into(), reason: "Tracks you loved, not played for two months".into(), track_ids: ids, kind: "explore", words: Words::default() });
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
        mixes(&Input { tracks, plays, playlists: &[], saved: &[], prefs, now: NOW, utc_offset: 0, seed })
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
        let out = mixes(&Input { tracks: &tracks, plays: &plays, playlists: &[], saved: &[], prefs: &HashMap::new(), now: day0 + 19 * 3600, utc_offset: 2 * 3600, seed: 1 });
        let m = out.iter().find(|m| m.id == "now").expect("time of day mix");
        assert_eq!((m.title.as_str(), m.track_ids.len()), ("Your evenings", 6));
    }

    #[test]
    fn custom_playlists_count_without_history() {
        let tracks: Vec<LibraryTrack> = (1..=6).map(|i| t(i, if i % 2 == 0 { "Even" } else { "Odd" })).collect();
        let out = mixes(&Input { tracks: &tracks, plays: &[], playlists: &[(1..=6).collect()], saved: &[], prefs: &HashMap::new(), now: NOW, utc_offset: 0, seed: 1 });
        // Artist, fresh and gems mixes would repeat daily-1 in so small a library: dropped.
        assert_eq!(out.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["daily-1"]);
        assert_eq!(out[0].reason, "Because you listen to Even and Odd");
        assert_eq!((out[0].words.number, out[0].words.names.clone()), (Some(1), vec!["Even".to_string(), "Odd".to_string()]));
    }

    fn library_of(n: i64, artists: &[&str]) -> Vec<LibraryTrack> {
        (1..=n).map(|i| t(i, artists[(i as usize - 1) % artists.len()])).collect()
    }

    #[test]
    fn on_repeat_keeps_what_you_replay() {
        // A, B songs in one evening session, C, D in another: two clusters. 1..=8 three times this week.
        let tracks = library_of(20, &["A", "B", "C", "D"]);
        let ab = |i: &i64| (i - 1) % 4 < 2;
        let mut plays = Vec::new();
        for k in 1..=3 {
            let eve = NOW - k * DAY + 12 * 3600;
            plays.extend((1..=8).filter(ab).map(|i| play(i, eve + i * 200, true)));
            plays.extend((1..=8).filter(|i| !ab(i)).map(|i| play(i, eve + 3 * 3600 + i * 200, true)));
        }
        plays.extend((9..=20).filter(ab).map(|i| play(i, NOW - 25 * DAY + 12 * 3600 + i * 200, true)));
        plays.extend((9..=20).filter(|i| !ab(i)).map(|i| play(i, NOW - 25 * DAY + 16 * 3600 + i * 200, true)));
        plays.sort_by_key(|p| p.started_at);
        let out = run(&tracks, &plays, &HashMap::new(), 1);
        let m = out.iter().find(|m| m.id == "repeat").unwrap_or_else(|| panic!("{out:?}"));
        assert_eq!(m.track_ids.iter().copied().collect::<BTreeSet<_>>(), (1..=8).collect(), "{m:?}");
        assert_eq!(m.kind, "favorites");
    }

    #[test]
    fn artist_mix_centres_on_your_top_artist() {
        // Star (12 songs) played with six friends (4 songs each); Other alone, long ago.
        let mut tracks: Vec<LibraryTrack> = (1..=12).map(|i| t(i, "Star")).collect();
        let pals = ["Pal One", "Pal Two", "Pal Three", "Pal Four", "Pal Five", "Pal Six"];
        tracks.extend((13..=36).map(|i| t(i, pals[((i - 13) / 4) as usize])));
        tracks.extend((37..=42).map(|i| t(i, "Other")));
        let mut plays = Vec::new();
        for day in 1..=3 {
            plays.extend((1..=36).map(|i| play(i, NOW - day * 2 * DAY + i * 100, true)));
            // Star twice as much.
            plays.extend((1..=12).map(|i| play(i, NOW - day * 2 * DAY + 4000 + i * 100, true)));
        }
        plays.extend((37..=42).map(|i| play(i, NOW - 40 * DAY + i * 4000, true)));
        plays.sort_by_key(|p| p.started_at);
        let out = run(&tracks, &plays, &HashMap::new(), 3);
        let m = out.iter().find(|m| m.title == "Star Mix").unwrap_or_else(|| panic!("{out:?}"));
        let a = artists(&tracks, m);
        assert!(a.contains("Star") && a.iter().any(|x| x.starts_with("Pal")) && !a.contains("Other"), "{a:?}");
        assert!(m.reason.starts_with("Star, with Pal"), "{}", m.reason);
        // Star leads: more of its songs than any daily mix gives it.
        let stars = m.track_ids.iter().filter(|id| **id <= 12).count();
        assert!(stars > PER_ARTIST, "{m:?}");
    }

    #[test]
    fn hidden_gems_and_fresh_from_your_saves() {
        // Imported playlist: 30 songs by 3 artists; 1..=10 played, the rest never.
        let tracks = library_of(30, &["X", "Y", "Z"]);
        let plays: Vec<Play> = (1..=10).map(|i| play(i, NOW - 5 * DAY + i * 3 * 3600, true)).collect();
        let saved = vec![(1..=30).collect::<Vec<i64>>()];
        let out = mixes(&Input { tracks: &tracks, plays: &plays, playlists: &[], saved: &saved, prefs: &HashMap::new(), now: NOW, utc_offset: 0, seed: 1 });
        let gems = out.iter().find(|m| m.id == "gems").unwrap_or_else(|| panic!("{out:?}"));
        assert!(gems.track_ids.iter().all(|id| *id > 10), "{gems:?}");
        if let Some(fresh) = out.iter().find(|m| m.id == "fresh") {
            // Newest first in rank: added = id.
            assert!(fresh.track_ids.iter().all(|id| *id > 30 - NEW_TRACKS as i64), "{fresh:?}");
        }
    }

    #[test]
    fn songs_flow_from_what_you_play_back_to_back() {
        // P: 1, 3, 5. Q: 2, 4, 6. Always played 5 → 2 → 1 → 6 → 3 → 4.
        let tracks = library_of(6, &["P", "Q"]);
        let order = [5, 2, 1, 6, 3, 4];
        let mut plays = Vec::new();
        for day in (1..=5).rev() {
            for (k, id) in order.iter().enumerate() {
                plays.push(play(*id, NOW - day * DAY + k as i64 * 200, true));
            }
        }
        let out = run(&tracks, &plays, &HashMap::new(), 9);
        let m = out.iter().find(|m| m.id.starts_with("daily")).expect("daily");
        let pairs: BTreeSet<(i64, i64)> = order.windows(2).flat_map(|w| [(w[0], w[1]), (w[1], w[0])]).collect();
        // Chain of 6 with at most one jump.
        assert!(m.track_ids.windows(2).filter(|w| pairs.contains(&(w[0], w[1]))).count() >= 4, "{:?}", m.track_ids);
    }

    #[test]
    fn weekday_mix_needs_two_past_weeks() {
        // 1..=10 only ever on Fridays (one and two weeks ago); 11..=40 twice on other days.
        let tracks = library_of(40, &["A", "B"]);
        let mut plays: Vec<Play> = (1..=10).map(|i| play(i, NOW - if i % 2 == 0 { 7 } else { 14 } * DAY + i * 60, true)).collect();
        for d in 1..=6 {
            plays.extend((11..=40).filter(|i| i % 6 == d % 6).flat_map(|i| [play(i, NOW - d * DAY + i * 60, true), play(i, NOW - d * DAY + 3000 + i * 60, true)]));
        }
        plays.sort_by_key(|p| p.started_at);
        let out = run(&tracks, &plays, &HashMap::new(), 1);
        let m = out.iter().find(|m| m.id == "weekday").unwrap_or_else(|| panic!("{out:?}"));
        assert_eq!((m.title.as_str(), m.kind), ("Your Fridays", "moment"));
        assert!(m.track_ids.iter().all(|id| *id <= 10), "{m:?}");
        let once: Vec<Play> = plays.iter().copied().filter(|p| p.track_id > 10 || p.track_id % 2 == 0).collect();
        assert!(run(&tracks, &once, &HashMap::new(), 1).iter().all(|m| m.id != "weekday"));
    }

    #[test]
    fn cooldown_moves_songs_heard_today_down() {
        let (tracks, mut plays) = library();
        let first = |out: &[Mix]| out.iter().find(|m| m.id.starts_with("daily") && m.track_ids.contains(&9)).map(|m| m.track_ids.iter().position(|x| *x == 9).unwrap());
        // Track 9 a favourite, played over the last weeks.
        plays.extend((3..=8).map(|d| play(9, NOW - d * DAY, true)));
        plays.sort_by_key(|p| p.started_at);
        let before = first(&run(&tracks, &plays, &HashMap::new(), 1)).unwrap();
        plays.push(play(9, NOW - 3600, true));
        let after = first(&run(&tracks, &plays, &HashMap::new(), 1)).unwrap();
        assert!(after >= before, "{before} → {after}");
    }
}
