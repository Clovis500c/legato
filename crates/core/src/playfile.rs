//! Playlists as files, in and out: M3U / M3U8 (`#EXTINF`), XSPF and CSV. Read: each entry's names, length and location
//! (a file path or a link) as written; the shell takes a library file or a YouTube link as is and searches the rest by
//! name (`songlist`). Written: local songs by path, the others by their page. A file the user picked: bounded.

use crate::local::from_name;
use crate::model::{Source, Track, youtube_art};
use crate::songlist::{MAX_SONGS, Wanted, cells};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

const MAX_TEXT: usize = 300;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// Empty when the file named a title only.
    pub artist: String,
    pub title: String,
    pub secs: Option<u32>,
    /// A file path, a `file://` URI or a link, as written.
    pub location: Option<String>,
}

/// A song to write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Row {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub secs: Option<u32>,
    pub location: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    M3u,
    Xspf,
    Csv,
}

impl Format {
    /// By the file's extension.
    pub fn of(path: &Path) -> Option<Self> {
        match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "m3u" | "m3u8" => Some(Self::M3u),
            "xspf" => Some(Self::Xspf),
            "csv" => Some(Self::Csv),
            _ => None,
        }
    }
}

fn clean(s: &str) -> Option<String> {
    let s = s.trim();
    (!s.is_empty() && s.chars().count() <= MAX_TEXT && !s.chars().any(char::is_control)).then(|| s.to_string())
}

/// A location worth keeping: a link or a path, one line, bounded.
fn place(s: &str) -> Option<String> {
    let s = s.trim();
    (!s.is_empty() && s.len() <= 2048 && !s.chars().any(char::is_control)).then(|| s.to_string())
}

/// "Artist - Title", the M3U habit; a title alone otherwise.
fn names(text: &str) -> (String, String) {
    match text.split_once(" - ") {
        Some((a, t)) if clean(a).is_some() && clean(t).is_some() => (a.trim().to_string(), t.trim().to_string()),
        _ => (String::new(), text.trim().to_string()),
    }
}

/// "C:\Music\a.mp3", "/home/me/a.flac", "\\server\share\a.mp3", "https://…", "file:///…".
fn looks_like_place(s: &str) -> bool {
    let b = s.as_bytes();
    s.contains("://") || s.starts_with('/') || s.starts_with("\\\\") || (b.len() > 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/'))
}

/// The songs of an M3U / M3U8: `#EXTINF:secs,Artist - Title` before each location. Without `#EXTM3U`, only when every
/// line is a location or a comment (a plain list of songs is not one).
fn m3u(text: &str) -> Option<Vec<Entry>> {
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let tagged = lines.first().is_some_and(|l| l.starts_with("#EXTM3U"));
    if !tagged && (lines.is_empty() || !lines.iter().all(|l| l.starts_with('#') || looks_like_place(l))) {
        return None;
    }
    let mut out = Vec::new();
    let mut info: Option<(Option<u32>, String)> = None;
    for l in lines {
        if let Some(rest) = l.strip_prefix("#EXTINF:") {
            // "215,Artist - Title"; IPTV lists put attributes before the comma.
            let (head, name) = rest.split_once(',').unwrap_or((rest, ""));
            let secs = head.split_whitespace().next().and_then(|s| s.parse::<i64>().ok()).filter(|s| *s > 0).and_then(|s| u32::try_from(s).ok());
            info = Some((secs, name.to_string()));
        } else if !l.starts_with('#') {
            let (secs, name) = info.take().unwrap_or_default();
            let (artist, title) = names(&name);
            out.push(Entry { artist, title, secs, location: place(l) });
        }
        if out.len() >= MAX_SONGS {
            break;
        }
    }
    Some(out)
}

/// "&amp;" → "&", numeric references too.
fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let end = rest.find(';').filter(|e| *e <= 10);
        let named = end.and_then(|e| match &rest[1..e] {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            n => n.strip_prefix("#x").map_or_else(|| n.strip_prefix('#').and_then(|d| d.parse().ok()), |h| u32::from_str_radix(h, 16).ok()).and_then(char::from_u32),
        });
        match (named, end) {
            (Some(c), Some(e)) => {
                out.push(c);
                rest = &rest[e + 1..];
            }
            _ => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// The text of `<tag>…</tag>` inside `block`, first one.
fn tag(block: &str, name: &str) -> Option<String> {
    let open = format!("<{name}>");
    let start = block.find(&open)? + open.len();
    let end = block[start..].find(&format!("</{name}>"))? + start;
    Some(unescape(block[start..end].trim()))
}

/// The songs of an XSPF: each `<track>` with its location, title, creator and duration (ms).
fn xspf(text: &str) -> Option<Vec<Entry>> {
    if !text.contains("<playlist") || !text.contains("xspf.org") {
        return None;
    }
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(at) = rest.find("<track>") {
        rest = &rest[at + 7..];
        let end = rest.find("</track>").unwrap_or(rest.len());
        let block = &rest[..end];
        rest = &rest[end..];
        let title = tag(block, "title").and_then(|t| clean(&t));
        let location = tag(block, "location").and_then(|l| place(&l));
        if title.is_none() && location.is_none() {
            continue;
        }
        out.push(Entry {
            artist: tag(block, "creator").and_then(|a| clean(&a)).unwrap_or_default(),
            title: title.unwrap_or_default(),
            secs: tag(block, "duration").and_then(|d| d.parse::<u64>().ok()).filter(|ms| *ms >= 1000).and_then(|ms| u32::try_from(ms.div_ceil(1000)).ok()),
            location,
        });
        if out.len() >= MAX_SONGS {
            break;
        }
    }
    Some(out)
}

/// The songs of a playlist file, or None when `text` is no M3U / XSPF (a plain list of songs: `songlist`).
pub fn read(text: &str) -> Option<Vec<Entry>> {
    let text = text.trim_start_matches('\u{feff}');
    let mut out = xspf(text).or_else(|| m3u(text))?;
    // An entry with nothing to go by, out.
    out.retain(|e| e.location.is_some() || clean(&e.title).is_some());
    Some(out)
}

/// The list's own name: M3U's `#PLAYLIST:`, XSPF's `<title>` before its tracks.
pub fn title(text: &str) -> Option<String> {
    if let Some(name) = text.lines().find_map(|l| l.trim().strip_prefix("#PLAYLIST:")) {
        return clean(name);
    }
    let head = text.find("<trackList>").map(|end| &text[..end]).filter(|_| text.contains("xspf.org"))?;
    tag(head, "title").and_then(|t| clean(&t))
}

/// "%20" → " ": a `file://` URI's path.
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = b.get(i + 1..i + 3).filter(|h| h.iter().all(u8::is_ascii_hexdigit)).and_then(|h| u8::from_str_radix(std::str::from_utf8(h).ok()?, 16).ok());
        match (b[i], hex) {
            (b'%', Some(byte)) => {
                out.push(byte);
                i += 3;
            }
            (c, _) => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The file a location points to: an absolute path, a `file://` URI, or a path relative to the playlist's folder (`base`).
/// None for a link.
pub fn file_path(location: &str, base: Option<&Path>) -> Option<PathBuf> {
    if let Some(uri) = location.strip_prefix("file://") {
        // file:///C:/Music/a.mp3 (Windows), file:///home/me/a.mp3, file://server/share/a.mp3.
        let path = percent_decode(uri);
        let b = path.as_bytes();
        return Some(PathBuf::from(if b.len() > 3 && b[0] == b'/' && b[2] == b':' {
            path[1..].replace('/', "\\")
        } else if b.first() == Some(&b'/') {
            path
        } else {
            format!("\\\\{}", path.replace('/', "\\"))
        }));
    }
    if location.contains("://") {
        return None;
    }
    let path = Path::new(location);
    if looks_like_place(location) || path.is_absolute() {
        return Some(path.to_path_buf());
    }
    base.map(|b| b.join(location))
}

/// "C:\Music\a b.mp3" → "file:///C:/Music/a%20b.mp3".
fn file_uri(path: &str) -> String {
    let slashed = path.replace('\\', "/");
    let mut out = String::from(if slashed.starts_with('/') { "file://" } else { "file:///" });
    for b in slashed.bytes() {
        if b.is_ascii_alphanumeric() || b"/:-._~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// One line, whatever the names hold.
fn flat(s: &str) -> String {
    s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect()
}

fn csv_cell(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) { format!("\"{}\"", s.replace('"', "\"\"")) } else { s.to_string() }
}

/// The playlist as a file of `format`.
pub fn write(format: Format, name: &str, rows: &[Row]) -> String {
    let local = |r: &Row| r.location.as_deref().is_some_and(|l| !l.contains("://"));
    match format {
        Format::M3u => {
            let mut out = format!("#EXTM3U\n#PLAYLIST:{}\n", flat(name));
            for r in rows {
                let who = if r.artist.is_empty() { flat(&r.title) } else { format!("{} - {}", flat(&r.artist), flat(&r.title)) };
                out.push_str(&format!("#EXTINF:{},{who}\n", r.secs.map_or(-1, i64::from)));
                out.push_str(&format!("{}\n", r.location.as_deref().map(flat).unwrap_or_default()));
            }
            out
        }
        Format::Xspf => {
            let mut out = format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<playlist version=\"1\" xmlns=\"http://xspf.org/ns/0/\">\n  <title>{}</title>\n  <trackList>\n", escape(name));
            for r in rows {
                out.push_str("    <track>\n");
                if let Some(l) = &r.location {
                    out.push_str(&format!("      <location>{}</location>\n", escape(&if local(r) { file_uri(l) } else { l.clone() })));
                }
                out.push_str(&format!("      <title>{}</title>\n", escape(&r.title)));
                if !r.artist.is_empty() {
                    out.push_str(&format!("      <creator>{}</creator>\n", escape(&r.artist)));
                }
                if let Some(a) = &r.album {
                    out.push_str(&format!("      <album>{}</album>\n", escape(a)));
                }
                if let Some(s) = r.secs {
                    out.push_str(&format!("      <duration>{}</duration>\n", u64::from(s) * 1000));
                }
                out.push_str("    </track>\n");
            }
            out.push_str("  </trackList>\n</playlist>\n");
            out
        }
        Format::Csv => {
            // Same columns `songlist` reads back (title, artist).
            let mut out = String::from("Title,Artist,Album,Duration (s),Link\n");
            for r in rows {
                let cols = [r.title.clone(), r.artist.clone(), r.album.clone().unwrap_or_default(), r.secs.map(|s| s.to_string()).unwrap_or_default(), r.location.clone().unwrap_or_default()];
                out.push_str(&cols.iter().map(|c| csv_cell(&flat(c))).collect::<Vec<_>>().join(","));
                out.push('\n');
            }
            out
        }
    }
}

/// A CSV of ours (or another with a link column): its rows with their locations. None: no link column.
pub fn csv_with_links(text: &str) -> Option<Vec<Entry>> {
    let mut lines = text.trim_start_matches('\u{feff}').lines().filter(|l| !l.trim().is_empty());
    let head: Vec<String> = cells(lines.next()?, ',').iter().map(|c| c.trim().to_lowercase()).collect();
    let col = |names: &[&str]| head.iter().position(|c| names.contains(&c.as_str()));
    let (title, link) = (col(&["title", "name", "track name"])?, col(&["link", "url", "location", "path"])?);
    let (artist, secs) = (col(&["artist", "artists", "artist name"]), col(&["duration (s)", "seconds"]));
    let mut out = Vec::new();
    for l in lines.take(MAX_SONGS) {
        let row = cells(l, ',');
        let get = |n: Option<usize>| n.and_then(|n| row.get(n)).map(|s| s.trim().to_string()).unwrap_or_default();
        let entry = Entry { title: get(Some(title)), artist: get(artist), secs: get(secs).parse().ok().filter(|s| *s > 0), location: place(&get(Some(link))) };
        if clean(&entry.title).is_some() || entry.location.is_some() {
            out.push(entry);
        }
    }
    Some(out)
}

/// One entry, resolved: what the shell does with it.
#[derive(Debug, Clone, PartialEq)]
pub enum Plan {
    /// A song of the library, by id.
    Own(i64),
    /// A YouTube video with the names the file gave it.
    Video(Track),
    /// A YouTube video without names: oEmbed names it.
    Link(String),
    /// Searched by name.
    Search(Wanted),
}

/// Windows paths: one spelling, to meet the library's own.
pub fn path_key(p: &Path) -> String {
    p.to_string_lossy().replace('/', "\\").to_lowercase()
}

/// "D:\Music\Justice - Genesis.mp3" → "Justice - Genesis", whichever OS wrote the path.
fn stem(path: &Path) -> Option<String> {
    let path = path.to_string_lossy();
    let name = path.rsplit(['\\', '/']).next()?;
    let ext = |e: &str| (1..=5).contains(&e.len()) && e.chars().all(|c| c.is_ascii_alphanumeric());
    clean(name.rsplit_once('.').filter(|(a, e)| !a.is_empty() && ext(e)).map_or(name, |(a, _)| a))
}

/// What to do with `e`: a library file as is, a YouTube video as is, the rest searched by name (a file's own name when the
/// entry gave none). Files outside the library aren't added as such (the folder scan would drop them): searched too.
/// `own`: the library's files by `path_key`. `video_id`: a YouTube link's video. None: nothing to go by.
pub fn plan(e: &Entry, base: Option<&Path>, own: &HashMap<String, i64>, video_id: impl Fn(&str) -> Option<String>) -> Option<Plan> {
    let file = e.location.as_deref().and_then(|l| file_path(l, base));
    if let Some(id) = file.as_deref().and_then(|f| own.get(&path_key(f))) {
        return Some(Plan::Own(*id));
    }
    let video = if file.is_none() { e.location.as_deref().and_then(video_id) } else { None };
    if let Some(id) = video {
        if e.artist.is_empty() || e.title.is_empty() {
            return Some(Plan::Link(format!("https://www.youtube.com/watch?v={id}")));
        }
        return Some(Plan::Video(Track {
            title: e.title.clone(),
            artist: e.artist.clone(),
            duration_ms: e.secs.map(|s| s.saturating_mul(1000)),
            art: Some(youtube_art(&id)),
            ids: BTreeMap::from([(Source::Youtube, id)]),
            ..Default::default()
        }));
    }
    let (artist, title) = if e.title.is_empty() {
        let (artist, title) = from_name(&stem(file.as_deref()?)?);
        (artist.unwrap_or_default(), title)
    } else {
        (e.artist.clone(), e.title.clone())
    };
    clean(&title).map(|title| Plan::Search(Wanted { artist, title }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(title: &str, artist: &str, secs: Option<u32>, location: Option<&str>) -> Row {
        Row { title: title.into(), artist: artist.into(), album: Some("Discovery".into()), secs, location: location.map(String::from) }
    }

    #[test]
    fn reads_an_m3u_with_its_names_and_places() {
        let text = "\u{feff}#EXTM3U\n#PLAYLIST:Mine\n#EXTINF:320,Daft Punk - One More Time\nC:\\Music\\one.mp3\n\n#EXTINF:-1 tvg-id=\"x\",Just A Title\nhttps://www.youtube.com/watch?v=FGBhQbmPwH8\nrelative/two.flac\n";
        let got = read(text).unwrap();
        assert_eq!(got.len(), 3);
        assert_eq!(got[0], Entry { artist: "Daft Punk".into(), title: "One More Time".into(), secs: Some(320), location: Some("C:\\Music\\one.mp3".into()) });
        assert_eq!((got[1].artist.as_str(), got[1].title.as_str(), got[1].secs), ("", "Just A Title", None));
        assert_eq!((got[2].title.as_str(), got[2].location.as_deref()), ("", Some("relative/two.flac")));
    }

    #[test]
    fn a_plain_list_of_songs_is_no_m3u() {
        assert_eq!(read("Daft Punk - One More Time\nJustice - D.A.N.C.E."), None);
        assert_eq!(read(""), None);
        // Bare paths are one, though.
        assert_eq!(read("C:\\Music\\a.mp3\n/home/me/b.mp3").map(|e| e.len()), Some(2));
    }

    #[test]
    fn reads_an_xspf() {
        let text = r#"<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/"><trackList>
  <track><location>file:///C:/Music/Rock%20%26%20Roll.mp3</location><title>Rock &amp; Roll</title><creator>Led Zeppelin</creator><duration>220500</duration></track>
  <track><title>Only &#233;t&#xE9;</title></track>
  <track><annotation>nothing</annotation></track>
</trackList></playlist>"#;
        let got = read(text).unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(got[0], Entry { artist: "Led Zeppelin".into(), title: "Rock & Roll".into(), secs: Some(221), location: Some("file:///C:/Music/Rock%20%26%20Roll.mp3".into()) });
        assert_eq!(got[1].title, "Only été");
        assert_eq!(file_path(got[0].location.as_deref().unwrap(), None), Some(PathBuf::from("C:\\Music\\Rock & Roll.mp3")));
    }

    #[test]
    fn places_become_files_or_stay_links() {
        let base = Path::new("C:\\Lists");
        assert_eq!(file_path("https://youtu.be/x", Some(base)), None);
        assert_eq!(file_path("C:\\Music\\a.mp3", Some(base)), Some(PathBuf::from("C:\\Music\\a.mp3")));
        assert_eq!(file_path("sub\\a.mp3", Some(base)), Some(base.join("sub\\a.mp3")));
        assert_eq!(file_path("sub\\a.mp3", None), None);
        assert_eq!(file_path("file:///home/me/a%20b.mp3", None), Some(PathBuf::from("/home/me/a b.mp3")));
        assert_eq!(file_path("file://nas/music/a.mp3", None), Some(PathBuf::from("\\\\nas\\music\\a.mp3")));
    }

    #[test]
    fn what_is_written_reads_back() {
        let rows = [row("One More Time", "Daft Punk", Some(320), Some("C:\\Music\\One More Time.mp3")), row("Rock & \"Roll\", live", "", None, Some("https://www.youtube.com/watch?v=FGBhQbmPwH8"))];
        let m3u = write(Format::M3u, "Mine", &rows);
        assert!(m3u.starts_with("#EXTM3U\n#PLAYLIST:Mine\n#EXTINF:320,Daft Punk - One More Time\nC:\\Music\\One More Time.mp3\n#EXTINF:-1,"));
        let back = read(&m3u).unwrap();
        assert_eq!((back[0].artist.as_str(), back[0].title.as_str(), back[0].secs), ("Daft Punk", "One More Time", Some(320)));
        assert_eq!(back[1].location.as_deref(), Some("https://www.youtube.com/watch?v=FGBhQbmPwH8"));

        assert_eq!(title(&m3u).as_deref(), Some("Mine"));
        let xspf = write(Format::Xspf, "Mine & co", &rows);
        assert!(xspf.contains("<title>Mine &amp; co</title>"));
        assert_eq!(title(&xspf).as_deref(), Some("Mine & co"));
        assert_eq!(title("Daft Punk - One More Time"), None);
        assert!(xspf.contains("<location>file:///C:/Music/One%20More%20Time.mp3</location>"));
        let back = read(&xspf).unwrap();
        assert_eq!((back[1].title.as_str(), back[0].secs), ("Rock & \"Roll\", live", Some(320)));
        assert_eq!(file_path(back[0].location.as_deref().unwrap(), None), Some(PathBuf::from("C:\\Music\\One More Time.mp3")));

        let csv = write(Format::Csv, "Mine", &rows);
        assert!(csv.contains("\"Rock & \"\"Roll\"\", live\""));
        let back = csv_with_links(&csv).unwrap();
        assert_eq!((back[0].title.as_str(), back[0].artist.as_str(), back[0].secs), ("One More Time", "Daft Punk", Some(320)));
        assert_eq!(back[1].title, "Rock & \"Roll\", live");
        assert_eq!(back[1].location.as_deref(), Some("https://www.youtube.com/watch?v=FGBhQbmPwH8"));
    }

    #[test]
    fn entries_resolve_to_own_files_videos_or_searches() {
        let own = HashMap::from([(path_key(Path::new("C:/Music/One.mp3")), 7)]);
        let vid = |l: &str| l.strip_prefix("https://youtu.be/").map(String::from);
        let entry = |artist: &str, title: &str, location: Option<&str>| Entry { artist: artist.into(), title: title.into(), secs: Some(200), location: location.map(String::from) };
        let base = Some(Path::new("C:\\Music"));
        // Library file, whatever the spelling or relative path.
        assert_eq!(plan(&entry("", "", Some("c:\\music\\ONE.mp3")), None, &own, vid), Some(Plan::Own(7)));
        assert_eq!(plan(&entry("", "", Some("One.mp3")), base, &own, vid), Some(Plan::Own(7)));
        // Video with names: as is; without: oEmbed.
        let Some(Plan::Video(t)) = plan(&entry("Daft Punk", "One More Time", Some("https://youtu.be/abc")), None, &own, vid) else { panic!() };
        assert_eq!((t.ids[&Source::Youtube].as_str(), t.duration_ms, t.artist.as_str()), ("abc", Some(200_000), "Daft Punk"));
        assert_eq!(plan(&entry("", "Just A Title", Some("https://youtu.be/abc")), None, &own, vid), Some(Plan::Link("https://www.youtube.com/watch?v=abc".into())));
        // A file elsewhere: its names, else its own name; another link: names.
        let w = |a: &str, t: &str| Some(Plan::Search(Wanted { artist: a.into(), title: t.into() }));
        assert_eq!(plan(&entry("Justice", "D.A.N.C.E.", Some("D:\\Other\\x.mp3")), None, &own, vid), w("Justice", "D.A.N.C.E."));
        assert_eq!(plan(&entry("", "", Some("D:\\Other\\Justice - Genesis.mp3")), None, &own, vid), w("Justice", "Genesis"));
        assert_eq!(plan(&entry("A", "B", Some("https://open.spotify.com/track/x")), None, &own, vid), w("A", "B"));
        assert_eq!(plan(&entry("", "", Some("https://open.spotify.com/track/x")), None, &own, vid), None);
    }

    #[test]
    fn formats_by_extension() {
        assert_eq!(Format::of(Path::new("a.M3U8")), Some(Format::M3u));
        assert_eq!(Format::of(Path::new("a.xspf")), Some(Format::Xspf));
        assert_eq!(Format::of(Path::new("a.csv")), Some(Format::Csv));
        assert_eq!(Format::of(Path::new("a.txt")), None);
    }
}
