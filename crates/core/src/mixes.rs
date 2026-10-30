//! Personalized mixes, computed locally from listening history + playlists. Pure: same input and seed = same mixes.
//! Track score = Σ play weight × decay (half-life 30 days) + bonus when in one of your playlists (imported ones less),
//! more when liked.
//! Daily mixes = artist clusters (label propagation on "listened in the same session / near in a playlist" graph).
//! Inside a mix, songs follow what you play back to back ("flow"); songs heard in the last hours wait their turn.
//! One version per song: slowed, reverb, sped up, remix, lyrics, extended uploads fold into one ("Artist - Title" read
//! from the video title when a channel uploaded it).
//! Discoveries: YouTube Music's radio of each mix's leading song (fetched by the shell for `seeds`), songs not in the
//! library in any version; a third of a daily mix, a quarter of an artist mix or the Supermix, all of the Discover Mix.

use crate::history::{Play, Pref};
use crate::library::LibraryTrack;
use crate::matching::{first_artist, normalize, primary_artist};
use crate::model::{Source, Track};
use crate::musicness::Musicness;
use regex::Regex;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::LazyLock;

const DAY: i64 = 86_400;
const HALF_LIFE_DAYS: f64 = 30.0;
/// Supermix: taste over the months, not the last weeks.
const LONG_HALF_LIFE_DAYS: f64 = 180.0;
/// Under this = skipped (negative signal).
const SKIP_MS: u32 = 30_000;
const SESSION_GAP: i64 = 30 * 60;
const PLAYLIST_BONUS: f64 = 1.5;
/// Imported playlists (YouTube Music likes, Spotify): saved there, not picked here.
const SAVED_BONUS: f64 = 0.6;
/// Liked Music (heart button, YouTube likes): a clear "I like it", above any playlist. Newest like gets it all; it
/// halves every LIKES_HALF likes since, down to LIKED_OLD (years of likes would flatten it otherwise).
const LIKED_BONUS: f64 = 3.0;
const LIKED_OLD: f64 = 1.0;
const LIKES_HALF: f64 = 100.0;
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
/// Radios asked per day (daily mixes, artist mixes, Supermix).
const SEEDS: usize = 10;
/// Discoveries by one artist in a mix.
const NEW_PER_ARTIST: usize = 2;
const WEEKDAYS: [&str; 7] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

pub struct Input<'a> {
    pub tracks: &'a [LibraryTrack],
    /// Oldest first.
    pub plays: &'a [Play],
    /// Your own playlists, in order.
    pub playlists: &'a [Vec<i64>],
    /// Imported playlists, in order.
    pub saved: &'a [Vec<i64>],
    /// Liked Music, yours and YouTube Music's, newest like first.
    pub liked: &'a [i64],
    pub prefs: &'a HashMap<i64, Pref>,
    /// Unix seconds.
    pub now: i64,
    /// Local time minus UTC, seconds (time-of-day and weekday mixes).
    pub utc_offset: i64,
    /// Changes daily: small variation in picks, same day = same mixes.
    pub seed: u64,
    /// YouTube Music's radio of each of `seeds`: (seed track id, songs it plays after it, in its order).
    pub found: &'a [(i64, Vec<Track>)],
}

#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Mix {
    pub id: String,
    pub title: String,
    /// Shown under the title: why these tracks.
    pub reason: String,
    pub track_ids: Vec<i64>,
    /// Section on the Mixes page: daily, moment, favorites, explore.
    #[ts(type = r#""daily" | "moment" | "favorites" | "explore""#)]
    pub kind: &'static str,
    /// What `title` and `reason` are made of, for the UI to word them in its language (they stay English).
    pub words: Words,
    /// Songs new to you, slotted between `track_ids`.
    // default: only so ts-rs types the skipped field optional.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub found: Vec<Found>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[ts(export, rename = "MixFound")]
pub struct Found {
    /// Place in the whole mix (library songs and discoveries together).
    pub at: usize,
    pub track: Track,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "MixWords", optional_fields)]
pub struct Words {
    /// morning, afternoon, evening, night.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = r#""morning" | "afternoon" | "evening" | "night""#)]
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
    // default: as `Mix::found`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional = nullable)]
    pub names: Vec<String>,
}

/// Full listen 1; partial: more of the song heard, more weight; skip (under 30 s) negative, earlier = worse.
pub fn play_weight(p: &Play, duration_ms: Option<u32>) -> f64 {
    if p.completed {
        1.0
    } else if p.listened_ms >= SKIP_MS {
        // Unknown length: half a song.
        duration_ms.filter(|d| *d > 0).map_or(0.5, |d| 0.3 + 0.6 * (p.listened_ms as f64 / d as f64).min(1.0))
    } else {
        // Above FLOOR: one skip alone never leaves a song out.
        -0.9 + 0.6 * p.listened_ms as f64 / SKIP_MS as f64
    }
}

/// Halves every 30 days.
pub fn decay(age_s: i64) -> f64 {
    fade(age_s, HALF_LIFE_DAYS)
}

fn fade(age_s: i64, half_life_days: f64) -> f64 {
    0.5f64.powf(age_s.max(0) as f64 / DAY as f64 / half_life_days)
}

static ARTIST_DASH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*(.+?)\s*[-–—]\s+(.+)$").unwrap());
/// Right of " - " naming a version, not a song ("Song - 2011 Remaster", "Song - Live", "Song - Slowed").
static VERSION_TAIL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:\d{4}\s+)?(?:remaster|live\b|radio|mono|stereo|single|album|acoustic|demo|bonus|instrumental|version|edit\b|mix\b|remix|from\b|original|official|extended|slowed|sped|speed|reverb|bass|nightcore|daycore|lyric|8d)").unwrap()
});
/// Artist and title as written: "Artist - Title" from the video title when a channel uploaded it.
fn credit(t: &Track) -> (&str, &str) {
    match ARTIST_DASH.captures(&t.title) {
        // Album = released track: its artist is right, " - " starts a version.
        Some(c) if t.album.is_none() && !VERSION_TAIL.is_match(&c[2]) => (c.get(1).map_or("", |m| m.as_str()), c.get(2).map_or("", |m| m.as_str())),
        _ => (t.artist.as_str(), t.title.as_str()),
    }
}

static BRACKETS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[(\[{][^)\]}]*[)\]}]").unwrap());
/// Version words, normalized: from there on, same song again ("long time super slowed reverb").
static VERSION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b(?:super slowed|slowed|reverb|sped up|speed up|nightcore|daycore|bass boosted|reversed? intro|8d audio|extended|remix|lyrics?)\b").unwrap());

/// (artist key, song key) whatever the upload: "Yeat - Liv Like Dis [Reverse Intro] (Slowed + Reverb)" by a
/// slowed-edits channel and "yeat - liv like dis (slowed + bass boosted)" by another → ("yeat", "yeat|liv like dis").
pub fn song_key(t: &Track) -> (String, String) {
    let (artist, title) = credit(t);
    let mut song = normalize(&BRACKETS.replace_all(title, " "));
    if let Some(i) = VERSION.find(&song).map(|m| m.start()).filter(|i| *i > 0) {
        song.truncate(i);
    }
    let song = match song.trim() {
        "" => normalize(&t.title),
        s => s.to_string(),
    };
    let artist = primary_artist(artist);
    let key = format!("{artist}|{song}");
    (artist, key)
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
    /// Track id → song key (all its versions share it).
    song: HashMap<i64, String>,
    /// Less / Never on any version holds for the song (Never wins).
    song_pref: HashMap<String, Pref>,
    /// Song keys in the library: not news.
    known: HashSet<String>,
    /// YouTube videos in the library (a radio starts with its seed, credited its own way).
    videos: HashSet<String>,
}

impl<'a> Taste<'a> {
    fn pref(&self, id: i64) -> Option<Pref> {
        self.song_pref.get(&self.song[&id]).copied()
    }

    fn allowed(&self, id: i64) -> bool {
        self.pref(id) != Some(Pref::Never) && self.score.get(&id).is_none_or(|s| *s > FLOOR)
    }

    /// Rank by score (Less dampened, cooldown, + a little daily noise), best version of each song only, spread artists
    /// out, then order for flow.
    fn pick(&self, candidates: impl Iterator<Item = (i64, f64)>, opts: Opts) -> Vec<i64> {
        let adjust = |id: i64, s: f64| {
            let s = if s > 0.0 && self.pref(id) == Some(Pref::Less) { s * LESS } else { s };
            if s > 0.0 && opts.cooldown && self.recent.contains(&id) { s * COOLDOWN_FACTOR } else { s }
        };
        let mut ranked: Vec<(i64, f64)> = candidates.filter(|(id, _)| self.allowed(*id)).map(|(id, s)| (id, adjust(id, s) + 0.3 * noise(self.input.seed, id))).collect();
        ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        let mut seen = HashSet::new();
        ranked.retain(|(id, _)| seen.insert(&self.song[id]));
        self.flow(self.diversify(&ranked.into_iter().map(|(id, _)| id).collect::<Vec<_>>(), opts.favored))
    }

    /// Songs YouTube Music's radios of this mix's songs play, new to you (no version in the library, none used by an
    /// earlier mix): one per song, best first (on more radios, earlier in them), NEW_PER_ARTIST per artist.
    fn discover(&self, mix: &[i64], used: &HashSet<String>) -> Vec<&'a Track> {
        let mix: HashSet<i64> = mix.iter().copied().collect();
        let mut best: BTreeMap<String, (f64, String, &'a Track)> = BTreeMap::new();
        for (_, radio) in self.input.found.iter().filter(|(seed, _)| mix.contains(seed)) {
            for (i, t) in radio.iter().enumerate() {
                if t.musicness == Some(Musicness::NotMusic) || !t.ids.contains_key(&Source::Youtube) {
                    continue;
                }
                let (artist, song) = song_key(t);
                if self.song_pref.contains_key(&song) || self.known.contains(&song) || used.contains(&song) || self.videos.contains(&t.ids[&Source::Youtube]) {
                    continue;
                }
                best.entry(song).or_insert((0.0, artist, t)).0 += 1.0 - i as f64 / radio.len() as f64;
            }
        }
        let mut ranked: Vec<(f64, String, &Track)> = best.into_values().collect();
        // Stable: equal scores keep song key order.
        ranked.sort_by(|a, b| b.0.total_cmp(&a.0));
        let mut count: HashMap<String, usize> = HashMap::new();
        ranked
            .into_iter()
            .filter(|(_, artist, _)| {
                let n = count.entry(artist.clone()).or_default();
                *n += 1;
                *n <= NEW_PER_ARTIST
            })
            .map(|(_, _, t)| t)
            .collect()
    }

    /// Mix of `ids` with a discovery every `every` songs (never first), MIX_LEN in all. Discoveries taken go in `used`.
    fn blend(&self, mut mix: Mix, every: usize, used: &mut HashSet<String>) -> Mix {
        let new = self.discover(&mix.track_ids, used);
        let n = new.len().min(MIX_LEN / every);
        let mut lib = std::mem::take(&mut mix.track_ids).into_iter().take(MIX_LEN - n);
        let mut new = new.into_iter().take(n);
        for at in 0..MIX_LEN {
            let next = if (at + 1) % every == 0 { new.next().map(Err).or_else(|| lib.next().map(Ok)) } else { lib.next().map(Ok).or_else(|| new.next().map(Err)) };
            match next {
                Some(Ok(id)) => mix.track_ids.push(id),
                Some(Err(t)) => {
                    used.insert(song_key(t).1);
                    mix.found.push(Found { at, track: t.clone() });
                }
                None => break,
            }
        }
        mix
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
    // Talks, tutorials, gameplay: never in a mix (user's report 2026-10-22: Roblox scripting videos as Daily Mixes).
    let music: Vec<LibraryTrack> = input.tracks.iter().filter(|t| t.track.musicness != Some(Musicness::NotMusic)).cloned().collect();
    let input = &Input { tracks: &music, ..*input };
    let mut artist = HashMap::new();
    let mut display = HashMap::new();
    let mut song = HashMap::new();
    for t in input.tracks {
        let (key, s) = song_key(&t.track);
        // The artist's own uploads spell the name best.
        if !display.contains_key(&key) || primary_artist(&t.track.artist) == key {
            display.insert(key.clone(), first_artist(credit(&t.track).0).to_string());
        }
        artist.insert(t.id, key);
        song.insert(t.id, s);
    }
    let known: HashSet<String> = song.values().cloned().collect();
    let mut song_pref: HashMap<String, Pref> = HashMap::new();
    for (id, p) in input.prefs {
        if let Some(s) = song.get(id) {
            let e = song_pref.entry(s.clone()).or_insert(*p);
            if *p == Pref::Never {
                *e = Pref::Never;
            }
        }
    }
    let plays: Vec<&Play> = input.plays.iter().filter(|p| artist.contains_key(&p.track_id)).collect();
    let length: HashMap<i64, u32> = input.tracks.iter().filter_map(|t| Some((t.id, t.track.duration_ms?))).collect();
    let play_weight = |p: &Play| play_weight(p, length.get(&p.track_id).copied());

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
    for (rank, id) in input.liked.iter().enumerate() {
        if artist.contains_key(id) {
            *score.entry(*id).or_default() += LIKED_OLD + (LIKED_BONUS - LIKED_OLD) * 0.5f64.powf(rank as f64 / LIKES_HALF);
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
    let videos: HashSet<String> = input.tracks.iter().filter_map(|t| t.track.ids.get(&Source::Youtube).cloned()).collect();
    let taste = Taste { input, artist, display, score, near, recent, song, song_pref, known, videos };

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
        out.push(Mix { id: "now".into(), title: format!("Your {now_slot}s"), reason: format!("What you usually play {when}"), track_ids: ids, kind: "moment", words, found: Vec::new() });
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
        out.push(Mix { id: format!("daily-{}", i + 1), title: format!("Daily Mix {}", i + 1), reason, track_ids: ids, kind: "daily", words: Words { number: Some(i + 1), names: top, ..Words::default() }, found: Vec::new() });
    }

    // On Repeat: played again and again lately (two listens' worth in 30 days, last week counts most).
    let mut lately: HashMap<i64, f64> = HashMap::new();
    for p in good.iter().filter(|p| input.now - p.started_at <= REPEAT_DAYS * DAY) {
        *lately.entry(p.track_id).or_default() += play_weight(p) * 0.5f64.powf((input.now - p.started_at) as f64 / (7 * DAY) as f64);
    }
    let ids = taste.pick(lately.into_iter().filter(|(_, s)| *s >= 1.2), Opts::default());
    if ids.len() >= MIN_LEN && new_enough(&out, &ids) {
        out.push(Mix { id: "repeat".into(), title: "On Repeat".into(), reason: "The songs you keep coming back to lately".into(), track_ids: ids, kind: "favorites", words: Words::default(), found: Vec::new() });
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
        out.push(Mix { id: format!("artist-{made}"), title: format!("{name} Mix"), reason, track_ids: ids, kind: "favorites", words, found: Vec::new() });
    }

    // Supermix: your favourites over the months, not one day's listens (slow decay on top of the usual score).
    let mut long: HashMap<i64, f64> = taste.score.iter().filter(|(_, s)| **s > 0.0).map(|(id, s)| (*id, *s)).collect();
    for p in &plays {
        *long.entry(p.track_id).or_default() += play_weight(p) * fade(input.now - p.started_at, LONG_HALF_LIFE_DAYS);
    }
    let ids = taste.pick(long.into_iter(), daily_opts);
    if ids.len() >= MIN_LEN && new_enough(&out, &ids) {
        out.push(Mix { id: "supermix".into(), title: "Supermix".into(), reason: "Your favorites over the months".into(), track_ids: ids, kind: "favorites", words: Words::default(), found: Vec::new() });
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
        out.push(Mix { id: "weekday".into(), title: format!("Your {d}s"), reason: format!("What you play on {d}s"), track_ids: ids, kind: "moment", words: Words { day: Some(today), ..Words::default() }, found: Vec::new() });
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
        out.push(Mix { id: "fresh".into(), title: "Fresh in your library".into(), reason: "Just added, barely played yet".into(), track_ids: ids, kind: "explore", words: Words::default(), found: Vec::new() });
    }

    // Hidden gems: in your library, never played here, by artists you like.
    let played: HashSet<&String> = plays.iter().map(|p| &taste.song[&p.track_id]).collect();
    let best = affinity.values().copied().fold(0.0, f64::max).max(1e-9);
    let cands = input.tracks.iter().filter(|t| !played.contains(&taste.song[&t.id])).filter_map(|t| affinity.get(taste.artist[&t.id].as_str()).map(|a| (t.id, a / best + score_of(t.id) * 0.2)));
    let ids = taste.pick(cands, Opts::default());
    if ids.len() >= MIN_LEN && new_enough(&out, &ids) {
        out.push(Mix { id: "gems".into(), title: "Hidden gems".into(), reason: "Saved but never played here, by artists you like".into(), track_ids: ids, kind: "explore", words: Words::default(), found: Vec::new() });
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
        out.push(Mix { id: "rediscover".into(), title: "Rediscover".into(), reason: "Tracks you loved, not played for two months".into(), track_ids: ids, kind: "explore", words: Words::default(), found: Vec::new() });
    }

    // Discoveries last: library picks above stay as `seeds` saw them. Each into the mix its radio came from, once.
    let mut used = HashSet::new();
    let mut out: Vec<Mix> = out
        .into_iter()
        .map(|m| match m.id.as_str() {
            id if id.starts_with("daily-") => taste.blend(m, 3, &mut used),
            id if id.starts_with("artist-") || id == "supermix" => taste.blend(m, 4, &mut used),
            _ => m,
        })
        .collect();
    if let Some(m) = out.iter_mut().find(|m| m.id == "supermix" && !m.found.is_empty()) {
        m.reason = "Your favorites over the months, and new songs like them".into();
    }
    // Discover Mix: new songs only, those no other mix took first.
    let seeds: Vec<i64> = input.found.iter().map(|(s, _)| *s).collect();
    let mut new = taste.discover(&seeds, &used);
    if new.len() < MIN_LEN {
        new = taste.discover(&seeds, &HashSet::new());
    }
    if new.len() >= MIN_LEN {
        let found = new.into_iter().take(MIX_LEN).enumerate().map(|(at, t)| Found { at, track: t.clone() }).collect();
        let mix = Mix { id: "discover".into(), title: "Discover Mix".into(), reason: "New to you, from radios of the songs you love".into(), track_ids: Vec::new(), kind: "explore", words: Words::default(), found };
        let at = out.iter().position(|m| m.kind == "explore").unwrap_or(out.len());
        out.insert(at, mix);
    }
    out
}

/// Songs whose YouTube Music radio brings discoveries: the leading song with a YouTube video of each daily mix, artist
/// mix and the Supermix. (track id, video id), for the shell to fetch into `Input::found`.
pub fn seeds(input: &Input) -> Vec<(i64, String)> {
    let video: HashMap<i64, &str> = input.tracks.iter().filter_map(|t| Some((t.id, t.track.ids.get(&Source::Youtube)?.as_str()))).collect();
    let mut out: Vec<(i64, String)> = Vec::new();
    for m in mixes(&Input { found: &[], ..*input }).iter().filter(|m| m.kind == "daily" || m.id.starts_with("artist-") || m.id == "supermix") {
        if let Some(id) = m.track_ids.iter().find(|id| video.contains_key(id) && !out.iter().any(|(s, _)| s == *id)) {
            out.push((*id, video[id].to_string()));
        }
    }
    out.truncate(SEEDS);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Track;

    const NOW: i64 = 1_800_000_000;

    fn t(id: i64, artist: &str) -> LibraryTrack {
        LibraryTrack { id, added: id, added_at: None, track: Track { title: format!("Song {id}"), artist: artist.into(), ..Default::default() } }
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
        mixes(&Input { tracks, plays, playlists: &[], saved: &[], liked: &[], prefs, now: NOW, utc_offset: 0, seed, found: &[] })
    }

    fn artists(tracks: &[LibraryTrack], m: &Mix) -> BTreeSet<String> {
        m.track_ids.iter().map(|id| tracks.iter().find(|t| t.id == *id).unwrap().track.artist.clone()).collect()
    }

    #[test]
    fn weights_and_decay() {
        let w = |completed, listened_ms, length| play_weight(&Play { track_id: 1, started_at: 0, listened_ms, completed }, length);
        assert!(w(true, 200_000, None) > w(false, 60_000, None) && w(false, 60_000, None) > 0.0 && w(false, 5_000, None) < 0.0);
        // More of the song heard, more weight; earlier skip, worse; one skip stays above the floor.
        assert!(w(false, 150_000, Some(200_000)) > w(false, 40_000, Some(200_000)) && w(false, 40_000, Some(200_000)) > 0.0);
        assert!(w(false, 3_000, None) < w(false, 25_000, None) && w(false, 2_000, None) > FLOOR);
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
    fn talks_never_make_a_mix() {
        let (mut tracks, plays) = library();
        // Charlie's songs turn out to be talks: Charlie and Delta's mix loses them, nobody is "because you listen to" them.
        for t in tracks.iter_mut().filter(|t| t.track.artist == "Charlie") {
            t.track.musicness = Some(Musicness::NotMusic);
        }
        let out = run(&tracks, &plays, &HashMap::new(), 7);
        assert!(out.iter().all(|m| m.track_ids.iter().all(|id| !(7..=9).contains(id)) && !m.reason.contains("Charlie")), "{out:?}");
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
        let out = mixes(&Input { tracks: &tracks, plays: &plays, playlists: &[], saved: &[], liked: &[], prefs: &HashMap::new(), now: day0 + 19 * 3600, utc_offset: 2 * 3600, seed: 1, found: &[] });
        let m = out.iter().find(|m| m.id == "now").expect("time of day mix");
        assert_eq!((m.title.as_str(), m.track_ids.len()), ("Your evenings", 6));
    }

    #[test]
    fn custom_playlists_count_without_history() {
        let tracks: Vec<LibraryTrack> = (1..=6).map(|i| t(i, if i % 2 == 0 { "Even" } else { "Odd" })).collect();
        let out = mixes(&Input { tracks: &tracks, plays: &[], playlists: &[(1..=6).collect()], saved: &[], liked: &[], prefs: &HashMap::new(), now: NOW, utc_offset: 0, seed: 1, found: &[] });
        // Artist, fresh and gems mixes would repeat daily-1 in so small a library: dropped.
        assert_eq!(out.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["daily-1"]);
        assert_eq!(out[0].reason, "Because you listen to Even and Odd");
        assert_eq!((out[0].words.number, out[0].words.names.clone()), (Some(1), vec!["Even".to_string(), "Odd".to_string()]));
    }

    #[test]
    fn liked_songs_make_the_mix_first() {
        // 40 songs, all in one playlist: only 25 fit a mix, the liked ones always among them.
        let tracks = library_of(40, &["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
        let liked: Vec<i64> = (33..=40).collect();
        let out = mixes(&Input { tracks: &tracks, plays: &[], playlists: &[(1..=40).collect()], saved: &[], liked: &liked, prefs: &HashMap::new(), now: NOW, utc_offset: 0, seed: 1, found: &[] });
        let mix: HashSet<i64> = out[0].track_ids.iter().copied().collect();
        assert!(liked.iter().all(|id| mix.contains(id)), "{mix:?}");
        // 300 likes since: these weigh little more than a playlist, the 8 newest likes win.
        let old: Vec<i64> = (1000..1300).chain((1..=8).chain(17..=40)).collect();
        let newest: Vec<i64> = (9..=16).chain(old.clone()).collect();
        let out = mixes(&Input { tracks: &tracks, plays: &[], playlists: &[(1..=40).collect()], saved: &[], liked: &newest, prefs: &HashMap::new(), now: NOW, utc_offset: 0, seed: 1, found: &[] });
        let mix: HashSet<i64> = out[0].track_ids.iter().copied().collect();
        assert!((9..=16).all(|id| mix.contains(&id)), "{mix:?}");
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
        let out = mixes(&Input { tracks: &tracks, plays: &plays, playlists: &[], saved: &saved, liked: &[], prefs: &HashMap::new(), now: NOW, utc_offset: 0, seed: 1, found: &[] });
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

    fn video(title: &str, artist: &str, id: &str) -> Track {
        Track { title: title.into(), artist: artist.into(), ids: BTreeMap::from([(Source::Youtube, id.into())]), ..Default::default() }
    }

    #[test]
    fn uploads_of_one_song_share_a_key() {
        let key = |title: &str, artist: &str| song_key(&video(title, artist, "x"));
        let liv = ("yeat".to_string(), "yeat|liv like dis".to_string());
        assert_eq!(key("Yeat- Liv Like Dis [Reverse Intro] (Slowed + Reverbed)", "Capt. Slowed"), liv);
        assert_eq!(key("yeat - liv like dis [reversed intro] (slowed + reverb + bass boosted)", "bayle"), liv);
        assert_eq!(key("Liv Like Dis", "Yeat"), liv);
        assert_eq!(key("Playboi carti - long time (super slowed + reverb)", "prodby668"), key("Long Time", "Playboi Carti"));
        assert_eq!(key("Cochise- DO4LOVE/GREEDY {First Part Extended} [Reverse Intro] (Slowed + Reverberd)", "Capt. Slowed").1, "cochise|do4love greedy");
        assert_eq!(key("Song slowed + reverb", "Someone").1, "someone|song");
        // Versions named after " - " and released tracks keep their artist.
        assert_eq!(key("Hey Jude - Remastered 2015", "The Beatles").1, "the beatles|hey jude");
        let released = Track { album: Some("Album".into()), ..video("Part One - Part Two", "Band", "x") };
        assert_eq!(song_key(&released).0, "band");
    }

    #[test]
    fn one_version_per_song_and_its_artist_spread() {
        // Two uploads of Yeat's song by slowed channels, Yeat's own, and 9 songs by others: all played a lot.
        let mut tracks = vec![
            LibraryTrack { id: 1, added: 1, added_at: None, track: video("Yeat- Liv Like Dis [Reverse Intro] (Slowed + Reverbed)", "Capt. Slowed", "a1") },
            LibraryTrack { id: 2, added: 2, added_at: None, track: video("yeat - liv like dis [reversed intro] (slowed + reverb + bass boosted)", "bayle", "a2") },
            LibraryTrack { id: 3, added: 3, added_at: None, track: video("Liv Like Dis", "Yeat", "a3") },
        ];
        tracks.extend((4..=12).map(|i| t(i, ["Uno", "Dos", "Tres"][(i % 3) as usize])));
        let plays: Vec<Play> = (1..=12).flat_map(|i| (0..3).map(move |k| play(i, NOW - (k + 1) * DAY + i * 200, true))).collect();
        let mut plays = plays;
        plays.sort_by_key(|p| p.started_at);
        let out = run(&tracks, &plays, &HashMap::new(), 5);
        assert!(!out.is_empty());
        for m in &out {
            assert!(m.track_ids.iter().filter(|id| **id <= 3).count() <= 1, "two versions in {m:?}");
        }
        // Never on one upload: every version stays out.
        let never = run(&tracks, &plays, &HashMap::from([(2, Pref::Never)]), 5);
        assert!(never.iter().all(|m| m.track_ids.iter().all(|id| *id > 3)), "{never:?}");
    }

    #[test]
    fn radios_bring_new_songs_into_mixes() {
        let (mut tracks, plays) = library();
        for t in &mut tracks {
            t.track.ids.insert(Source::Youtube, format!("lib{:08}", t.id));
        }
        let base = Input { tracks: &tracks, plays: &plays, playlists: &[], saved: &[], liked: &[], prefs: &HashMap::new(), now: NOW, utc_offset: 0, seed: 3, found: &[] };
        let seeds = seeds(&base);
        let daily: Vec<Mix> = mixes(&base).into_iter().filter(|m| m.kind == "daily").collect();
        assert!(daily.iter().all(|m| seeds.iter().any(|(id, _)| *id == m.track_ids[0])), "{seeds:?}");
        assert!(seeds.iter().all(|(id, v)| *v == format!("lib{id:08}")));
        // Each radio: the seed, a version of a library song, a talk, then 15 new songs by 5 artists.
        let found: Vec<(i64, Vec<Track>)> = seeds
            .iter()
            .map(|(id, v)| {
                let mut radio = vec![video("Song 1 (sped up)", "Alpha", "v1"), video("How to play guitar", "Teacher", "talk")];
                radio[1].musicness = Some(Musicness::NotMusic);
                radio.insert(0, video(&format!("Song {id}"), "x", v));
                radio.extend((0..15).map(|k| video(&format!("New {id}-{k}"), &format!("Fresh {}", k % 5), &format!("n{id}x{k}"))));
                (*id, radio)
            })
            .collect();
        let out = mixes(&Input { found: &found, ..base });
        let mut seen = HashSet::new();
        for m in out.iter().filter(|m| m.kind == "daily") {
            // Every third song while favourites last (6 here), then discoveries fill up.
            assert_eq!(m.found.iter().map(|f| f.at).take(3).collect::<Vec<_>>(), [2, 5, 8], "{m:?}");
            assert!(m.track_ids.len() + m.found.len() <= MIX_LEN);
            let mut per: HashMap<&str, usize> = HashMap::new();
            for f in &m.found {
                assert!(f.track.title.starts_with("New "), "not new: {:?}", f.track);
                assert!(seen.insert(f.track.title.clone()), "twice: {}", f.track.title);
                *per.entry(f.track.artist.as_str()).or_default() += 1;
            }
            assert!(per.values().all(|n| *n <= NEW_PER_ARTIST), "{per:?}");
            // Library songs unchanged, in order, first song still a favourite.
            let lib = daily.iter().find(|d| d.id == m.id).unwrap();
            assert_eq!(m.track_ids[..], lib.track_ids[..m.track_ids.len()]);
        }
        let d = out.iter().find(|m| m.id == "discover").unwrap_or_else(|| panic!("{out:?}"));
        assert!(d.track_ids.is_empty() && d.found.len() >= MIN_LEN && d.found.iter().all(|f| f.track.title.starts_with("New ")));
        assert_eq!(out.iter().position(|m| m.kind == "explore"), out.iter().position(|m| m.id == "discover"));
        // Signed out or offline: the same mixes as before, no Discover Mix.
        assert!(mixes(&base).iter().all(|m| m.found.is_empty() && m.id != "discover"));
    }

    #[test]
    fn supermix_keeps_favourites_from_months_ago() {
        // 1..=6 loved four months ago, mornings; 7..=12 played twice last week, evenings; one artist each.
        let tracks: Vec<LibraryTrack> = (1..=12).map(|i| t(i, &format!("Artist {i}"))).collect();
        let mut plays: Vec<Play> = (1..=6).flat_map(|i| (0..6).map(move |k| play(i, NOW - 120 * DAY + k * DAY + i * 300, true))).collect();
        plays.extend((7..=12).flat_map(|i| (0..2).map(move |k| play(i, NOW - 7 * DAY + k * DAY + 10 * 3600 + i * 300, true))));
        plays.sort_by_key(|p| p.started_at);
        let out = run(&tracks, &plays, &HashMap::new(), 2);
        let m = out.iter().find(|m| m.id == "supermix").unwrap_or_else(|| panic!("{out:?}"));
        assert!((1..=6).all(|id| m.track_ids.contains(&id)) && (7..=12).all(|id| m.track_ids.contains(&id)), "{m:?}");
        assert_eq!((m.kind, m.reason.as_str()), ("favorites", "Your favorites over the months"));
    }
}
