//! Lyrics: LRC parsing, YouTube titles cleaned for lookup, best record picked, timings fitted to the version playing.
//! "Slowed", "sped up", nightcore… are the same recording at another speed: synced lines are stretched by the ratio of
//! the durations instead of being dropped.

use serde::{Deserialize, Serialize};

/// One synced line. Empty text = instrumental gap.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub ms: u32,
    pub text: String,
    /// When the line ends, when the source says (YouTube Music); LRC gives starts only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_ms: Option<u32>,
}

/// What Now Playing shows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    /// Synced lines; empty = plain only.
    pub lines: Vec<Line>,
    pub plain: Option<String>,
    pub instrumental: bool,
    /// Where they come from, shown under them (LRCLIB, "Source: LyricFind"…).
    pub source: String,
}

/// A lyrics record from a service, before fitting.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Record {
    pub title: String,
    pub artist: String,
    pub duration_s: Option<f32>,
    pub instrumental: bool,
    pub plain: Option<String>,
    pub synced: Option<String>,
}

/// `[mm:ss.xx] text` lines, several stamps per line allowed, `[offset:±ms]` applied, tags skipped. Sorted by time.
pub fn parse_lrc(text: &str) -> Vec<Line> {
    let mut offset: i64 = 0;
    let mut out = Vec::new();
    for raw in text.lines() {
        let mut rest = raw.trim();
        let mut stamps = Vec::new();
        while let Some(body) = rest.strip_prefix('[') {
            let Some(end) = body.find(']') else { break };
            let tag = &body[..end];
            rest = body[end + 1..].trim_start();
            if let Some(v) = tag.strip_prefix("offset:") {
                offset = v.trim().parse().unwrap_or(0);
            } else if let Some(ms) = stamp(tag) {
                stamps.push(ms);
            }
        }
        for ms in stamps {
            // LRC offset: positive = lyrics come sooner.
            out.push(Line { ms: (ms as i64 - offset).max(0) as u32, text: rest.trim().to_string(), end_ms: None });
        }
    }
    out.sort_by_key(|l| l.ms);
    out
}

/// `mm:ss`, `mm:ss.x`, `mm:ss.xx`, `mm:ss.xxx` → ms.
fn stamp(tag: &str) -> Option<u32> {
    let (m, s) = tag.split_once(':')?;
    let m: u32 = m.trim().parse().ok()?;
    let (sec, frac) = s.split_once(['.', ':']).unwrap_or((s, ""));
    let sec: u32 = sec.trim().parse().ok()?;
    if sec >= 60 || !frac.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let frac_ms = match frac.len() {
        0 => 0,
        1 => frac.parse::<u32>().ok()? * 100,
        2 => frac.parse::<u32>().ok()? * 10,
        _ => frac[..3].parse::<u32>().ok()?,
    };
    Some((m * 60 + sec) * 1000 + frac_ms)
}

const SPEED: &[&str] = &["slowed", "sped up", "speed up", "spedup", "nightcore", "daycore"];
const NOISE: &[&str] = &[
    "official", "video", "audio", "lyric", "visuali", "hd", "4k", "remaster", "slowed", "reverb", "sped", "speed", "nightcore", "daycore", "8d", "bass boost", "extended", "tiktok", "music video",
    "mv", "clip", "loop", "1 hour", "edit",
];

/// A version at another speed ("Slowed + Reverb", "sped up", nightcore…): synced lines get stretched.
pub fn speed_changed(title: &str) -> bool {
    let t = title.to_lowercase();
    SPEED.iter().any(|w| t.contains(w))
}

/// Title for lookup: bracketed noise and "| …" tails gone ("Song (Official Video) [Slowed + Reverb]" → "Song").
pub fn clean_title(title: &str) -> String {
    let mut out = String::new();
    let mut depth = 0usize;
    let mut group = String::new();
    for c in title.chars() {
        match c {
            '(' | '[' | '{' => {
                if depth == 0 {
                    group.clear();
                }
                depth += 1;
                group.push(c);
            }
            ')' | ']' | '}' if depth > 0 => {
                depth -= 1;
                group.push(c);
                if depth == 0 {
                    let g = group.to_lowercase();
                    // feat. and real parts stay: "(feat. X)", "(Remix)" carry meaning.
                    if !NOISE.iter().any(|w| g.contains(w)) {
                        out.push_str(&group);
                    }
                }
            }
            _ if depth > 0 => group.push(c),
            _ => out.push(c),
        }
    }
    let out = out.split(" | ").next().unwrap_or("").split(" // ").next().unwrap_or("");
    // Loose tail words: "Song - Slowed", "Song slowed + reverb".
    let lower = out.to_lowercase();
    let cut = SPEED.iter().chain(&["reverb"]).filter_map(|w| lower.find(w)).filter(|&i| i > 0).min();
    let out = cut.map(|i| &out[..i]).unwrap_or(out);
    out.trim().trim_end_matches(['-', '–', '+', ',', '/']).split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Ways to ask for this track, best first: "Artist - Title" read from a YouTube title (uploads by channels name the
/// real artist there), then the track's own artist and title.
pub fn queries(artist: &str, title: &str) -> Vec<(String, String)> {
    let clean = clean_title(title);
    let mut out = Vec::new();
    if let Some((a, t)) = clean.split_once(" - ").or_else(|| clean.split_once(" – ")) {
        let (a, t) = (a.trim(), clean_title(t));
        if !a.is_empty() && !t.is_empty() {
            out.push((a.to_string(), t));
        }
    }
    if !clean.is_empty() && !artist.trim().is_empty() {
        out.push((artist.trim().to_string(), clean.clone()));
        // "A, B & C": records often name the lead artist only.
        let lead = main_artist(artist);
        if lead != artist.trim() {
            out.push((lead.to_string(), clean));
        }
    }
    out.dedup();
    out
}

/// First artist of a credit list ("Princess Chelsea, Videoclub, Mattyeux" → "Princess Chelsea").
pub fn main_artist(artist: &str) -> &str {
    let a = artist.trim();
    // ASCII lowercase keeps byte offsets.
    let lower = a.to_ascii_lowercase();
    let cut = [",", " & ", " x ", " feat", " ft.", " with "].iter().filter_map(|w| lower.find(w)).filter(|&i| i > 0).min();
    cut.map(|i| a[..i].trim()).unwrap_or(a)
}

/// A search answer is about this title (letters and digits only, one holding the other): no other song's lyrics.
pub fn same_title(found: &str, wanted: &str) -> bool {
    let norm = |s: &str| clean_title(s).to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect::<String>();
    let (a, b) = (norm(found), norm(wanted));
    !a.is_empty() && !b.is_empty() && (a.contains(&b) || b.contains(&a))
}

/// Synced lines need durations this close; further, only a speed change explains it (stretched), or plain is used.
const SAME_S: f32 = 3.0;
/// Videos run a few seconds longer than the track (intro, outro, silence): timings still fit, closer records first.
/// User's report 2026-10-22: a 3:33 video against 3:28 records showed plain, unmoving lyrics.
const LOOSE_S: f32 = 10.0;

/// How far a speed change goes: "super / ultra slowed" plays at about half speed (user's report 2026-10-22: a 6:20
/// super slowed of a ~3:30 song), nightcore at about 1.4×.
const SPEEDS: std::ops::RangeInclusive<f32> = 0.4..=2.6;

/// Stretch for this record against what plays (None = timings unusable).
pub fn stretch(record_s: Option<f32>, playing_s: Option<f32>, speed: bool) -> Option<f32> {
    match (record_s, playing_s) {
        (Some(r), Some(p)) if r > 0.0 => {
            if (r - p).abs() <= SAME_S {
                Some(1.0)
            } else if speed && SPEEDS.contains(&(p / r)) {
                Some(p / r)
            } else if !speed && (r - p).abs() <= LOOSE_S {
                Some(1.0)
            } else {
                None
            }
        }
        // Duration unknown: trust it, unless the title says another speed (the timings would run ahead or behind).
        (_, None) => (!speed).then_some(1.0),
        _ => None,
    }
}

/// Best of several records: usable synced lyrics first, then the closest duration, then plain lyrics.
pub fn pick(records: Vec<Record>, playing_s: Option<f32>, speed: bool) -> Option<(Record, Option<f32>)> {
    let score = |r: &Record| {
        let fit = stretch(r.duration_s, playing_s, speed);
        let synced = r.synced.as_deref().is_some_and(|s| !s.trim().is_empty());
        let gap = match (r.duration_s, playing_s) {
            (Some(a), Some(b)) => (a - b).abs(),
            _ => 0.0,
        };
        // Lower is better.
        (!(synced && fit.is_some()), r.plain.is_none() && !r.instrumental, (gap * 10.0) as u32)
    };
    let best = records.into_iter().min_by_key(score)?;
    let fit = stretch(best.duration_s, playing_s, speed);
    Some((best, fit))
}

/// Record → what Now Playing shows.
pub fn build(record: Record, fit: Option<f32>, source: &str) -> Lyrics {
    let lines = match (record.synced.as_deref(), fit) {
        (Some(s), Some(k)) => parse_lrc(s).into_iter().map(|l| Line { ms: (l.ms as f32 * k).round() as u32, ..l }).collect(),
        _ => Vec::new(),
    };
    let plain = record.plain.filter(|p| !p.trim().is_empty()).or_else(|| (!lines.is_empty()).then(|| lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n")));
    Lyrics { lines, plain, instrumental: record.instrumental, source: source.to_string() }
}

/// Plain text cached: asked again after this (LRCLIB gains synced lines over time; a lookup may have failed).
const PLAIN_RETRY_S: i64 = 86_400;

/// Cached answer still good? Synced or instrumental: always. Plain text: a day (user's report 2026-10-26: songs stuck
/// "Not synced").
pub fn keep_cached(l: &Lyrics, age_s: i64) -> bool {
    !l.lines.is_empty() || l.instrumental || age_s < PLAIN_RETRY_S
}

/// Junk record: under 4 sung lines for a song over a minute (user's test 2026-10-24: LRCLIB's exact match for a
/// famous song was one line, "probe"). Skipped so the search's real ones come.
pub fn too_thin(l: &Lyrics, playing_s: Option<f32>) -> bool {
    let sung = |n: usize| n < 4 && playing_s.is_none_or(|p| p > 60.0);
    let plain_lines = l.plain.as_deref().map_or(0, |p| p.lines().filter(|t| !t.trim().is_empty()).count());
    !l.instrumental && sung(l.lines.iter().filter(|x| !x.text.is_empty()).count().max(plain_lines))
}

/// Cache key: who, what, how long (a slowed version is its own entry).
pub fn key(artist: &str, title: &str, duration_ms: Option<u32>) -> String {
    let norm = |s: &str| s.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ");
    // v2 (2026-10-22): slowed versions cached before stretching covered them come again. v3: plain-only results
    // asked again (looser durations, lead artist).
    // v4 (2026-10-24): YouTube Music's timed lyrics (line ends too) come first when signed in.
    format!("v4|{}|{}|{}", norm(artist), norm(title), duration_ms.map(|d| d / 1000).unwrap_or(0))
}

#[cfg(test)]
mod tests {

    #[test]
    fn plain_lyrics_asked_again_after_a_day() {
        let plain = Lyrics { lines: Vec::new(), plain: Some("la".into()), instrumental: false, source: "YouTube Music".into() };
        assert!(keep_cached(&plain, 3600) && !keep_cached(&plain, 2 * 86_400));
        let synced = Lyrics { lines: vec![Line { ms: 0, text: "la".into(), end_ms: None }], ..plain };
        assert!(keep_cached(&synced, 365 * 86_400));
    }

    use super::*;

    #[test]
    fn junk_records_are_too_thin() {
        let probe = build(Record { synced: Some("[00:00.00]probe".into()), plain: Some("probe".into()), ..Default::default() }, Some(1.0), "LRCLIB");
        assert!(too_thin(&probe, Some(214.0)));
        assert!(!too_thin(&probe, Some(30.0)));
        let real = build(Record { synced: Some("[00:01.00]a
[00:02.00]b
[00:03.00]c
[00:04.00]d".into()), ..Default::default() }, Some(1.0), "LRCLIB");
        assert!(!too_thin(&real, Some(214.0)));
        assert!(!too_thin(&Lyrics { lines: vec![], plain: None, instrumental: true, source: String::new() }, Some(200.0)));
    }

    #[test]
    fn reads_lrc() {
        let lrc = "[ar:Someone]\n[offset:+500]\n[00:12.34]First\n[01:02.5][02:00.00]Chorus\n[00:20.123]\n[bad]Nope\n";
        let l = parse_lrc(lrc);
        assert_eq!(l, vec![
            Line { ms: 11_840, text: "First".into(), end_ms: None },
            Line { ms: 19_623, text: "".into(), end_ms: None },
            Line { ms: 62_000, text: "Chorus".into(), end_ms: None },
            Line { ms: 119_500, text: "Chorus".into(), end_ms: None },
        ]);
        assert!(parse_lrc("no stamps here").is_empty());
    }

    #[test]
    fn titles_lose_their_noise() {
        assert_eq!(clean_title("Make U Whole (Slowed + Reverb)"), "Make U Whole");
        assert_eq!(clean_title("Song (Official Music Video) [HD]"), "Song");
        assert_eq!(clean_title("Song (feat. Someone)"), "Song (feat. Someone)");
        assert_eq!(clean_title("Song (Remix)"), "Song (Remix)");
        assert_eq!(clean_title("pyro - slowed"), "pyro");
        assert_eq!(clean_title("Song slowed + reverb"), "Song");
        assert_eq!(clean_title("Title | Lyrics in description"), "Title");
        assert!(speed_changed("CALA BONITA (Slowed) (Gojo edit)"));
        assert!(!speed_changed("Warriors"));
    }

    #[test]
    fn youtube_titles_give_artist_and_title() {
        assert_eq!(queries("Capt. Slowed", "Andronicus - Make U Whole (Slowed + Reverb)"), vec![("Andronicus".into(), "Make U Whole".into()), ("Capt. Slowed".into(), "Andronicus - Make U Whole".into())]);
        assert_eq!(queries("Imagine Dragons", "Warriors"), vec![("Imagine Dragons".into(), "Warriors".into())]);
        assert_eq!(queries("Daft Punk", "Daft Punk - One More Time (Official Video)")[0], ("Daft Punk".into(), "One More Time".into()));
        assert_eq!(queries("Princess Chelsea, Videoclub, Mattyeux", "Sometimes")[1], ("Princess Chelsea".into(), "Sometimes".into()));
        assert_eq!(main_artist("Mattyeux & Princess Chelsea"), "Mattyeux");
        assert_eq!(main_artist("Xavier"), "Xavier");
    }

    fn rec(d: f32, synced: bool) -> Record {
        Record { duration_s: Some(d), synced: synced.then(|| "[00:10.00]a\n[00:20.00]b".into()), plain: Some("a\nb".into()), ..Default::default() }
    }

    #[test]
    fn slowed_versions_get_stretched_timings() {
        assert_eq!(stretch(Some(200.0), Some(201.5), false), Some(1.0));
        assert_eq!(stretch(Some(200.0), Some(250.0), true), Some(1.25));
        assert_eq!(stretch(Some(200.0), Some(250.0), false), None);
        // Video a few seconds longer than the record: same timings.
        assert_eq!(stretch(Some(208.0), Some(213.0), false), Some(1.0));
        assert_eq!(stretch(Some(200.0), Some(600.0), true), None);
        // Super slowed: 3:32 played as 6:20.
        assert_eq!(stretch(Some(212.0), Some(380.0), true).map(|k| (k * 100.0).round()), Some(179.0));
        // Unknown length: fine as is, not for a slowed version.
        assert_eq!(stretch(Some(200.0), None, false), Some(1.0));
        assert_eq!(stretch(Some(200.0), None, true), None);
        let (r, fit) = pick(vec![rec(180.0, true), rec(200.0, true)], Some(250.0), true).unwrap();
        assert_eq!((r.duration_s, fit), (Some(200.0), Some(1.25)));
        let l = build(r, fit, "LRCLIB");
        assert_eq!(l.lines.iter().map(|x| x.ms).collect::<Vec<_>>(), vec![12_500, 25_000]);
    }

    #[test]
    fn search_answers_must_be_the_same_song() {
        assert!(same_title("Make U Whole", "Make U Whole"));
        assert!(same_title("Make U Whole (Remastered)", "make u whole"));
        assert!(same_title("я не счастлив", "Я не счастлив (slowed)"));
        assert!(!same_title("Another Song", "Make U Whole"));
        assert!(!same_title("", "x"));
    }

    #[test]
    fn plain_when_timings_cant_fit() {
        let (r, fit) = pick(vec![rec(100.0, true)], Some(300.0), false).unwrap();
        let l = build(r, fit, "LRCLIB");
        assert!(l.lines.is_empty());
        assert_eq!(l.plain.as_deref(), Some("a\nb"));
        // Synced beats plain-only at the same fit.
        let plain_only = Record { synced: None, ..rec(200.0, false) };
        assert!(pick(vec![plain_only, rec(201.0, true)], Some(200.0), false).unwrap().0.synced.is_some());
        assert_eq!(key("Daft  Punk", "One More Time", Some(320_500)), "v4|daft punk|one more time|320");
    }
}
