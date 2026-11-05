//! Lyrics: LRC parsing, YouTube titles cleaned for lookup, best record picked, timings fitted to the version playing.
//! "Slowed", "sped up", nightcore… are the same recording at another speed: synced lines are stretched by the ratio of
//! the durations instead of being dropped. Word timings when the source has them: enhanced LRC's `<mm:ss.xx>` stamps,
//! LRCLIB's Lyricsfile (YAML, https://lrclib.net/lyricsfile).

use serde::{Deserialize, Serialize};
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

/// One synced line. Empty text = instrumental gap.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "LyricLine")]
pub struct Line {
    pub ms: u32,
    pub text: String,
    /// When the line ends, when the source says (YouTube Music); LRC gives starts only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_ms: Option<u32>,
    /// Its words with their times, when the source has them: each filled as it is sung.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<Word>>,
}

/// One timed word (or part of one) of a line: its text with the spaces around it, when it starts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "LyricWord")]
pub struct Word {
    pub ms: u32,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_ms: Option<u32>,
}

impl Line {
    /// Every time × `k` (a slowed or sped-up version playing).
    fn stretched(self, k: f32) -> Line {
        let at = |ms: u32| (ms as f32 * k).round() as u32;
        let words = self.words.map(|ws| ws.into_iter().map(|w| Word { ms: at(w.ms), end_ms: w.end_ms.map(at), ..w }).collect());
        Line { ms: at(self.ms), end_ms: self.end_ms.map(at), words, ..self }
    }
}

/// What Now Playing shows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Lyrics {
    /// Synced lines; empty = plain only.
    pub lines: Vec<Line>,
    pub plain: Option<String>,
    pub instrumental: bool,
    /// Where they come from, shown under them (LRCLIB, "Source: LyricFind"…).
    pub source: String,
    /// From the song's own file (its tag, or the LRC beside it): `source` empty.
    #[serde(default)]
    pub own: bool,
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
    /// A Lyricsfile with word timings (LRCLIB's, kept only when it says it has them).
    pub lyricsfile: Option<String>,
}

/// `[mm:ss.xx] text` lines, several stamps per line allowed, `[offset:±ms]` applied, tags skipped. Sorted by time.
/// Enhanced LRC's `<mm:ss.xx>` word stamps become the line's words (a line sung at several stamps keeps its text only:
/// word stamps are absolute).
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
        // LRC offset: positive = lyrics come sooner.
        let at = |ms: u32| (ms as i64 - offset).max(0) as u32;
        let words = stamps.first().and_then(|&s| lrc_words(rest, s));
        let text = match &words {
            Some(ws) => ws.iter().map(|w| w.text.as_str()).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" "),
            None => rest.trim().to_string(),
        };
        let words = words.filter(|_| stamps.len() == 1).map(|ws| ws.into_iter().map(|w| Word { ms: at(w.ms), end_ms: w.end_ms.map(at), ..w }).collect::<Vec<_>>());
        for ms in stamps {
            out.push(Line { ms: at(ms), text: text.clone(), end_ms: None, words: words.clone() });
        }
    }
    out.sort_by_key(|l| l.ms);
    out
}

/// A line's `<mm:ss.xx>` word stamps: each word from its stamp, the text before the first one from the line's `start`,
/// a stamp after the last word its end. None = no word stamp (`<` in plain text stays text).
fn lrc_words(rest: &str, start: u32) -> Option<Vec<Word>> {
    let mut words: Vec<Word> = Vec::new();
    let (mut from, mut at, mut seen) = (0, start, false);
    let mut i = 0;
    while let Some(open) = rest[i..].find('<').map(|o| o + i) {
        let Some(close) = rest[open..].find('>').map(|c| c + open) else { break };
        let Some(ms) = stamp(&rest[open + 1..close]) else {
            i = open + 1;
            continue;
        };
        let piece = &rest[from..open];
        if !piece.trim().is_empty() {
            words.push(Word { ms: at, text: piece.to_string(), end_ms: None });
        }
        (from, at, seen, i) = (close + 1, ms, true, close + 1);
    }
    if !seen {
        return None;
    }
    let tail = &rest[from..];
    if !tail.trim().is_empty() {
        words.push(Word { ms: at, text: tail.to_string(), end_ms: None });
    } else if let Some(last) = words.last_mut() {
        last.end_ms = Some(at).filter(|&e| e >= last.ms);
    }
    (!words.is_empty()).then_some(words)
}

/// Most a Lyricsfile may weigh here: a long song's word-synced file is ~100 kB.
const LYRICSFILE_MAX: usize = 512 * 1024;

/// Lyricsfile 1.0, the parts read (unknown fields such as `metadata` and `plain` skipped).
#[derive(Deserialize)]
struct LyricsFile {
    version: String,
    #[serde(default)]
    lines: Vec<FileLine>,
}

#[derive(Deserialize)]
struct FileLine {
    // Missing: from the words, or an instrumental gap.
    #[serde(default)]
    text: String,
    start_ms: u32,
    end_ms: Option<u32>,
    #[serde(default)]
    words: Vec<FileWord>,
}

#[derive(Deserialize)]
struct FileWord {
    text: String,
    start_ms: u32,
    end_ms: Option<u32>,
}

/// Synced lines of a Lyricsfile (draft 1.0, CC0), words kept. None = another version (the draft says not to guess),
/// malformed, over `LYRICSFILE_MAX`, or no line. Sorted by start; overlapping lines stay (the format allows them).
pub fn parse_lyricsfile(doc: &str) -> Option<Vec<Line>> {
    if doc.len() > LYRICSFILE_MAX {
        return None;
    }
    let file: LyricsFile = serde_saphyr::from_str(doc).ok()?;
    if file.version != "1.0" {
        return None;
    }
    let mut lines: Vec<Line> = file
        .lines
        .into_iter()
        .map(|l| {
            let mut words: Vec<Word> = l.words.into_iter().map(|w| Word { end_ms: w.end_ms.filter(|&e| e >= w.start_ms), ms: w.start_ms, text: w.text }).collect();
            words.sort_by_key(|w| w.ms);
            let text = if l.text.trim().is_empty() { words.iter().map(|w| w.text.as_str()).collect::<String>() } else { l.text };
            Line { ms: l.start_ms, text: text.trim().to_string(), end_ms: l.end_ms.filter(|&e| e >= l.start_ms), words: (!words.is_empty()).then_some(words) }
        })
        .collect();
    lines.sort_by_key(|l| l.ms);
    (!lines.is_empty()).then_some(lines)
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

/// Best of several records: usable synced lyrics first, word-synced ones before the rest, then the closest duration,
/// then plain lyrics.
pub fn pick(records: Vec<Record>, playing_s: Option<f32>, speed: bool) -> Option<(Record, Option<f32>)> {
    let score = |r: &Record| {
        let fit = stretch(r.duration_s, playing_s, speed);
        let worded = r.lyricsfile.as_deref().and_then(parse_lyricsfile).is_some();
        let synced = worded || r.synced.as_deref().is_some_and(|s| !s.trim().is_empty());
        let gap = match (r.duration_s, playing_s) {
            (Some(a), Some(b)) => (a - b).abs(),
            _ => 0.0,
        };
        // Lower is better.
        (!(synced && fit.is_some()), !worded, r.plain.is_none() && !r.instrumental, (gap * 10.0) as u32)
    };
    let best = records.into_iter().min_by_key(score)?;
    let fit = stretch(best.duration_s, playing_s, speed);
    Some((best, fit))
}

/// Record → what Now Playing shows. A Lyricsfile's word timings before the LRC's lines.
pub fn build(record: Record, fit: Option<f32>, source: &str) -> Lyrics {
    let lines = match fit {
        Some(k) => record.lyricsfile.as_deref().and_then(parse_lyricsfile).or_else(|| record.synced.as_deref().map(parse_lrc)).unwrap_or_default().into_iter().map(|l| l.stretched(k)).collect(),
        None => Vec::new(),
    };
    let plain = record.plain.filter(|p| !p.trim().is_empty()).or_else(|| (!lines.is_empty()).then(|| lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n")));
    Lyrics { lines, plain, instrumental: record.instrumental, source: source.to_string(), own: false }
}

/// An LRC header tag (`[ar:…]`, `[ti:…]`, `[length:…]`…): not a lyric. Section names (`[Chorus]`) are.
fn header_tag(line: &str) -> bool {
    let tag = line.trim().strip_prefix('[').and_then(|t| t.strip_suffix(']')).and_then(|t| t.split_once(':'));
    tag.is_some_and(|(k, _)| matches!(k.trim().to_ascii_lowercase().as_str(), "ar" | "al" | "ti" | "au" | "by" | "re" | "ve" | "length" | "offset" | "tool" | "#"))
}

/// The song's own lyrics (its tag, or the LRC beside it) → what Now Playing shows: timed when the text has stamps
/// (enhanced LRC's word stamps too), plain otherwise, header tags left out. Never stretched: the file's timings are
/// its own. None = no words in it.
pub fn from_file(text: &str) -> Option<Lyrics> {
    let lines = parse_lrc(text);
    let plain = match lines.is_empty() {
        true => text.lines().filter(|l| !header_tag(l)).collect::<Vec<_>>().join("\n").trim().to_string(),
        false => lines.iter().map(|l| l.text.as_str()).filter(|t| !t.is_empty()).collect::<Vec<_>>().join("\n"),
    };
    (!plain.is_empty()).then(|| Lyrics { lines, plain: Some(plain), instrumental: false, source: String::new(), own: true })
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
    // v5 (2026-11-01): word timings from LRCLIB's Lyricsfile.
    format!("v5|{}|{}|{}", norm(artist), norm(title), duration_ms.map(|d| d / 1000).unwrap_or(0))
}

/// The "artist|title" part of a cache key (any version), to find its song again.
pub fn key_song(key: &str) -> Option<&str> {
    Some(key.split_once('|')?.1.rsplit_once('|')?.0)
}

/// A library song whose cached lyrics hold what was typed (the search page's "In the lyrics").
#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LyricHit {
    pub track_id: i64,
    /// The sung line it starts on, as written.
    pub line: String,
}

/// Shortest text looked for in lyrics, in characters once folded: a shorter one is in half the songs.
pub const MIN_PHRASE: usize = 5;

/// Searchable form: lowercase, no accents, words split by one space, punctuation gone.
pub fn fold(s: &str) -> String {
    let s: String = s.nfkd().filter(|c| !is_combining_mark(*c)).collect::<String>().to_lowercase();
    s.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ")
}

/// The line (as written) where `phrase` (folded) starts in these lyrics: at a word's start, maybe running on into the
/// next lines; the last word may be cut short (still typing). Synced lines, else the plain text.
pub fn line_holding(l: &Lyrics, phrase: &str) -> Option<String> {
    if phrase.is_empty() {
        return None;
    }
    let synced: Vec<&str> = l.lines.iter().map(|x| x.text.as_str()).collect();
    let lines: Vec<&str> = if synced.iter().any(|t| !t.trim().is_empty()) { synced } else { l.plain.as_deref().map(|p| p.lines().collect()).unwrap_or_default() };
    // One text, a space before each line; where each line starts in it.
    let mut text = String::new();
    let mut starts = Vec::new();
    for line in lines {
        let f = fold(line);
        if !f.is_empty() {
            starts.push((text.len(), line));
            text.push(' ');
            text.push_str(&f);
        }
    }
    let at = text.find(&format!(" {phrase}"))?;
    starts.iter().rev().find(|(s, _)| *s <= at).map(|(_, line)| line.trim().to_string())
}

#[cfg(test)]
mod tests {

    #[test]
    fn plain_lyrics_asked_again_after_a_day() {
        let plain = Lyrics { lines: Vec::new(), plain: Some("la".into()), instrumental: false, source: "YouTube Music".into(), own: false };
        assert!(keep_cached(&plain, 3600) && !keep_cached(&plain, 2 * 86_400));
        let synced = Lyrics { lines: vec![Line { ms: 0, text: "la".into(), end_ms: None, words: None }], ..plain };
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
        assert!(!too_thin(&Lyrics { lines: vec![], plain: None, instrumental: true, source: String::new(), own: false }, Some(200.0)));
    }

    #[test]
    fn reads_lrc() {
        let lrc = "[ar:Someone]\n[offset:+500]\n[00:12.34]First\n[01:02.5][02:00.00]Chorus\n[00:20.123]\n[bad]Nope\n";
        let l = parse_lrc(lrc);
        assert_eq!(l, vec![
            Line { ms: 11_840, text: "First".into(), end_ms: None, words: None },
            Line { ms: 19_623, text: "".into(), end_ms: None, words: None },
            Line { ms: 62_000, text: "Chorus".into(), end_ms: None, words: None },
            Line { ms: 119_500, text: "Chorus".into(), end_ms: None, words: None },
        ]);
        assert!(parse_lrc("no stamps here").is_empty());
    }

    #[test]
    fn the_songs_own_lyrics_timed_or_plain() {
        let timed = from_file("[ar:Someone]\n[00:01.00]One\n[00:03.50]\n[00:04.00]<00:04.00>Two <00:04.50>words").unwrap();
        assert_eq!((timed.lines.len(), timed.plain.as_deref(), timed.own, timed.source.as_str()), (3, Some("One\nTwo words"), true, ""));
        assert_eq!(timed.lines[2].words.as_ref().map(Vec::len), Some(2));
        // No stamps: plain, its header tags out, its sections in.
        let plain = from_file("[ti:Song]\r\n[Chorus]\r\nLa la\r\n[Chorus: Someone]\r\n").unwrap();
        assert_eq!((plain.lines.len(), plain.plain.as_deref()), (0, Some("[Chorus]\nLa la\n[Chorus: Someone]")));
        assert_eq!(from_file("[ar:Someone]\n[length: 03:20]\n \n"), None);
        assert_eq!(from_file("[00:01.00]\n[00:02.00]"), None);
    }

    fn w(ms: u32, text: &str, end_ms: Option<u32>) -> Word {
        Word { ms, text: text.into(), end_ms }
    }

    #[test]
    fn reads_enhanced_lrc_word_stamps() {
        let l = parse_lrc("[offset:+100]\n[00:12.00]<00:12.00>Hello <00:12.50>world<00:13.10>\n[00:20.00]Oh <00:20.60>yeah\n[00:30.00]I <3 you\n[00:40.00][00:50.00]<00:40.00>Twice <00:40.50>sung");
        assert_eq!(l[0].text, "Hello world");
        assert_eq!(l[0].words, Some(vec![w(11_900, "Hello ", None), w(12_400, "world", Some(13_000))]));
        // Before the first stamp: from the line's start.
        assert_eq!(l[1].words, Some(vec![w(19_900, "Oh ", None), w(20_500, "yeah", None)]));
        // Not a stamp: text.
        assert_eq!((l[2].text.as_str(), &l[2].words), ("I <3 you", &None));
        // Sung at two stamps: absolute word times would be wrong for one of them.
        assert_eq!((l[3].text.as_str(), &l[3].words, l[4].text.as_str()), ("Twice sung", &None, "Twice sung"));
    }

    const STILL_ALIVE: &str = "version: \"1.0\"\nmetadata:\n  title: Still Alive\n  duration_ms: 176457\nlines:\n  - text: This was a triumph.\n    words:\n      - text: \"This \"\n        start_ms: 290\n      - text: \"was \"\n        start_ms: 536\n      - text: triumph.\n        start_ms: 923\n        end_ms: 3000\n    start_ms: 290\n    end_ms: 3840\n  - text: 'Overlapping, no words'\n    start_ms: 3000\nplain: |\n  This was a triumph.\n";

    #[test]
    fn reads_a_lyricsfile_with_its_words() {
        let lines = parse_lyricsfile(STILL_ALIVE).unwrap();
        assert_eq!(lines.len(), 2);
        assert_eq!((lines[0].ms, lines[0].end_ms, lines[0].text.as_str()), (290, Some(3840), "This was a triumph."));
        assert_eq!(lines[0].words, Some(vec![w(290, "This ", None), w(536, "was ", None), w(923, "triumph.", Some(3000))]));
        assert_eq!((lines[1].ms, lines[1].end_ms, &lines[1].words), (3000, None, &None));
        // The version unquoted (a YAML number) reads the same.
        assert_eq!(parse_lyricsfile(&STILL_ALIVE.replace("\"1.0\"", "1.0")), Some(lines));
        // Another version, broken YAML, no lines, too big: not read.
        assert!(parse_lyricsfile(&STILL_ALIVE.replace("\"1.0\"", "\"2.0\"")).is_none());
        assert!(parse_lyricsfile("version: '1.0'\nlines: [").is_none());
        assert!(parse_lyricsfile("version: '1.0'\nplain: la").is_none());
        assert!(parse_lyricsfile(&format!("{STILL_ALIVE}#{}", "x".repeat(LYRICSFILE_MAX))).is_none());
        // An alias storm stops at the parser's limits instead of filling the memory.
        let mut storm = String::from("version: '1.0'\na: &a [x, x, x, x, x, x, x, x, x, x]\n");
        for i in 1..12 {
            storm.push_str(&format!("a{i}: &a{i} [*a{p}, *a{p}, *a{p}, *a{p}, *a{p}, *a{p}, *a{p}, *a{p}, *a{p}, *a{p}]\n", p = if i == 1 { String::new() } else { (i - 1).to_string() }));
        }
        assert!(parse_lyricsfile(&storm).is_none());
    }

    #[test]
    fn a_lyricsfile_wins_and_stretches_with_its_words() {
        let rec = Record { synced: Some("[00:00.29]This was a triumph.".into()), lyricsfile: Some(STILL_ALIVE.into()), ..Default::default() };
        let l = build(rec.clone(), Some(2.0), "LRCLIB");
        assert_eq!((l.lines[0].ms, l.lines[0].end_ms), (580, Some(7680)));
        assert_eq!(l.lines[0].words.as_ref().unwrap()[2], w(1846, "triumph.", Some(6000)));
        // A Lyricsfile that can't be read: the LRC.
        let l = build(Record { lyricsfile: Some("version: '9'".into()), ..rec }, Some(1.0), "LRCLIB");
        assert_eq!((l.lines.len(), &l.lines[0].words), (1, &None));
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
        assert_eq!(key("Daft  Punk", "One More Time", Some(320_500)), "v5|daft punk|one more time|320");
    }

    #[test]
    fn a_typed_line_finds_its_place_in_the_lyrics() {
        let line = |text: &str| Line { ms: 0, text: text.into(), end_ms: None, words: None };
        let l = Lyrics { lines: vec![line("Été, l’été !"), line(""), line("Under the bridge,"), line("down by the river")], plain: None, instrumental: false, source: String::new(), own: false };
        assert_eq!(fold("  L’ÉTÉ, déjà! "), "l ete deja");
        // Accents, case and punctuation aside; across a line break; the last word cut short.
        assert_eq!(line_holding(&l, &fold("ete l'ete")).as_deref(), Some("Été, l’été !"));
        assert_eq!(line_holding(&l, &fold("bridge down by")).as_deref(), Some("Under the bridge,"));
        assert_eq!(line_holding(&l, "down by the riv").as_deref(), Some("down by the river"));
        // Words start where they start: "own" isn't in "down".
        assert_eq!(line_holding(&l, "own by"), None);
        assert_eq!(line_holding(&l, ""), None);
        // Plain lyrics when nothing is synced.
        let plain = Lyrics { lines: Vec::new(), plain: Some("First line\nSecond one here".into()), ..l };
        assert_eq!(line_holding(&plain, "second one").as_deref(), Some("Second one here"));
        // A cache key's song, whatever its version.
        assert_eq!(key_song(&key("Daft Punk", "One | More", Some(3_000))), Some("daft punk|one | more"));
        assert_eq!(key_song("v2|a|b|200"), Some("a|b"));
        assert_eq!(key_song("nothing"), None);
    }
}
