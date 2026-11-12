//! Local music folders: find audio files, read tags (lofty) into Tracks. Track id = file path.

use crate::model::{Source, Track};
use lofty::config::ParseOptions;
use lofty::file::TaggedFile;
use lofty::picture::PictureType;
use lofty::prelude::*;
use lofty::probe::Probe;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{LazyLock, Mutex, PoisonError};
use std::time::SystemTime;

/// File size and date: same = same tags.
type Stamp = (u64, Option<SystemTime>);

/// Tags read before, per file: a rescan reads only new or changed files. A watched folder rescans whole after each
/// change (one album copied into 5,000 files was 5,000 tag reads).
static KNOWN: LazyLock<Mutex<HashMap<PathBuf, (Stamp, LocalSong)>>> = LazyLock::new(Mutex::default);

/// A local file as the library keeps it: the song, and what only files tell (the Genre and Year columns, the column
/// browser's panes).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LocalSong {
    pub track: Track,
    pub genre: Option<String>,
    pub year: Option<u32>,
}

impl From<Track> for LocalSong {
    fn from(track: Track) -> Self {
        Self { track, ..Self::default() }
    }
}

const AUDIO: [&str; 6] = ["mp3", "flac", "wav", "ogg", "m4a", "aac"];

/// An audio file the library takes, by its extension.
pub fn is_audio(path: &Path) -> bool {
    path.extension().and_then(|x| x.to_str()).is_some_and(|x| AUDIO.contains(&x.to_ascii_lowercase().as_str()))
}

/// Most watched folders, and most files kept on their own (dropped outside them).
pub const MAX_FOLDERS: usize = 50;
pub const MAX_LOOSE: usize = 20_000;

/// All audio files under `roots`, recursively; an audio file given as a root, as it is (dropped alone). Each file once.
/// Symlinked dirs skipped (no loops).
pub fn scan(roots: &[PathBuf]) -> Vec<LocalSong> {
    scan_with(roots, &|_, _| {})
}

/// `scan`, telling `progress(done, total)` as the files new or changed since the last scan are read (total counts only
/// those: unchanged ones come from memory). Called from the reading threads, `done` rising by one each time.
pub fn scan_with(roots: &[PathBuf], progress: &(dyn Fn(usize, usize) + Sync)) -> Vec<LocalSong> {
    let mut files = Vec::new();
    for r in roots {
        if is_audio(r) && r.is_file() {
            found(r.clone(), std::fs::metadata(r).ok(), &mut files);
        } else {
            walk(r, &mut files);
        }
    }
    // A dropped file a watched folder holds too.
    let mut seen = HashSet::new();
    files.retain(|(p, _)| seen.insert(p.clone()));
    let old = std::mem::take(&mut *KNOWN.lock().unwrap_or_else(PoisonError::into_inner));
    // No date known: read again.
    let kept = |path: &PathBuf, stamp: &Stamp| old.get(path).filter(|(s, _)| stamp.1.is_some() && s == stamp).map(|(_, t)| t.clone());
    let todo: Vec<&Path> = files.iter().filter(|(p, s)| kept(p, s).is_none()).map(|(p, _)| p.as_path()).collect();
    let mut fresh = read_all(&todo, progress).into_iter();
    let mut now = HashMap::with_capacity(files.len());
    let out = files
        .into_iter()
        .map(|(path, stamp)| {
            let song = kept(&path, &stamp).unwrap_or_else(|| fresh.next().expect("one read per new file"));
            now.insert(path, (stamp, song.clone()));
            song
        })
        .collect();
    // Files gone since are forgotten.
    *KNOWN.lock().unwrap_or_else(PoisonError::into_inner) = now;
    out
}

fn walk(dir: &Path, out: &mut Vec<(PathBuf, Stamp)>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let Ok(kind) = e.file_type() else { continue };
        let path = e.path();
        if kind.is_dir() {
            walk(&path, out);
        } else if kind.is_file() && is_audio(&path) {
            found(path, e.metadata().ok(), out);
        }
    }
}

fn found(path: PathBuf, meta: Option<std::fs::Metadata>, out: &mut Vec<(PathBuf, Stamp)>) {
    out.push((path, (meta.as_ref().map_or(0, |m| m.len()), meta.and_then(|m| m.modified().ok()))));
}

/// A drop from Explorer: a folder joins `folders` (unless one holds it already), an audio file outside them joins `loose`,
/// each once; a file a new folder holds leaves `loose`. Returns the folders added.
pub fn take_drop(dropped: &[PathBuf], folders: &mut Vec<String>, loose: &mut Vec<String>) -> usize {
    let before = folders.len();
    for d in dropped.iter().filter(|p| p.is_dir()) {
        if folders.len() < MAX_FOLDERS && !folders.iter().any(|f| d.starts_with(f)) {
            folders.push(d.to_string_lossy().into_owned());
        }
    }
    let watched = |p: &Path| folders.iter().any(|f| p.starts_with(f));
    loose.retain(|f| !watched(Path::new(f)));
    for f in dropped.iter().filter(|p| is_audio(p) && p.is_file() && !watched(p)) {
        let f = f.to_string_lossy().into_owned();
        if loose.len() < MAX_LOOSE && !loose.contains(&f) {
            loose.push(f);
        }
    }
    folders.len() - before
}

/// Tags of `paths`, in order, read on a few threads: one file's disk wait overlaps another's parsing.
fn read_all(paths: &[&Path], progress: &(dyn Fn(usize, usize) + Sync)) -> Vec<LocalSong> {
    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let workers = std::thread::available_parallelism().map_or(1, |n| n.get()).min(8).min(paths.len());
    let mut got: Vec<(usize, LocalSong)> = std::thread::scope(|s| {
        let handles: Vec<_> = (0..workers)
            .map(|_| {
                s.spawn(|| {
                    let mut mine = Vec::new();
                    loop {
                        let i = next.fetch_add(1, Ordering::Relaxed);
                        let Some(p) = paths.get(i) else { return mine };
                        mine.push((i, read_song(p)));
                        progress(done.fetch_add(1, Ordering::Relaxed) + 1, paths.len());
                    }
                })
            })
            .collect();
        handles.into_iter().flat_map(|h| h.join().expect("tag reader")).collect()
    });
    got.sort_unstable_by_key(|(i, _)| *i);
    got.into_iter().map(|(_, t)| t).collect()
}

/// ReplayGain a scanner wrote in a file (foobar2000, MusicBee, rsgain…): the track's gain to -18 LUFS (dB) and peak
/// (1.0 = full scale), the album's when there.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReplayGain {
    pub track_db: f32,
    pub track_peak: Option<f32>,
    pub album: Option<(f32, Option<f32>)>,
}

/// A file's ReplayGain tags (ID3's TXXX, Vorbis comments, MP4 freeform, APE: names in any case). None without a
/// track gain.
pub fn replay_gain(path: &Path) -> Option<ReplayGain> {
    let file = tagged(path)?;
    let value = |key: ItemKey, range: std::ops::RangeInclusive<f32>| {
        // "-6.54 dB", "+2.10 dB", "0.988251".
        let num = |s: &str| s.trim().trim_end_matches(|c: char| c.is_ascii_alphabetic()).trim().parse::<f32>().ok().filter(|v| range.contains(v));
        file.primary_tag().into_iter().chain(file.tags()).find_map(|t| t.get_string(key).and_then(num))
    };
    let peak = |key| value(key, 0.000_01..=10.0);
    Some(ReplayGain {
        track_db: value(ItemKey::ReplayGainTrackGain, -60.0..=60.0)?,
        track_peak: peak(ItemKey::ReplayGainTrackPeak),
        album: value(ItemKey::ReplayGainAlbumGain, -60.0..=60.0).map(|db| (db, peak(ItemKey::ReplayGainAlbumPeak))),
    })
}

/// The file's tags and properties, covers left out (read() never shows them; picture() reads them on demand).
fn tagged(path: &Path) -> Option<TaggedFile> {
    Probe::open(path).ok()?.options(ParseOptions::new().read_cover_art(false)).read().ok()
}

/// A track number opening a file name, tried in order: "1-01 " (disc-track), "01. " / "01_" / "01) ", "01 - ", "01-",
/// "01 " (zero-padded only: "99 Luftballons" and "2 Become 1" are titles).
static TRACK_NO: LazyLock<[regex::Regex; 5]> = LazyLock::new(|| {
    [r"^\d-\d{2}(?:\s*[._)]|\s+-)?\s+", r"^\d{1,3}\s*[._)]\s*", r"^\d{1,3}\s+-\s+", r"^\d{1,3}-", r"^0\d{1,2}\s+"].map(|p| regex::Regex::new(p).expect("valid regex"))
});
/// After " - ", a version of the title rather than the title ("Imagine - Remastered 2010", "Get Lucky - Radio Edit").
static VERSION: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(?i)^(?:\d{4}\s+)?(?:remaster(?:ed)?|live|version|edit(?:ed|ion)?|(?:re)?mix(?:ed)?|demo|acoustic|instrumental|mono|stereo|radio|single|bonus|extended|original|explicit|clean)\b").expect("valid regex")
});

/// What a file name says when tags don't (ripped and downloaded files): its track number goes, "Artist - Title" splits.
/// 2026-10-30: the whole name was the title and every such file "Unknown artist", so none linked to the same song from
/// another service.
pub fn from_name(stem: &str) -> (Option<String>, String) {
    let stem = stem.trim();
    // Never into a number: "1-800-273-8255" stays whole.
    let name = TRACK_NO.iter().filter_map(|re| re.find(stem)).find(|m| stem[m.end()..].starts_with(|c: char| !c.is_ascii_digit())).map_or(stem, |m| &stem[m.end()..]);
    for dash in [" - ", " – ", " — "] {
        if let Some((artist, title)) = name.split_once(dash)
            && !artist.trim().is_empty()
            && !title.trim().is_empty()
            && !VERSION.is_match(title.trim())
        {
            return (Some(artist.trim().to_string()), title.trim().to_string());
        }
    }
    (None, name.trim().to_string())
}

/// Tags when present, file name otherwise. Unreadable file still listed (engine reports errors).
pub fn read(path: &Path) -> Track {
    read_song(path).track
}

/// The file's song, genre and year (a library row).
pub fn read_song(path: &Path) -> LocalSong {
    let file = tagged(path);
    let tag = file.as_ref().and_then(|f| f.primary_tag().or_else(|| f.first_tag()));
    let text = |v: Option<std::borrow::Cow<str>>| v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let (name_artist, name_title) = from_name(&path.file_stem().unwrap_or_default().to_string_lossy());
    let title = text(tag.and_then(|t| t.title()));
    // The name's artist only where its title is the song's (a title tag saying otherwise: the name is something else).
    let artist = text(tag.and_then(|t| t.artist())).or_else(|| name_artist.filter(|_| title.as_deref().is_none_or(|t| t.eq_ignore_ascii_case(&name_title))));
    let track = Track {
        title: title.unwrap_or(name_title),
        artist: artist.unwrap_or_else(|| "Unknown artist".into()),
        album: text(tag.and_then(|t| t.album())),
        duration_ms: file.as_ref().map(|f| f.properties().duration().as_millis() as u32).filter(|d| *d > 0),
        isrc: tag.and_then(|t| t.get_string(ItemKey::Isrc)).map(|s| s.trim().to_uppercase()).filter(|s| !s.is_empty()),
        ids: BTreeMap::from([(Source::Local, path.to_string_lossy().into_owned())]),
        art: None,
        // Your own audio files.
        musicness: Some(crate::musicness::Musicness::Music),
        explicit: false,
    };
    // Read as the song editor reads them (`file_tags`).
    LocalSong { track, genre: text(tag.and_then(|t| t.genre())), year: tag.and_then(|t| t.get_string(ItemKey::RecordingDate)).and_then(year_of) }
}

/// Embedded cover (front cover first, else any picture): bytes + MIME type.
pub fn picture(path: &Path) -> Option<(Vec<u8>, String)> {
    let file = lofty::read_from_path(path).ok()?;
    let pics: Vec<_> = file.tags().iter().flat_map(|t| t.pictures()).collect();
    let pic = pics.iter().find(|p| p.pic_type() == PictureType::CoverFront).or(pics.first())?;
    Some((pic.data().to_vec(), pic.mime_type().map_or("image/jpeg", |m| m.as_str()).to_string()))
}

/// Most a song's own lyrics may weigh here (an LRC is ~5 kB, a word-timed one ~30 kB).
pub const LYRICS_MAX: usize = 256 * 1024;

/// The song's own lyrics, as written: the LRC file beside it (same name), else its lyrics tag (ID3's USLT, Vorbis'
/// LYRICS, MP4's ©lyr). None = neither, empty, or over `LYRICS_MAX`.
pub fn lyrics(path: &Path) -> Option<String> {
    let usable = |s: &str| Some(s.trim_start_matches('\u{feff}')).filter(|s| !s.trim().is_empty() && s.len() <= LYRICS_MAX).map(str::to_string);
    let lrc = path.with_extension("lrc");
    if std::fs::metadata(&lrc).is_ok_and(|m| m.is_file() && m.len() <= LYRICS_MAX as u64)
        && let Some(text) = std::fs::read(&lrc).ok().and_then(|b| usable(&String::from_utf8_lossy(&b)))
    {
        return Some(text);
    }
    let file = tagged(path)?;
    file.primary_tag().into_iter().chain(file.tags()).find_map(|t| t.get_string(ItemKey::Lyrics).or_else(|| t.get_string(ItemKey::UnsyncLyrics)).and_then(usable))
}

/// A local file's tags as Edit song info shows them; None = not there.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileTags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    pub year: Option<u32>,
    pub track: Option<u32>,
    pub track_total: Option<u32>,
    pub disc: Option<u32>,
}

/// The file's main tag, read for the editor (like `read`: its first tag when the main kind is absent).
pub fn file_tags(path: &Path) -> FileTags {
    let Some(file) = tagged(path) else { return FileTags::default() };
    let Some(tag) = file.primary_tag().or_else(|| file.first_tag()) else { return FileTags::default() };
    let text = |v: Option<&str>| v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    FileTags {
        title: text(tag.get_string(ItemKey::TrackTitle)),
        artist: text(tag.get_string(ItemKey::TrackArtist)),
        album: text(tag.get_string(ItemKey::AlbumTitle)),
        album_artist: text(tag.get_string(ItemKey::AlbumArtist)),
        genre: text(tag.get_string(ItemKey::Genre)),
        year: tag.get_string(ItemKey::RecordingDate).and_then(year_of),
        track: tag.track(),
        track_total: tag.track_total(),
        disc: tag.disk(),
    }
}

/// "2019", "2019-05-02", "2019/05": the year. Anything else: none.
fn year_of(date: &str) -> Option<u32> {
    let y = date.trim().get(..4)?;
    y.bytes().all(|b| b.is_ascii_digit()).then(|| y.parse().ok()).flatten().filter(|y| *y > 0)
}

/// What the user rewrites in local files' tags (right-click › Edit song info, one song or several). None = as it is;
/// empty text or 0 = taken off.
#[derive(Debug, Clone, Default)]
pub struct TagEdit {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    pub year: Option<u32>,
    pub track: Option<u32>,
    pub track_total: Option<u32>,
    pub disc: Option<u32>,
    /// New front cover (PNG / JPEG / WebP / GIF bytes); None = the one there stays.
    pub cover: Option<Vec<u8>>,
    pub remove_cover: bool,
}

/// Rewrites the file's main tag in a copy next to it, then swaps the copy in: a failure leaves the original untouched.
/// The audio itself is never rewritten.
fn rewrite(path: &Path, change: impl FnOnce(&mut lofty::tag::Tag) -> anyhow::Result<()>) -> anyhow::Result<()> {
    use lofty::config::WriteOptions;
    use lofty::tag::Tag;
    let mut tmp = path.as_os_str().to_owned();
    // Not an audio extension: the folder watcher ignores it.
    tmp.push(".legato-tmp");
    let tmp = PathBuf::from(tmp);
    std::fs::copy(path, &tmp)?;
    let written = (|| -> anyhow::Result<()> {
        let file = Probe::open(&tmp)?.guess_file_type()?.read()?;
        let kind = file.primary_tag_type();
        let mut tag = file.tag(kind).cloned().unwrap_or_else(|| Tag::new(kind));
        change(&mut tag)?;
        tag.save_to_path(&tmp, WriteOptions::default())?;
        Ok(())
    })();
    match written {
        Ok(()) => std::fs::rename(&tmp, path).inspect_err(|_| drop(std::fs::remove_file(&tmp)))?,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
    }
    Ok(())
}

/// What's asked into the file's main tag, the rest as it was (right-click › Edit song info).
pub fn write_tags(path: &Path, edit: &TagEdit) -> anyhow::Result<()> {
    use lofty::picture::{MimeType, Picture};
    rewrite(path, |tag| {
        let texts = [
            (ItemKey::TrackTitle, edit.title.as_deref()),
            (ItemKey::TrackArtist, edit.artist.as_deref()),
            (ItemKey::AlbumTitle, edit.album.as_deref()),
            (ItemKey::AlbumArtist, edit.album_artist.as_deref()),
            (ItemKey::Genre, edit.genre.as_deref()),
        ];
        for (key, value) in texts {
            match value.map(str::trim) {
                None => {}
                Some("") => tag.remove_key(key),
                Some(v) => drop(tag.insert_text(key, v.to_string())),
            }
        }
        match edit.year {
            None => {}
            Some(0) => tag.remove_key(ItemKey::RecordingDate),
            Some(y) => drop(tag.insert_text(ItemKey::RecordingDate, y.to_string())),
        }
        use lofty::tag::Tag;
        let number = |tag: &mut Tag, value: Option<u32>, set: fn(&mut Tag, u32), remove: fn(&mut Tag)| match value {
            None => {}
            Some(0) => remove(tag),
            Some(n) => set(tag, n),
        };
        number(tag, edit.track, Tag::set_track, Tag::remove_track);
        number(tag, edit.track_total, Tag::set_track_total, Tag::remove_track_total);
        number(tag, edit.disc, Tag::set_disk, Tag::remove_disk);
        if edit.remove_cover || edit.cover.is_some() {
            tag.remove_picture_type(PictureType::CoverFront);
        }
        if let Some(bytes) = &edit.cover {
            let mime = match crate::themefile::image_ext(bytes) {
                Some("png") => MimeType::Png,
                Some("jpg") => MimeType::Jpeg,
                Some("gif") => MimeType::Gif,
                Some("webp") => MimeType::Unknown("image/webp".into()),
                _ => anyhow::bail!("Not a PNG, JPEG, WebP or GIF picture"),
            };
            tag.push_picture(Picture::unchecked(bytes.clone()).pic_type(PictureType::CoverFront).mime_type(mime).build());
        }
        Ok(())
    })
}

/// Saves the song's lyrics (LRC text, or plain) where it keeps them: the LRC file beside it when there is one, else its
/// main tag (ID3's USLT, Vorbis' LYRICS, MP4's ©lyr; MusicBee and foobar2000 read LRC text there too).
pub fn write_lyrics(path: &Path, text: &str) -> anyhow::Result<()> {
    let lrc = path.with_extension("lrc");
    if lrc.is_file() {
        // A copy written, then swapped in.
        let tmp = lrc.with_extension("lrc.legato-tmp");
        std::fs::write(&tmp, text)?;
        return Ok(std::fs::rename(&tmp, &lrc).inspect_err(|_| drop(std::fs::remove_file(&tmp)))?);
    }
    rewrite(path, |tag| {
        // ID3 has no LYRICS item: USLT.
        let key = if tag.tag_type() == lofty::tag::TagType::Id3v2 { ItemKey::UnsyncLyrics } else { ItemKey::Lyrics };
        tag.remove_key(ItemKey::Lyrics);
        tag.remove_key(ItemKey::UnsyncLyrics);
        anyhow::ensure!(tag.insert_text(key, text.to_string()), "This kind of file can't hold lyrics");
        Ok(())
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn reads_genre_and_year() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.wav");
        wav(&p);
        let s = read_song(&p);
        assert_eq!((s.genre, s.year), (None, None));
        let mut tag = lofty::tag::Tag::new(lofty::tag::TagType::Id3v2);
        tag.set_genre("Jazz".into());
        tag.insert_text(ItemKey::RecordingDate, "1959-08-17".into());
        tag.save_to_path(&p, lofty::config::WriteOptions::default()).unwrap();
        let s = read_song(&p);
        assert_eq!((s.genre.as_deref(), s.year, s.track.title.as_str()), (Some("Jazz"), Some(1959), "a"));
    }

    #[test]
    fn audio_by_extension() {
        assert!(is_audio(Path::new("C:/Music/a.MP3")));
        assert!(is_audio(Path::new("b.flac")));
        assert!(!is_audio(Path::new("cover.jpg")));
        assert!(!is_audio(Path::new("folder")));
    }

    /// 1 s silent 8 kHz mono WAV, no tags.
    pub fn wav(path: &Path) {
        let n: u32 = 8000;
        let mut b = Vec::new();
        b.extend(b"RIFF");
        b.extend((36 + n * 2).to_le_bytes());
        b.extend(b"WAVEfmt ");
        b.extend(16u32.to_le_bytes());
        b.extend(1u16.to_le_bytes());
        b.extend(1u16.to_le_bytes());
        b.extend(n.to_le_bytes());
        b.extend((n * 2).to_le_bytes());
        b.extend(2u16.to_le_bytes());
        b.extend(16u16.to_le_bytes());
        b.extend(b"data");
        b.extend((n * 2).to_le_bytes());
        b.resize(b.len() + (n * 2) as usize, 0);
        std::fs::write(path, b).unwrap();
    }

    #[test]
    fn scans_nested_audio_and_reads_fallbacks() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("Album")).unwrap();
        wav(&dir.path().join("Album").join("01 Intro.WAV"));
        std::fs::write(dir.path().join("cover.jpg"), b"x").unwrap();
        let found: Vec<Track> = scan(&[dir.path().to_path_buf(), dir.path().join("missing")]).into_iter().map(|s| s.track).collect();
        assert_eq!(found.len(), 1);
        let t = &found[0];
        assert_eq!((t.title.as_str(), t.artist.as_str()), ("Intro", "Unknown artist"));
        assert_eq!(t.duration_ms, Some(1000));
        assert!(t.ids[&Source::Local].ends_with("01 Intro.WAV"));
    }

    #[test]
    fn a_file_dropped_alone_is_scanned_once() {
        let dir = tempfile::tempdir().unwrap();
        let (folder, alone) = (dir.path().join("Album"), dir.path().join("Alone.wav"));
        std::fs::create_dir(&folder).unwrap();
        wav(&folder.join("Song.wav"));
        wav(&alone);
        std::fs::write(dir.path().join("notes.txt"), b"x").unwrap();
        // The folder, a file on its own, the folder's file again, a text file, a file gone.
        let found: Vec<Track> = scan(&[folder.clone(), alone, folder.join("Song.wav"), dir.path().join("notes.txt"), dir.path().join("gone.mp3")]).into_iter().map(|s| s.track).collect();
        let mut titles: Vec<&str> = found.iter().map(|t| t.title.as_str()).collect();
        titles.sort_unstable();
        assert_eq!(titles, ["Alone", "Song"]);
    }

    #[test]
    fn a_drop_adds_folders_and_keeps_files_outside_them() {
        let dir = tempfile::tempdir().unwrap();
        let at = |p: &str| dir.path().join(p);
        for d in ["Watched", "Watched/Live", "New"] {
            std::fs::create_dir(at(d)).unwrap();
        }
        for f in ["Watched/In.wav", "New/Old.wav", "Alone.wav"] {
            wav(&at(f));
        }
        std::fs::write(at("cover.jpg"), b"x").unwrap();
        let s = |p: PathBuf| p.to_string_lossy().into_owned();
        let (mut folders, mut loose) = (vec![s(at("Watched"))], vec![s(at("New/Old.wav"))]);
        // A folder a watched one holds, a new folder, a file of a watched folder, a file alone (twice), a picture.
        let dropped = [at("Watched/Live"), at("New"), at("Watched/In.wav"), at("Alone.wav"), at("Alone.wav"), at("cover.jpg")];
        assert_eq!(take_drop(&dropped, &mut folders, &mut loose), 1);
        assert_eq!(folders, [s(at("Watched")), s(at("New"))]);
        // New/Old.wav is the new folder's now.
        assert_eq!(loose, [s(at("Alone.wav"))]);
        assert_eq!(take_drop(&dropped, &mut folders, &mut loose), 0);
        assert_eq!((folders.len(), loose.len()), (2, 1));
    }

    #[test]
    fn names_say_what_tags_dont() {
        let some = |a: &str, t: &str| (Some(a.to_string()), t.to_string());
        assert_eq!(from_name("01 - Daft Punk - Get Lucky"), some("Daft Punk", "Get Lucky"));
        assert_eq!(from_name("Daft Punk – Get Lucky (feat. Pharrell Williams)"), some("Daft Punk", "Get Lucky (feat. Pharrell Williams)"));
        assert_eq!(from_name("AC-DC - Back in Black"), some("AC-DC", "Back in Black"));
        assert_eq!(from_name("Daft Punk - Get Lucky - Radio Edit"), some("Daft Punk", "Get Lucky - Radio Edit"));
        for (name, title) in [("03. Within", "Within"), ("1-01 Give Life Back to Music", "Give Life Back to Music"), ("01 Intro", "Intro"), ("12 - Contact", "Contact"), ("07_Touch", "Touch")] {
            assert_eq!(from_name(name), (None, title.to_string()), "{name}");
        }
        // Titles that open with a number, a version after a dash, a bare number: whole.
        for name in ["99 Luftballons", "2 Become 1", "1-800-273-8255", "2-4-6-8 Motorway", "100 Bad Days", "Get Lucky - Radio Edit", "Imagine - Remastered 2010", "Song - 2011 Remaster", "05"] {
            assert_eq!(from_name(name), (None, name.to_string()), "{name}");
        }
    }

    #[test]
    fn a_name_fills_in_only_what_the_tags_miss() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("02 - Daft Punk - Get Lucky.wav");
        wav(&p);
        let t = read(&p);
        assert_eq!((t.title.as_str(), t.artist.as_str()), ("Get Lucky", "Daft Punk"));
        // Its title tag is the name's: the name's artist comes along. Another title: the name is something else.
        let mut tag = lofty::tag::Tag::new(lofty::tag::TagType::Id3v2);
        tag.set_title("Get Lucky".into());
        tag.save_to_path(&p, lofty::config::WriteOptions::default()).unwrap();
        assert_eq!(read(&p).artist, "Daft Punk");
        tag.set_title("Something Else".into());
        tag.save_to_path(&p, lofty::config::WriteOptions::default()).unwrap();
        assert_eq!((read(&p).title.as_str(), read(&p).artist.as_str()), ("Something Else", "Unknown artist"));
    }

    #[test]
    fn a_scan_tells_how_far_it_has_read() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..12 {
            wav(&dir.path().join(format!("p{i:02}.wav")));
        }
        let seen = std::sync::Mutex::new(Vec::new());
        let songs = scan_with(&[dir.path().to_path_buf()], &|done, total| seen.lock().unwrap().push((done, total)));
        let mut seen = seen.into_inner().unwrap();
        seen.sort_unstable();
        // One report per file read, `done` counting 1 to 12 once each, `total` always the files to read.
        assert_eq!(songs.len(), 12);
        assert_eq!(seen, (1..=12).map(|d| (d, 12)).collect::<Vec<_>>());
    }

    #[test]
    fn rescans_keep_order_and_follow_changes() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..20 {
            wav(&dir.path().join(format!("{i:02}.wav")));
        }
        let dirs = [dir.path().to_path_buf()];
        let mut files = Vec::new();
        walk(dir.path(), &mut files);
        let one_by_one: Vec<String> = files.iter().map(|(p, _)| read(p).title).collect();
        let titles = |s: &[LocalSong]| s.iter().map(|s| s.track.title.clone()).collect::<Vec<_>>();
        assert_eq!(titles(&scan(&dirs)), one_by_one);
        // Tagged since (size changes): read again; deleted: gone; the rest as before.
        let p = dir.path().join("05.wav");
        let mut tag = lofty::tag::Tag::new(lofty::tag::TagType::Id3v2);
        tag.set_title("Renamed".into());
        tag.save_to_path(&p, lofty::config::WriteOptions::default()).unwrap();
        std::fs::remove_file(dir.path().join("07.wav")).unwrap();
        let again = titles(&scan(&dirs));
        assert_eq!(again.len(), 19);
        assert!(again.contains(&"Renamed".to_string()) && !again.contains(&"05".to_string()) && !again.contains(&"07".to_string()));
        assert!(again.contains(&"19".to_string()));
    }

    #[test]
    fn reads_embedded_cover() {
        use lofty::picture::{MimeType, Picture};
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.wav");
        wav(&p);
        assert_eq!(picture(&p), None);
        let mut tag = lofty::tag::Tag::new(lofty::tag::TagType::Id3v2);
        tag.push_picture(Picture::unchecked(b"back".to_vec()).pic_type(PictureType::CoverBack).mime_type(MimeType::Jpeg).build());
        tag.push_picture(Picture::unchecked(b"front".to_vec()).pic_type(PictureType::CoverFront).mime_type(MimeType::Png).build());
        tag.save_to_path(&p, lofty::config::WriteOptions::default()).unwrap();
        assert_eq!(picture(&p), Some((b"front".to_vec(), "image/png".into())));
    }

    #[test]
    fn reads_the_songs_own_lyrics() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.wav");
        wav(&p);
        assert_eq!(lyrics(&p), None);
        // In its tag (ID3's USLT for a WAV).
        let mut tag = lofty::tag::Tag::new(lofty::tag::TagType::Id3v2);
        tag.insert_text(ItemKey::UnsyncLyrics, "[00:01.00]From the tag".into());
        tag.save_to_path(&p, lofty::config::WriteOptions::default()).unwrap();
        assert_eq!(lyrics(&p).as_deref(), Some("[00:01.00]From the tag"));
        // An LRC beside it wins, its BOM dropped; an empty or oversized one doesn't count.
        let lrc = dir.path().join("a.lrc");
        std::fs::write(&lrc, "\u{feff}[00:02.00]Beside").unwrap();
        assert_eq!(lyrics(&p).as_deref(), Some("[00:02.00]Beside"));
        for skipped in [" \n".to_string(), "x".repeat(LYRICS_MAX + 1)] {
            std::fs::write(&lrc, skipped).unwrap();
            assert_eq!(lyrics(&p).as_deref(), Some("[00:01.00]From the tag"));
        }
    }

    #[test]
    fn reads_replaygain_tags_whatever_their_case() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.wav");
        wav(&p);
        assert_eq!(replay_gain(&p), None);
        let mut tag = lofty::tag::Tag::new(lofty::tag::TagType::Id3v2);
        tag.insert_text(ItemKey::ReplayGainTrackGain, "-6.54 dB".into());
        tag.insert_text(ItemKey::ReplayGainTrackPeak, "0.988251".into());
        tag.save_to_path(&p, lofty::config::WriteOptions::default()).unwrap();
        assert_eq!(replay_gain(&p), Some(ReplayGain { track_db: -6.54, track_peak: Some(0.988_251), album: None }));
        // foobar2000 writes ID3's names in lower case; an album gain without its peak; nonsense left out.
        let mut id3 = lofty::id3::v2::Id3v2Tag::new();
        for (name, value) in [("replaygain_track_gain", "+2.10 dB"), ("replaygain_track_peak", "lots"), ("replaygain_album_gain", "-1.5 dB")] {
            id3.insert(lofty::id3::v2::Frame::UserText(lofty::id3::v2::ExtendedTextFrame::new(lofty::TextEncoding::UTF8, name, value)));
        }
        id3.save_to_path(&p, lofty::config::WriteOptions::default()).unwrap();
        assert_eq!(replay_gain(&p), Some(ReplayGain { track_db: 2.1, track_peak: None, album: Some((-1.5, None)) }));
    }

    #[test]
    fn saves_lyrics_where_the_song_keeps_them() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.wav");
        wav(&p);
        write_tags(&p, &TagEdit { title: Some("Kept".into()), artist: Some("Someone".into()), ..Default::default() }).unwrap();
        let before = read(&p).duration_ms;
        write_lyrics(&p, "[00:01.00]Saved").unwrap();
        write_lyrics(&p, "[00:01.00]Saved again").unwrap();
        let t = read(&p);
        assert_eq!((lyrics(&p).as_deref(), t.title.as_str(), t.duration_ms), (Some("[00:01.00]Saved again"), "Kept", before));
        // An LRC beside it: written there, the tag as it was.
        let lrc = dir.path().join("a.lrc");
        std::fs::write(&lrc, "old").unwrap();
        write_lyrics(&p, "[00:02.00]Beside").unwrap();
        assert_eq!(std::fs::read_to_string(&lrc).unwrap(), "[00:02.00]Beside");
        std::fs::remove_file(&lrc).unwrap();
        assert_eq!(lyrics(&p).as_deref(), Some("[00:01.00]Saved again"));
        // No copy left behind.
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn rewrites_tags_and_cover_keeping_the_sound() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.wav");
        wav(&p);
        let sound = |p: &Path| read(p).duration_ms;
        let before = sound(&p);
        let png = vec![0x89, b'P', b'N', b'G', 1, 2, 3];
        write_tags(&p, &TagEdit { title: Some(" New title ".into()), artist: Some("Someone".into()), album: Some("Record".into()), cover: Some(png.clone()), ..Default::default() }).unwrap();
        let t = read(&p);
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.album.as_deref(), t.duration_ms), ("New title", "Someone", Some("Record"), before));
        assert_eq!(picture(&p), Some((png, "image/png".into())));
        // Album emptied, cover taken off; no copy left behind.
        write_tags(&p, &TagEdit { album: Some(String::new()), remove_cover: true, ..Default::default() }).unwrap();
        assert_eq!((read(&p).album, picture(&p)), (None, None));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        // Not a picture: refused, file as it was.
        let kept = std::fs::read(&p).unwrap();
        assert!(write_tags(&p, &TagEdit { title: Some("x".into()), cover: Some(b"MZ".to_vec()), ..Default::default() }).is_err());
        assert_eq!(std::fs::read(&p).unwrap(), kept);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn writes_numbers_year_and_genre_only_what_is_asked() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.wav");
        wav(&p);
        assert_eq!(file_tags(&p), FileTags::default());
        let all = TagEdit {
            title: Some("One".into()),
            artist: Some("Band".into()),
            album: Some("Record".into()),
            album_artist: Some("Various".into()),
            genre: Some("Rock".into()),
            year: Some(1999),
            track: Some(3),
            track_total: Some(12),
            disc: Some(2),
            ..Default::default()
        };
        write_tags(&p, &all).unwrap();
        let s = |v: &str| Some(v.to_string());
        let want = FileTags { title: s("One"), artist: s("Band"), album: s("Record"), album_artist: s("Various"), genre: s("Rock"), year: Some(1999), track: Some(3), track_total: Some(12), disc: Some(2) };
        assert_eq!(file_tags(&p), want);
        // Several songs: what isn't asked stays; empty text and 0 take a field off.
        write_tags(&p, &TagEdit { genre: Some(" ".into()), year: Some(0), track: Some(4), ..Default::default() }).unwrap();
        assert_eq!(file_tags(&p), FileTags { genre: None, year: None, track: Some(4), ..want });
        assert_eq!((year_of("2019-05-02"), year_of(" 1987"), year_of("87"), year_of("0000"), year_of("May 2019")), (Some(2019), Some(1987), None, None, None));
    }
}


