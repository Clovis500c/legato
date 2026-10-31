//! Spotify lists from Exportify's files (github.com/watsonbox/exportify, user's choice 2026-10-31): a third-party page
//! reading the user's own lists through Spotify's official API, after Spotify's consent page. Its key is the point: a new
//! app can't get one that serves everybody (Development Mode: Premium owner, 5 users; extended quota: companies with 250k
//! users). One CSV per list, in a ZIP when all are exported, `liked.csv` = Liked Songs. Header in the user's language,
//! same columns in each. A file the user or a page handed over: everything bounded.

use crate::model::{Source, Track};
use crate::songlist::cells;
use anyhow::{Context, bail};
use serde::Serialize;
use std::io::{Cursor, Read, Seek};
use std::path::Path;
use std::time::Duration;

/// Same id as Connect Spotify's Liked Songs: either route refreshes it.
pub const LIKED: &str = "liked";
/// Same as a link's import.
const MAX_SONGS: usize = 3000;
const MAX_LISTS: usize = 500;
const MAX_TEXT: usize = 300;
/// File, and CSV text unpacked from it (a ZIP can claim anything).
const MAX_BYTES: u64 = 200 << 20;
const PAGE: &str = "https://exportify.app/";
const SIGNAL: &str = "legato-exportify:";
/// Silence before the window counts as broken. Its buttons: seconds. Its reading: one long list can stay quiet for minutes.
const LOAD: Duration = Duration::from_secs(30);
const READ: Duration = Duration::from_secs(300);

/// What Exportify's page says (`music_shield::EXPORTIFY_SCRIPT`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Signal {
    /// One of its buttons is there.
    Ready,
    /// Its reading is moving.
    Busy,
    /// Back from Spotify with no way in.
    Refused,
}

/// A signal, only from Exportify's page.
pub fn signal(source: &str, message: &str) -> Option<Signal> {
    if !source.starts_with(PAGE) {
        return None;
    }
    match message.strip_prefix(SIGNAL)? {
        "ready" => Some(Signal::Ready),
        "busy" => Some(Signal::Busy),
        "refused" => Some(Signal::Refused),
        _ => None,
    }
}

/// Why no lists came.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ExportTrouble {
    /// The user closed its window.
    Closed,
    /// No page, or one without its buttons.
    Down,
    Refused,
    Stalled,
    BadFile,
}

/// Exportify's window: silence per stage. Pure, ticked by the shell.
#[derive(Debug, Default)]
pub struct Watch {
    quiet: Duration,
    reading: bool,
}

impl Watch {
    pub fn heard(&mut self, signal: Signal) -> Option<ExportTrouble> {
        self.quiet = Duration::ZERO;
        self.reading |= signal == Signal::Busy;
        (signal == Signal::Refused).then_some(ExportTrouble::Refused)
    }

    /// `url`: the window's page. Elsewhere than Exportify = signing in (Spotify, Google, Apple…), the user's: no limit.
    pub fn tick(&mut self, step: Duration, url: &str) -> Option<ExportTrouble> {
        if signing_in(url) {
            self.quiet = Duration::ZERO;
            return None;
        }
        self.quiet += step;
        let (limit, trouble) = if self.reading { (READ, ExportTrouble::Stalled) } else { (LOAD, ExportTrouble::Down) };
        (self.quiet >= limit).then_some(trouble)
    }
}

/// Another site's page. Not a browser's error page: that one is Exportify's silence.
fn signing_in(url: &str) -> bool {
    url.strip_prefix("https://").is_some_and(|rest| rest.split(['/', ':', '?', '#']).next() != Some("exportify.app"))
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExportedList {
    pub id: String,
    pub name: String,
    pub tracks: Vec<Track>,
}

impl ExportedList {
    /// The first song's cover.
    pub fn cover(&self) -> Option<&str> {
        self.tracks.iter().find_map(|t| t.art.as_deref())
    }
}

fn clean(cell: &str) -> Option<String> {
    let s = cell.trim();
    (!s.is_empty() && s.chars().count() <= MAX_TEXT && !s.chars().any(char::is_control)).then(|| s.to_string())
}

/// Columns: 0 uri, 1 name, 3 artists, 5 album, 9 cover, 12 duration, 16 ISRC. Local files and episodes: no song to find.
fn track(line: &str) -> Option<Track> {
    let row = cells(line, ',');
    let id = row.first()?.strip_prefix("spotify:track:").filter(|id| id.len() == 22 && id.bytes().all(|b| b.is_ascii_alphanumeric()))?;
    let cell = |n: usize| row.get(n).and_then(|c| clean(c));
    Some(Track {
        title: cell(1)?,
        artist: cell(3)?,
        album: cell(5),
        duration_ms: cell(12).and_then(|d| d.parse().ok()).filter(|ms| *ms > 0),
        isrc: cell(16).filter(|i| i.len() == 12 && i.bytes().all(|b| b.is_ascii_alphanumeric())),
        ids: [(Source::Spotify, id.to_string())].into(),
        art: cell(9).filter(|u| u.starts_with("https://i.scdn.co/image/")),
        musicness: None,
    })
}

/// "cool_music_🎶": the file's name, a list's name lowered with underscores for spaces. Enough to know it by.
fn list_name(stem: &str) -> String {
    let words = stem.replace('_', " ");
    let mut chars = words.trim().chars();
    chars.next().map_or_else(|| "Spotify".to_string(), |c| c.to_uppercase().chain(chars.take(99)).collect())
}

/// One CSV. None: no songs in it (saved_albums.csv, an empty list).
pub fn list(file: &str, text: &str) -> Option<ExportedList> {
    let stem = file.rsplit(['/', '\\']).next()?.strip_suffix(".csv")?;
    let text = text.trim_start_matches('\u{feff}');
    let tracks: Vec<Track> = text.lines().skip(1).filter_map(track).take(MAX_SONGS).collect();
    if tracks.is_empty() {
        return None;
    }
    let id = if stem == LIKED { LIKED.to_string() } else { format!("export:{}", stem.chars().take(100).collect::<String>()) };
    Some(ExportedList { id, name: list_name(stem), tracks })
}

/// The ZIP's lists, Liked Songs first.
fn unzip(file: impl Read + Seek) -> anyhow::Result<Vec<ExportedList>> {
    let mut zip = zip::ZipArchive::new(file).context("Not a ZIP file")?;
    let mut lists = Vec::new();
    let mut left = MAX_BYTES;
    for i in 0..zip.len() {
        let entry = zip.by_index(i)?;
        if !entry.is_file() || lists.len() >= MAX_LISTS {
            continue;
        }
        let name = entry.name()?.to_string();
        let mut text = Vec::new();
        left -= entry.take(left).read_to_end(&mut text)? as u64;
        if left == 0 {
            bail!("That file is too big");
        }
        lists.extend(list(&name, &String::from_utf8_lossy(&text)));
    }
    lists.sort_by_key(|l| l.id != LIKED);
    Ok(lists)
}

/// An Exportify file: the ZIP of all lists, or the CSV of one.
pub fn read(path: &Path) -> anyhow::Result<Vec<ExportedList>> {
    let bytes = std::fs::read(path)?;
    if bytes.len() as u64 > MAX_BYTES {
        bail!("That file is too big");
    }
    let lists = if bytes.starts_with(b"PK") {
        unzip(Cursor::new(bytes))?
    } else {
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        list(&name, &String::from_utf8_lossy(&bytes)).into_iter().collect()
    };
    if lists.is_empty() {
        bail!("No Spotify lists in that file: it should come from Exportify");
    }
    Ok(lists)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const ID: &str = "0sNOF9WDwhWunNAHPD3Baj";
    const HEAD: &str = "\"URI du titre\",\"Nom du titre\",\"URI(s) de l'artiste\",\"Nom(s) de l'artiste\",\"URI de l'album\",\"Nom de l'album\",a,b,c,d,e,f,g,h,i,j,\"ISRC\"";

    fn row(id: &str, title: &str) -> String {
        format!("\"spotify:track:{id}\",\"{title}\",\"spotify:artist:x\",\"Daft Punk, Pharrell Williams\",\"spotify:album:x\",\"Random Access Memories\",\"\",\"\",\"2013\",\"https://i.scdn.co/image/ab67\",\"1\",\"8\",\"248000\",\"\",\"false\",\"80\",\"USQX91300808\"")
    }

    fn zipped(files: &[(&str, &str)]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, text) in files {
            zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(text.as_bytes()).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn reads_a_row_with_its_commas_and_ids() {
        let l = list("cool_music_🎶.csv", &format!("{HEAD}\n{}\n", row(ID, "Get Lucky (feat. A, B)"))).unwrap();
        assert_eq!((l.id.as_str(), l.name.as_str()), ("export:cool_music_🎶", "Cool music 🎶"));
        let t = &l.tracks[0];
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.album.as_deref()), ("Get Lucky (feat. A, B)", "Daft Punk, Pharrell Williams", Some("Random Access Memories")));
        assert_eq!((t.duration_ms, t.isrc.as_deref(), t.ids[&Source::Spotify].as_str()), (Some(248_000), Some("USQX91300808"), ID));
        assert_eq!(l.cover(), Some("https://i.scdn.co/image/ab67"));
    }

    #[test]
    fn keeps_only_songs_and_refuses_what_no_list_holds() {
        let local = "\"spotify:local:x\",\"Mine\",\"\",\"Me\"";
        let odd = [row("short", "A"), row(ID, ""), row(ID, "A\u{7}"), row(ID, &"x".repeat(301)), local.to_string()].join("\n");
        assert_eq!(list("a.csv", &format!("{HEAD}\n{odd}\n{}\n", row(ID, "Good"))).unwrap().tracks.len(), 1);
        assert_eq!(list("a.csv", &format!("{HEAD}\n{odd}\n")), None);
        let bad_art = row(ID, "A").replace("https://i.scdn.co/image/ab67", "https://evil.example/a.jpg");
        assert_eq!(list("a.csv", &format!("{HEAD}\n{bad_art}\n")).unwrap().cover(), None);
        assert_eq!(list("a.txt", &format!("{HEAD}\n{}\n", row(ID, "A"))), None);
    }

    #[test]
    fn a_zip_gives_each_list_liked_songs_first() {
        let a = format!("\u{feff}{HEAD}\n{}\n", row(ID, "A"));
        let albums = "\"URI\",\"Nom\"\n\"spotify:album:x\",\"Album\"\n";
        let bytes = zipped(&[("2024.csv", &a), ("saved_albums.csv", albums), ("liked.csv", &a), ("notes.txt", "hi"), ("empty.csv", HEAD)]);
        let lists = unzip(Cursor::new(bytes)).unwrap();
        assert_eq!(lists.iter().map(|l| l.id.as_str()).collect::<Vec<_>>(), [LIKED, "export:2024"]);
    }

    #[test]
    fn only_exportifys_page_signals() {
        assert_eq!(signal("https://exportify.app/?code=x", "legato-exportify:ready"), Some(Signal::Ready));
        assert_eq!(signal("https://exportify.app/", "legato-exportify:busy"), Some(Signal::Busy));
        assert_eq!(signal("https://exportify.app/", "legato-exportify:refused"), Some(Signal::Refused));
        assert_eq!(signal("https://exportify.app.evil.com/", "legato-exportify:ready"), None);
        assert_eq!(signal("https://exportify.app/", "legato-exportify:other"), None);
        assert_eq!(signal("https://exportify.app/", "ready"), None);
    }

    fn silence(watch: &mut Watch, secs: u64, url: &str) -> Option<ExportTrouble> {
        (0..secs).find_map(|_| watch.tick(Duration::from_secs(1), url))
    }

    #[test]
    fn a_page_without_its_buttons_is_down() {
        let home = "https://exportify.app/";
        let mut watch = Watch::default();
        assert_eq!(silence(&mut watch, 29, home), None);
        assert_eq!(silence(&mut watch, 1, home), Some(ExportTrouble::Down));
        // Browser's error page, whatever its address.
        assert_eq!(silence(&mut Watch::default(), 30, "chrome-error://chromewebdata/"), Some(ExportTrouble::Down));
        // Its buttons keep it alive.
        let mut watch = Watch::default();
        assert_eq!(silence(&mut watch, 29, home), None);
        assert_eq!(watch.heard(Signal::Ready), None);
        assert_eq!(silence(&mut watch, 29, home), None);
    }

    #[test]
    fn signing_in_takes_as_long_as_it_takes() {
        let mut watch = Watch::default();
        assert_eq!(silence(&mut watch, 29, "https://exportify.app/"), None);
        for page in ["https://accounts.spotify.com/authorize?client_id=x", "https://accounts.google.com/", "https://appleid.apple.com/"] {
            assert_eq!(silence(&mut watch, 3600, page), None);
        }
        // Back: a clean start, then the same limit.
        assert_eq!(silence(&mut watch, 29, "https://exportify.app/?code=x"), None);
        assert_eq!(silence(&mut watch, 1, "https://exportify.app/?code=x"), Some(ExportTrouble::Down));
    }

    #[test]
    fn a_reading_has_minutes_then_counts_as_stalled() {
        let home = "https://exportify.app/";
        let mut watch = Watch::default();
        assert_eq!(watch.heard(Signal::Busy), None);
        assert_eq!(silence(&mut watch, 299, home), None);
        assert_eq!(watch.heard(Signal::Busy), None);
        assert_eq!(silence(&mut watch, 299, home), None);
        assert_eq!(silence(&mut watch, 1, home), Some(ExportTrouble::Stalled));
    }

    #[test]
    fn a_refusal_is_said_at_once() {
        assert_eq!(Watch::default().heard(Signal::Refused), Some(ExportTrouble::Refused));
    }

    #[test]
    fn reads_either_file_and_says_when_it_is_neither() {
        let dir = tempfile::tempdir().unwrap();
        let csv = format!("{HEAD}\n{}\n", row(ID, "A"));
        let one = dir.path().join("liked.csv");
        std::fs::write(&one, &csv).unwrap();
        assert_eq!(read(&one).unwrap()[0].id, LIKED);
        let all = dir.path().join("spotify_playlists.zip");
        std::fs::write(&all, zipped(&[("road_trip.csv", &csv)])).unwrap();
        assert_eq!(read(&all).unwrap()[0].name, "Road trip");
        let other = dir.path().join("other.csv");
        std::fs::write(&other, "Title,Artist\nHello,Adele\n").unwrap();
        assert!(read(&other).is_err());
        std::fs::write(&other, "PK not a zip").unwrap();
        assert!(read(&other).is_err());
    }
}
