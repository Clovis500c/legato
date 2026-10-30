//! Local music folders: find audio files, read tags (lofty) into Tracks. Track id = file path.

use crate::model::{Source, Track};
use lofty::config::ParseOptions;
use lofty::file::TaggedFile;
use lofty::picture::PictureType;
use lofty::prelude::*;
use lofty::probe::Probe;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{LazyLock, Mutex, PoisonError};
use std::time::SystemTime;

/// File size and date: same = same tags.
type Stamp = (u64, Option<SystemTime>);

/// Tags read before, per file: a rescan reads only new or changed files. A watched folder rescans whole after each
/// change (one album copied into 5,000 files was 5,000 tag reads).
static KNOWN: LazyLock<Mutex<HashMap<PathBuf, (Stamp, Track)>>> = LazyLock::new(Mutex::default);

const AUDIO: [&str; 6] = ["mp3", "flac", "wav", "ogg", "m4a", "aac"];

/// An audio file the library takes, by its extension.
pub fn is_audio(path: &Path) -> bool {
    path.extension().and_then(|x| x.to_str()).is_some_and(|x| AUDIO.contains(&x.to_ascii_lowercase().as_str()))
}

/// All audio files under `dirs`, recursively. Symlinked dirs skipped (no loops).
pub fn scan(dirs: &[PathBuf]) -> Vec<Track> {
    let mut files = Vec::new();
    for d in dirs {
        walk(d, &mut files);
    }
    let old = std::mem::take(&mut *KNOWN.lock().unwrap_or_else(PoisonError::into_inner));
    // No date known: read again.
    let kept = |path: &PathBuf, stamp: &Stamp| old.get(path).filter(|(s, _)| stamp.1.is_some() && s == stamp).map(|(_, t)| t.clone());
    let todo: Vec<&Path> = files.iter().filter(|(p, s)| kept(p, s).is_none()).map(|(p, _)| p.as_path()).collect();
    let mut fresh = read_all(&todo).into_iter();
    let mut now = HashMap::with_capacity(files.len());
    let out = files
        .into_iter()
        .map(|(path, stamp)| {
            let track = kept(&path, &stamp).unwrap_or_else(|| fresh.next().expect("one read per new file"));
            now.insert(path, (stamp, track.clone()));
            track
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
            let meta = e.metadata().ok();
            out.push((path, (meta.as_ref().map_or(0, |m| m.len()), meta.and_then(|m| m.modified().ok()))));
        }
    }
}

/// Tags of `paths`, in order, read on a few threads: one file's disk wait overlaps another's parsing.
fn read_all(paths: &[&Path]) -> Vec<Track> {
    let next = AtomicUsize::new(0);
    let workers = std::thread::available_parallelism().map_or(1, |n| n.get()).min(8).min(paths.len());
    let mut got: Vec<(usize, Track)> = std::thread::scope(|s| {
        let handles: Vec<_> = (0..workers)
            .map(|_| {
                s.spawn(|| {
                    let mut mine = Vec::new();
                    loop {
                        let i = next.fetch_add(1, Ordering::Relaxed);
                        let Some(p) = paths.get(i) else { return mine };
                        mine.push((i, read(p)));
                    }
                })
            })
            .collect();
        handles.into_iter().flat_map(|h| h.join().expect("tag reader")).collect()
    });
    got.sort_unstable_by_key(|(i, _)| *i);
    got.into_iter().map(|(_, t)| t).collect()
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
    let file = tagged(path);
    let tag = file.as_ref().and_then(|f| f.primary_tag().or_else(|| f.first_tag()));
    let text = |v: Option<std::borrow::Cow<str>>| v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let (name_artist, name_title) = from_name(&path.file_stem().unwrap_or_default().to_string_lossy());
    let title = text(tag.and_then(|t| t.title()));
    // The name's artist only where its title is the song's (a title tag saying otherwise: the name is something else).
    let artist = text(tag.and_then(|t| t.artist())).or_else(|| name_artist.filter(|_| title.as_deref().is_none_or(|t| t.eq_ignore_ascii_case(&name_title))));
    Track {
        title: title.unwrap_or(name_title),
        artist: artist.unwrap_or_else(|| "Unknown artist".into()),
        album: text(tag.and_then(|t| t.album())),
        duration_ms: file.as_ref().map(|f| f.properties().duration().as_millis() as u32).filter(|d| *d > 0),
        isrc: tag.and_then(|t| t.get_string(ItemKey::Isrc)).map(|s| s.trim().to_uppercase()).filter(|s| !s.is_empty()),
        ids: BTreeMap::from([(Source::Local, path.to_string_lossy().into_owned())]),
        art: None,
        // Your own audio files.
        musicness: Some(crate::musicness::Musicness::Music),
    }
}

/// Embedded cover (front cover first, else any picture): bytes + MIME type.
pub fn picture(path: &Path) -> Option<(Vec<u8>, String)> {
    let file = lofty::read_from_path(path).ok()?;
    let pics: Vec<_> = file.tags().iter().flat_map(|t| t.pictures()).collect();
    let pic = pics.iter().find(|p| p.pic_type() == PictureType::CoverFront).or(pics.first())?;
    Some((pic.data().to_vec(), pic.mime_type().map_or("image/jpeg", |m| m.as_str()).to_string()))
}

/// What the user rewrites in a local file's tags (right-click › Edit song info).
#[derive(Debug, Clone, Default)]
pub struct TagEdit {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    /// New front cover (PNG / JPEG / WebP / GIF bytes); None = the one there stays.
    pub cover: Option<Vec<u8>>,
    pub remove_cover: bool,
}

/// Rewrites the file's main tag in a copy next to it, then swaps the copy in: a failure leaves the original untouched.
/// The audio itself is never rewritten.
pub fn write_tags(path: &Path, edit: &TagEdit) -> anyhow::Result<()> {
    use lofty::config::WriteOptions;
    use lofty::picture::{MimeType, Picture};
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
        tag.set_title(edit.title.trim().to_string());
        tag.set_artist(edit.artist.trim().to_string());
        match edit.album.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
            Some(a) => tag.set_album(a.to_string()),
            None => tag.remove_album(),
        }
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

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

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
        let found = scan(&[dir.path().to_path_buf(), dir.path().join("missing")]);
        assert_eq!(found.len(), 1);
        let t = &found[0];
        assert_eq!((t.title.as_str(), t.artist.as_str()), ("Intro", "Unknown artist"));
        assert_eq!(t.duration_ms, Some(1000));
        assert!(t.ids[&Source::Local].ends_with("01 Intro.WAV"));
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
    fn rescans_keep_order_and_follow_changes() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..20 {
            wav(&dir.path().join(format!("{i:02}.wav")));
        }
        let dirs = [dir.path().to_path_buf()];
        let mut files = Vec::new();
        walk(dir.path(), &mut files);
        let one_by_one: Vec<String> = files.iter().map(|(p, _)| read(p).title).collect();
        let titles = |t: &[Track]| t.iter().map(|t| t.title.clone()).collect::<Vec<_>>();
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
    fn rewrites_tags_and_cover_keeping_the_sound() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.wav");
        wav(&p);
        let sound = |p: &Path| read(p).duration_ms;
        let before = sound(&p);
        let png = vec![0x89, b'P', b'N', b'G', 1, 2, 3];
        write_tags(&p, &TagEdit { title: " New title ".into(), artist: "Someone".into(), album: Some("Record".into()), cover: Some(png.clone()), remove_cover: false }).unwrap();
        let t = read(&p);
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.album.as_deref(), t.duration_ms), ("New title", "Someone", Some("Record"), before));
        assert_eq!(picture(&p), Some((png, "image/png".into())));
        // Album emptied, cover taken off; no copy left behind.
        write_tags(&p, &TagEdit { title: "New title".into(), artist: "Someone".into(), album: None, cover: None, remove_cover: true }).unwrap();
        assert_eq!((read(&p).album, picture(&p)), (None, None));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        // Not a picture: refused, file as it was.
        let kept = std::fs::read(&p).unwrap();
        assert!(write_tags(&p, &TagEdit { title: "x".into(), artist: "y".into(), cover: Some(b"MZ".to_vec()), ..Default::default() }).is_err());
        assert_eq!(std::fs::read(&p).unwrap(), kept);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}


