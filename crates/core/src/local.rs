//! Local music folders: find audio files, read tags (lofty) into Tracks. Track id = file path.

use crate::model::{Source, Track};
use lofty::prelude::*;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const AUDIO: [&str; 6] = ["mp3", "flac", "wav", "ogg", "m4a", "aac"];

/// All audio files under `dirs`, recursively. Symlinked dirs skipped (no loops).
pub fn scan(dirs: &[PathBuf]) -> Vec<Track> {
    let mut out = Vec::new();
    for d in dirs {
        walk(d, &mut out);
    }
    out
}

fn walk(dir: &Path, out: &mut Vec<Track>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let Ok(kind) = e.file_type() else { continue };
        let path = e.path();
        if kind.is_dir() {
            walk(&path, out);
        } else if kind.is_file() && path.extension().and_then(|x| x.to_str()).is_some_and(|x| AUDIO.contains(&x.to_ascii_lowercase().as_str())) {
            out.push(read(&path));
        }
    }
}

/// Tags when present, file name otherwise. Unreadable file still listed (engine reports errors).
pub fn read(path: &Path) -> Track {
    let file = lofty::read_from_path(path).ok();
    let tag = file.as_ref().and_then(|f| f.primary_tag().or_else(|| f.first_tag()));
    let text = |v: Option<std::borrow::Cow<str>>| v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    Track {
        title: text(tag.and_then(|t| t.title())).unwrap_or_else(|| path.file_stem().unwrap_or_default().to_string_lossy().into()),
        artist: text(tag.and_then(|t| t.artist())).unwrap_or_else(|| "Artiste inconnu".into()),
        album: text(tag.and_then(|t| t.album())),
        duration_ms: file.as_ref().map(|f| f.properties().duration().as_millis() as u32).filter(|d| *d > 0),
        isrc: tag.and_then(|t| t.get_string(ItemKey::Isrc)).map(|s| s.trim().to_uppercase()).filter(|s| !s.is_empty()),
        ids: BTreeMap::from([(Source::Local, path.to_string_lossy().into_owned())]),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

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
        assert_eq!((t.title.as_str(), t.artist.as_str()), ("01 Intro", "Artiste inconnu"));
        assert_eq!(t.duration_ms, Some(1000));
        assert!(t.ids[&Source::Local].ends_with("01 Intro.WAV"));
    }
}
