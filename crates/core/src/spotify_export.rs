//! Spotify lists from Exportify's files (github.com/watsonbox/exportify, user's choice 2026-10-31): a third-party page
//! reading the user's own lists through Spotify's official API, after Spotify's consent page. Its key is the point: a new
//! app can't get one that serves everybody (Development Mode: Premium owner, 5 users; extended quota: companies with 250k
//! users). One CSV per list, in a ZIP when all are exported, `liked.csv` = Liked Songs. Header in the user's language,
//! same columns in each. Also Spotify's own data export, a file the user picks (`data`). A file the user or a page handed
//! over: everything bounded.

use crate::model::{Source, Track};
use crate::songlist::cells;
use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
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
/// A page left on Spotify's own site: time to settle, then back. Tries, since a page that keeps coming back won't change.
const SETTLE: Duration = Duration::from_secs(3);
const MAX_BACK: u8 = 2;

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

/// What the window does next.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Next {
    Wait,
    /// Signed in, left on Spotify's own pages: back to Exportify's.
    BringBack,
    Stop(ExportTrouble),
}

/// Exportify's window: silence per stage. Pure, ticked by the shell.
#[derive(Debug, Default)]
pub struct Watch {
    quiet: Duration,
    reading: bool,
    stranded: Duration,
    back: u8,
}

impl Watch {
    pub fn heard(&mut self, signal: Signal) -> Option<ExportTrouble> {
        self.quiet = Duration::ZERO;
        self.reading |= signal == Signal::Busy;
        (signal == Signal::Refused).then_some(ExportTrouble::Refused)
    }

    /// `url`: the window's page. Elsewhere than Exportify = signing in (Spotify, Google, Apple…), the user's: no limit.
    pub fn tick(&mut self, step: Duration, url: &str) -> Next {
        if stranded(url) {
            self.stranded += step;
            if self.stranded < SETTLE {
                return Next::Wait;
            }
            self.stranded = Duration::ZERO;
            self.back += 1;
            return if self.back > MAX_BACK { Next::Stop(ExportTrouble::Refused) } else { Next::BringBack };
        }
        self.stranded = Duration::ZERO;
        if signing_in(url) {
            self.quiet = Duration::ZERO;
            return Next::Wait;
        }
        self.quiet += step;
        let (limit, trouble) = if self.reading { (READ, ExportTrouble::Stalled) } else { (LOAD, ExportTrouble::Down) };
        if self.quiet >= limit { Next::Stop(trouble) } else { Next::Wait }
    }
}

/// Spotify's own pages past a sign-in: nothing there leads back. Never its sign-in or consent page.
fn stranded(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let page = path.split(['?', '#']).next().unwrap_or("");
    matches!(host, "open.spotify.com" | "www.spotify.com") || (host == "accounts.spotify.com" && page.ends_with("status"))
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

/// "Daft+Punk%21" → "Daft Punk!": a local file's URI parts are form-encoded.
fn unform(part: &str) -> String {
    let b = part.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = b.get(i + 1..i + 3).filter(|h| h.iter().all(u8::is_ascii_hexdigit)).and_then(|h| u8::from_str_radix(std::str::from_utf8(h).ok()?, 16).ok());
        match (b[i], hex) {
            (b'+', _) => out.push(b' '),
            (b'%', Some(byte)) => {
                out.push(byte);
                i += 2;
            }
            (c, _) => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Columns: 0 uri, 1 name, 3 artists, 5 album, 9 cover, 12 duration, 16 ISRC. Episodes: no song to find. A file of the
/// user's own (`spotify:local:artist:album:title:secs`): no Spotify id, its names searched like a pasted song.
fn track(line: &str) -> Option<Track> {
    let row = cells(line, ',');
    let cell = |n: usize| row.get(n).and_then(|c| clean(c));
    if let Some(parts) = row.first()?.strip_prefix("spotify:local:") {
        // The columns win; the URI fills what they leave empty.
        let parts: Vec<String> = parts.split(':').map(unform).collect();
        let part = |n: usize| parts.get(n).filter(|_| parts.len() == 4).and_then(|p| clean(p));
        return Some(Track {
            title: cell(1).or_else(|| part(2))?,
            artist: cell(3).or_else(|| part(0))?,
            album: cell(5).or_else(|| part(1)),
            duration_ms: cell(12).and_then(|d| d.parse().ok()).filter(|ms| *ms > 0).or_else(|| part(3)?.parse::<u32>().ok()?.checked_mul(1000).filter(|ms| *ms > 0)),
            musicness: None,
            ..Default::default()
        });
    }
    let id = row.first()?.strip_prefix("spotify:track:").filter(|id| track_id(id))?;
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

/// A Spotify track id: 22 letters and digits.
fn track_id(id: &str) -> bool {
    id.len() == 22 && id.bytes().all(|b| b.is_ascii_alphanumeric())
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

// Spotify's own data export (account › Privacy settings › Download your data, days to come): `Playlist1.json` (2, 3…
// for many lists), `YourLibrary.json` for Liked Songs, in a ZIP with the account's other files (never opened). Names and
// ids only: lengths and covers come with the versions found.

#[derive(Deserialize, Default)]
#[serde(default)]
struct DataPlaylists {
    playlists: Option<Vec<DataPlaylist>>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct DataPlaylist {
    name: Option<String>,
    items: Option<Vec<DataItem>>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct DataItem {
    track: Option<DataTrack>,
    local_track: Option<DataLocal>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct DataTrack {
    track_name: Option<String>,
    artist_name: Option<String>,
    album_name: Option<String>,
    track_uri: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct DataLocal {
    uri: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct DataLibrary {
    tracks: Option<Vec<DataLiked>>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct DataLiked {
    artist: Option<String>,
    album: Option<String>,
    track: Option<String>,
    uri: Option<String>,
}

/// "Playlist1.json", "YourLibrary.json": a file of the data export worth opening.
fn is_data(file: &str) -> bool {
    file == "YourLibrary.json" || file.strip_prefix("Playlist").and_then(|r| r.strip_suffix(".json")).is_some_and(|n| n.bytes().all(|b| b.is_ascii_digit()))
}

fn data_track(title: Option<String>, artist: Option<String>, album: Option<String>, uri: Option<String>) -> Option<Track> {
    let id = uri.as_deref().and_then(|u| u.strip_prefix("spotify:track:")).filter(|id| track_id(id));
    Some(Track {
        title: clean(&title?)?,
        artist: clean(&artist?)?,
        album: album.as_deref().and_then(clean),
        ids: id.map(|id| [(Source::Spotify, id.to_string())].into()).unwrap_or_default(),
        ..Default::default()
    })
}

/// `spotify:local:artist:album:title:secs`, parts form-encoded: a file of the user's own, its names searched.
fn data_local(uri: &str) -> Option<Track> {
    let parts: Vec<String> = uri.strip_prefix("spotify:local:")?.split(':').map(unform).collect();
    let [artist, album, title, secs] = parts.as_slice() else { return None };
    Some(Track { title: clean(title)?, artist: clean(artist)?, album: clean(album), duration_ms: secs.parse::<u32>().ok().and_then(|s| s.checked_mul(1000)).filter(|ms| *ms > 0), ..Default::default() })
}

/// Exportify's id for the same list ("cool_music"): either route refreshes it, and this one brings the real name.
fn data_id(name: &str) -> String {
    format!("export:{}", name.to_lowercase().split_whitespace().collect::<Vec<_>>().join("_").chars().take(100).collect::<String>())
}

/// The lists of one data export file (by its text: a downloaded copy may be renamed). Episodes left out.
fn data(text: &str) -> Vec<ExportedList> {
    let text = text.trim_start_matches('\u{feff}').trim_start();
    if !text.starts_with('{') {
        return Vec::new();
    }
    if let Ok(DataPlaylists { playlists: Some(lists) }) = serde_json::from_str(text) {
        return lists
            .into_iter()
            .take(MAX_LISTS)
            .filter_map(|p| {
                let name: String = p.name?.trim().chars().take(100).collect();
                let songs = p.items.unwrap_or_default().into_iter().filter_map(|i| match (i.track, i.local_track) {
                    (Some(t), _) => data_track(t.track_name, t.artist_name, t.album_name, t.track_uri),
                    (None, Some(l)) => data_local(l.uri.as_deref()?),
                    (None, None) => None,
                });
                let tracks: Vec<Track> = songs.take(MAX_SONGS).collect();
                (!name.is_empty() && !tracks.is_empty()).then(|| ExportedList { id: data_id(&name), name, tracks })
            })
            .collect();
    }
    let Ok(DataLibrary { tracks: Some(liked) }) = serde_json::from_str(text) else { return Vec::new() };
    let tracks: Vec<Track> = liked.into_iter().filter_map(|t| data_track(t.track, t.artist, t.album, t.uri)).take(MAX_SONGS).collect();
    if tracks.is_empty() { Vec::new() } else { vec![ExportedList { id: LIKED.to_string(), name: "Liked Songs".to_string(), tracks }] }
}

/// Two lists of one name ("New Playlist"): each its own id.
fn distinct(lists: &mut [ExportedList]) {
    let mut seen = HashSet::new();
    for l in lists {
        let base = l.id.clone();
        let mut n = 1;
        while !seen.insert(l.id.clone()) {
            n += 1;
            l.id = format!("{base}~{n}");
        }
    }
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
        let file = name.rsplit(['/', '\\']).next().unwrap_or_default().to_string();
        if !file.ends_with(".csv") && !is_data(&file) {
            continue;
        }
        let mut text = Vec::new();
        left -= entry.take(left).read_to_end(&mut text)? as u64;
        if left == 0 {
            bail!("That file is too big");
        }
        let text = String::from_utf8_lossy(&text);
        if is_data(&file) {
            lists.extend(data(&text));
        } else {
            lists.extend(list(&name, &text));
        }
    }
    lists.truncate(MAX_LISTS);
    lists.sort_by_key(|l| l.id != LIKED);
    distinct(&mut lists);
    Ok(lists)
}

/// An Exportify file (the ZIP of all lists, or the CSV of one), or Spotify's data export (its ZIP, or one of its JSON files).
pub fn read(path: &Path) -> anyhow::Result<Vec<ExportedList>> {
    let bytes = std::fs::read(path)?;
    if bytes.len() as u64 > MAX_BYTES {
        bail!("That file is too big");
    }
    let lists = if bytes.starts_with(b"PK") {
        unzip(Cursor::new(bytes))?
    } else {
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let text = String::from_utf8_lossy(&bytes);
        let mut lists = if name.to_lowercase().ends_with(".json") { data(&text) } else { list(&name, &text).into_iter().collect() };
        distinct(&mut lists);
        lists
    };
    if lists.is_empty() {
        bail!("No Spotify lists in that file: it should come from Exportify or Spotify's data export");
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
    fn local_files_come_as_songs_to_find() {
        // As Exportify writes them: the URI form-encoded, the columns sometimes empty.
        let named = "\"spotify:local:x:y:z:1\",\"Mine\",\"\",\"Me\"";
        let bare = "\"spotify:local:Daft+Punk:Discovery:One+More+Time%21:320\",\"\",\"\",\"\"";
        let l = list("a.csv", &format!("{HEAD}\n{named}\n{bare}\n")).unwrap();
        let got: Vec<_> = l.tracks.iter().map(|t| (t.title.as_str(), t.artist.as_str(), t.album.as_deref(), t.duration_ms, t.ids.len())).collect();
        assert_eq!(got, [("Mine", "Me", Some("y"), Some(1000), 0), ("One More Time!", "Daft Punk", Some("Discovery"), Some(320_000), 0)]);
        // Nothing to search by: left out.
        assert_eq!(list("a.csv", &format!("{HEAD}\n\"spotify:local:::%07:\",\"\",\"\",\"\"\n")), None);
        assert_eq!(unform("%zz+%4"), "%zz %4");
    }

    #[test]
    fn keeps_only_songs_and_refuses_what_no_list_holds() {
        let episode = "\"spotify:episode:x\",\"Talk\",\"\",\"Host\"";
        let odd = [row("short", "A"), row(ID, ""), row(ID, "A\u{7}"), row(ID, &"x".repeat(301)), episode.to_string()].join("\n");
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

    const PLAYLISTS: &str = r#"{
  "playlists" : [ {
    "name" : "Cool Music",
    "lastModifiedDate" : "2026-10-01",
    "items" : [ {
      "track" : { "trackName" : "Get Lucky", "artistName" : "Daft Punk", "albumName" : "Random Access Memories", "trackUri" : "spotify:track:0sNOF9WDwhWunNAHPD3Baj" },
      "episode" : null, "localTrack" : null, "addedDate" : "2026-10-01"
    }, {
      "track" : null, "episode" : { "episodeName" : "Talk", "showName" : "Show" }, "localTrack" : null
    }, {
      "track" : null, "episode" : null, "localTrack" : { "uri" : "spotify:local:Justice:Cross:Genesis:234" }
    }, {
      "track" : { "trackName" : "No id", "artistName" : "Someone", "albumName" : null, "trackUri" : "spotify:track:bad" }
    } ],
    "description" : null,
    "numberOfFollowers" : 0
  }, {
    "name" : "New Playlist", "items" : [ { "track" : { "trackName" : "A", "artistName" : "B", "trackUri" : null } } ]
  }, {
    "name" : "New Playlist", "items" : [ { "track" : { "trackName" : "C", "artistName" : "D" } } ]
  }, {
    "name" : "Only talk", "items" : [ { "track" : null, "episode" : { "episodeName" : "x" } } ]
  }, {
    "name" : "Empty", "items" : null
  } ]
}"#;
    const LIBRARY: &str = r#"{ "tracks" : [ { "artist" : "Daft Punk", "album" : "Discovery", "track" : "One More Time", "uri" : "spotify:track:0DiWol3AO6WpXZgp0goxAV" } ], "albums" : [ ], "shows" : [ ], "episodes" : [ ], "bannedTracks" : [ ], "artists" : [ ], "bannedArtists" : [ ], "other" : [ ] }"#;

    #[test]
    fn reads_spotifys_own_data_export() {
        let bytes = zipped(&[("Spotify Account Data/Playlist1.json", PLAYLISTS), ("Spotify Account Data/YourLibrary.json", LIBRARY), ("Spotify Account Data/Userdata.json", r#"{"username":"x"}"#), ("Spotify Account Data/ReadMeFirst_YourAccountData.pdf", "%PDF")]);
        let lists = unzip(Cursor::new(bytes)).unwrap();
        let ids: Vec<_> = lists.iter().map(|l| (l.id.as_str(), l.name.as_str(), l.tracks.len())).collect();
        assert_eq!(ids, [(LIKED, "Liked Songs", 1), ("export:cool_music", "Cool Music", 3), ("export:new_playlist", "New Playlist", 1), ("export:new_playlist~2", "New Playlist", 1)]);
        let songs: Vec<_> = lists[1].tracks.iter().map(|t| (t.title.as_str(), t.artist.as_str(), t.duration_ms, t.ids.get(&Source::Spotify).map(String::as_str))).collect();
        assert_eq!(songs, [("Get Lucky", "Daft Punk", None, Some(ID)), ("Genesis", "Justice", Some(234_000), None), ("No id", "Someone", None, None)]);
        assert_eq!(lists[0].tracks[0].ids[&Source::Spotify], "0DiWol3AO6WpXZgp0goxAV");
        // One file on its own, even renamed by a browser; another JSON says nothing.
        assert_eq!(data(&format!("\u{feff}{LIBRARY}")).len(), 1);
        assert_eq!(data(r#"{"username":"x"}"#).len(), 0);
        assert_eq!(data("not json").len(), 0);
        assert!(is_data("Playlist12.json") && is_data("YourLibrary.json") && !is_data("Playlistx.json") && !is_data("Userdata.json"));
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
        (0..secs).find_map(|_| match watch.tick(Duration::from_secs(1), url) {
            Next::Stop(t) => Some(t),
            _ => None,
        })
    }

    #[test]
    fn a_sign_in_left_on_spotify_goes_back_to_exportify() {
        let second = Duration::from_secs(1);
        for page in ["https://open.spotify.com/", "https://www.spotify.com/fr/account/overview/", "https://accounts.spotify.com/fr/status?x=1"] {
            let mut watch = Watch::default();
            // Back after its moment, twice, then it's said.
            for _ in 0..MAX_BACK {
                assert_eq!(watch.tick(second, page), Next::Wait);
                assert_eq!(watch.tick(second, page), Next::Wait);
                assert_eq!(watch.tick(second, page), Next::BringBack);
            }
            assert_eq!(silence(&mut watch, 3, page), Some(ExportTrouble::Refused));
        }
        // Sign-in and consent stay the user's.
        for page in ["https://accounts.spotify.com/authorize?client_id=x", "https://accounts.spotify.com/fr/login?continue=x", "https://accounts.spotify.com/fr/authorize/accept"] {
            let mut watch = Watch::default();
            assert!((0..600).all(|_| watch.tick(second, page) == Next::Wait), "{page}");
        }
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
