//! A list of songs typed, pasted or saved as text (Add › Import a list of songs): one song per line ("Artist - Title",
//! "Title by Artist", numbered or not, durations and counts around), or a CSV / TSV with a title column and an artist
//! column (exports from other services). Nothing is looked up here: the shell finds each one on YouTube, `pick` says
//! which result is it.

use crate::matching::{best_match, normalize};
use crate::model::Track;

/// Songs read from one list, at most.
pub const MAX_SONGS: usize = 2000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Wanted {
    /// Empty when the line gave a title only.
    pub artist: String,
    pub title: String,
}

/// The songs in `text`, in order, each once.
pub fn parse(text: &str) -> Vec<Wanted> {
    let text = text.trim_start_matches('\u{feff}');
    let mut out: Vec<Wanted> = match csv(text) {
        Some(rows) => rows,
        None => text.lines().filter_map(line).collect(),
    };
    let mut seen = std::collections::HashSet::new();
    out.retain(|w| seen.insert((normalize(&w.artist), normalize(&w.title))));
    out.truncate(MAX_SONGS);
    out
}

/// CSV / TSV with a header naming a title column (and an artist one): its rows. Else None (plain lines).
fn csv(text: &str) -> Option<Vec<Wanted>> {
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());
    let head = lines.next()?;
    let sep = [',', ';', '\t'].into_iter().max_by_key(|s| head.matches(*s).count()).filter(|s| head.contains(*s))?;
    let cols: Vec<String> = cells(head, sep).iter().map(|c| c.to_lowercase()).collect();
    let find = |names: &[&str]| cols.iter().position(|c| names.iter().any(|n| c == n || c.starts_with(&format!("{n} ")) || c.starts_with(&format!("{n}("))));
    let title = find(&["title", "track name", "track", "song", "name", "titre"])?;
    let artist = find(&["artist", "artist name(s)", "artist name", "artists", "artiste", "artistes"]);
    Some(
        lines
            .filter_map(|l| {
                let row = cells(l, sep);
                let title = row.get(title)?.trim().to_string();
                let artist = artist.and_then(|a| row.get(a)).map_or(String::new(), |a| a.trim().to_string());
                (!title.is_empty() && title.chars().count() <= 300 && artist.chars().count() <= 300).then_some(Wanted { artist, title })
            })
            .collect(),
    )
}

/// One CSV row: separator outside quotes, "" = a quote inside.
fn cells(line: &str, sep: char) -> Vec<String> {
    let mut out = vec![String::new()];
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                chars.next();
                out.last_mut().unwrap().push('"');
            }
            '"' => quoted = !quoted,
            c if c == sep && !quoted => out.push(String::new()),
            c => out.last_mut().unwrap().push(c),
        }
    }
    out
}

/// 3:45, 1:02:03.
fn is_duration(s: &str) -> bool {
    let parts: Vec<&str> = s.split(':').collect();
    (2..=3).contains(&parts.len()) && parts.iter().all(|p| !p.is_empty() && p.len() <= 2 && p.bytes().all(|b| b.is_ascii_digit()))
}

/// A line that is no song: a count (1.2M, 12,345), a duration, a lone number.
fn noise(s: &str) -> bool {
    let core = s.trim_end_matches(['K', 'k', 'M', 'm', 'B', 'b']);
    s.chars().count() < 2 || is_duration(s) || (!core.is_empty() && core.chars().all(|c| c.is_ascii_digit() || c == '.' || c == ',' || c == ' '))
}

/// One plain line: numbering and durations taken off, then "Artist - Title" or "Title by Artist" or a title alone.
fn line(raw: &str) -> Option<Wanted> {
    let mut s = raw.trim();
    // "12. ", "12) ", "12: ", "#12 " in front. "12 Title" and "1999 - Prince" stay: the number may be the song's.
    let hash = s.starts_with('#');
    let body = s.trim_start_matches('#');
    let digits = body.bytes().take_while(u8::is_ascii_digit).count();
    if (1..=4).contains(&digits) {
        let rest = &body[digits..];
        let marked = rest.strip_prefix(['.', ')', ':']).filter(|r| r.starts_with(' ')).or_else(|| hash.then_some(rest).filter(|r| r.starts_with(' ')));
        if let Some(r) = marked {
            s = r.trim_start();
        }
    }
    // A duration at the end: "Title 3:45", "Title (3:45)".
    if let Some((head, tail)) = s.rsplit_once(char::is_whitespace)
        && is_duration(tail.trim_matches(['(', ')', '[', ']']))
    {
        s = head.trim_end();
    }
    if noise(s) || s.chars().count() > 300 {
        return None;
    }
    for sep in [" - ", " – ", " — ", " | "] {
        if let Some((a, t)) = s.split_once(sep) {
            let (a, t) = (a.trim(), t.trim());
            if !a.is_empty() && !t.is_empty() {
                return Some(Wanted { artist: a.to_string(), title: t.to_string() });
            }
        }
    }
    if let Some((t, a)) = s.rsplit_once(" by ")
        && !t.trim().is_empty()
        && !a.trim().is_empty()
    {
        return Some(Wanted { artist: a.trim().to_string(), title: t.trim().to_string() });
    }
    Some(Wanted { artist: String::new(), title: s.to_string() })
}

/// The search result that is the song asked for. Same title and artist first (either way round: lists are typed by
/// hand), else the first result whose title holds the one asked for.
pub fn pick<'a>(w: &Wanted, found: &'a [Track]) -> Option<&'a Track> {
    let asked = |artist: &str, title: &str| Track { artist: artist.to_string(), title: title.to_string(), ..Default::default() };
    if !w.artist.is_empty()
        && let Some(hit) = best_match(&asked(&w.artist, &w.title), found).or_else(|| best_match(&asked(&w.title, &w.artist), found))
    {
        return Some(hit);
    }
    let holds = |title: &str| {
        let (got, want) = (normalize(title), normalize(&w.title));
        let other = normalize(&w.artist);
        !want.is_empty() && (got.contains(&want) || (!other.is_empty() && got.contains(&other)))
    };
    found.iter().find(|c| holds(&c.title))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(artist: &str, title: &str) -> Wanted {
        Wanted { artist: artist.into(), title: title.into() }
    }

    #[test]
    fn reads_plain_lines() {
        let text = "\u{feff}1. Daft Punk - Get Lucky\n\n02) Stromae – Alors on danse 3:35\nHello by Adele\n#4 Nightcall (4:18)\n1.2M\n3:45\nDaft Punk - Get Lucky\n";
        assert_eq!(parse(text), vec![w("Daft Punk", "Get Lucky"), w("Stromae", "Alors on danse"), w("Adele", "Hello"), w("", "Nightcall")]);
        // A title that starts with a number keeps it.
        assert_eq!(parse("22 Acacia Avenue"), vec![w("", "22 Acacia Avenue")]);
        assert_eq!(parse("1999 - Prince"), vec![w("1999", "Prince")]);
    }

    #[test]
    fn reads_csv_exports() {
        let text = "Track Name,Artist Name(s),Album Name\n\"Get Lucky (feat. Pharrell Williams, Nile Rodgers)\",Daft Punk,Random Access Memories\nHello,Adele,25\n,Nobody,x\n";
        assert_eq!(parse(text), vec![w("Daft Punk", "Get Lucky (feat. Pharrell Williams, Nile Rodgers)"), w("Adele", "Hello")]);
        assert_eq!(parse("Titre;Artiste\nAlors on danse;Stromae"), vec![w("Stromae", "Alors on danse")]);
        assert_eq!(parse("title\tartist\nHello\tAdele"), vec![w("Adele", "Hello")]);
        // A line with commas but no header: plain lines.
        assert_eq!(parse("Crosby, Stills & Nash - Helplessly Hoping"), vec![w("Crosby, Stills & Nash", "Helplessly Hoping")]);
    }

    #[test]
    fn picks_the_song_asked_for() {
        let t = |artist: &str, title: &str| Track { artist: artist.into(), title: title.into(), ..Default::default() };
        let found = vec![t("Someone", "Get Lucky (Cover)"), t("Daft Punk", "Get Lucky"), t("Adele", "Hello")];
        assert_eq!(pick(&w("Daft Punk", "Get Lucky"), &found).unwrap().artist, "Daft Punk");
        // Typed the other way round.
        assert_eq!(pick(&w("Get Lucky", "Daft Punk"), &found).unwrap().artist, "Daft Punk");
        // Title alone: the first result holding it.
        assert_eq!(pick(&w("", "get lucky"), &found).unwrap().artist, "Someone");
        assert!(pick(&w("", "Nothing like it"), &found).is_none());
    }
}
