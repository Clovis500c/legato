//! Data for `pnpm bench` (scripts/bench.mjs): a fresh app data folder holding a library of local songs, playlists and
//! plays, written through the same `Library` the app opens. `cargo run -p music-core --example bench_data -- <data-dir>
//! [songs]` (10 000 songs by default). The songs are files of silence the example writes itself: a few WAVs, each song a
//! hard link to one of them, since the library keys a local song by its path and every song needs its own.

use anyhow::{Context, Result, ensure};
use music_core::history::Play;
use music_core::library::{Library, PlaylistEdit, now_ms};
use music_core::model::{Source, Track};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

/// Silent files the songs link to. NTFS allows 1023 links per file: 16 files carry 10 000 songs with room to spare.
const MASTERS: usize = 16;
const RATE: u32 = 44_100;
const PLAYLISTS: usize = 12;
const PLAYS: usize = 3000;

/// `seconds` of 16-bit stereo silence.
fn write_silence(path: &Path, seconds: u32) -> Result<()> {
    let data = seconds * RATE * 4;
    let mut f = BufWriter::new(File::create(path)?);
    f.write_all(b"RIFF")?;
    f.write_all(&(36 + data).to_le_bytes())?;
    f.write_all(b"WAVEfmt ")?;
    f.write_all(&16u32.to_le_bytes())?;
    // PCM, 2 channels, rate, bytes per second, bytes per frame, bits.
    f.write_all(&1u16.to_le_bytes())?;
    f.write_all(&2u16.to_le_bytes())?;
    f.write_all(&RATE.to_le_bytes())?;
    f.write_all(&(RATE * 4).to_le_bytes())?;
    f.write_all(&4u16.to_le_bytes())?;
    f.write_all(&16u16.to_le_bytes())?;
    f.write_all(b"data")?;
    f.write_all(&data.to_le_bytes())?;
    let zeros = [0u8; 1 << 16];
    let mut left = data as usize;
    while left > 0 {
        let n = left.min(zeros.len());
        f.write_all(&zeros[..n])?;
        left -= n;
    }
    f.flush()?;
    Ok(())
}

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let dir = Path::new(&args.next().context("usage: bench_data <data-dir> [songs]")?).to_path_buf();
    let songs: usize = args.next().map(|n| n.parse()).transpose().context("songs: a number")?.unwrap_or(10_000);
    ensure!((1..=MASTERS * 1000).contains(&songs), "songs: 1 to {}", MASTERS * 1000);
    let db = dir.join("library.db");
    // Never into a library that exists: the caller deletes its own bench folder first.
    ensure!(!db.exists(), "{} already holds a library: delete that folder first", dir.display());
    let media = dir.join("media");
    std::fs::create_dir_all(&media)?;

    // 20 to 27 s, so the songs do not all end together.
    let lengths: Vec<u32> = (0..MASTERS as u32).map(|k| 20 + k % 8).collect();
    for (k, seconds) in lengths.iter().enumerate() {
        write_silence(&media.join(format!("master-{k:02}.wav")), *seconds)?;
    }
    let tracks = (0..songs)
        .map(|i| {
            let k = i % MASTERS;
            let path = media.join(format!("song-{i:05}.wav"));
            std::fs::hard_link(media.join(format!("master-{k:02}.wav")), &path).with_context(|| format!("linking {}", path.display()))?;
            // 12 songs an album, one artist an album.
            let album = i / 12;
            Ok(Track {
                title: format!("Song {i:05}"),
                artist: format!("Artist {:03}", album % 700),
                album: Some(format!("Album {album:04}")),
                duration_ms: Some(lengths[k] * 1000),
                ids: BTreeMap::from([(Source::Local, path.to_string_lossy().into_owned())]),
                ..Track::default()
            })
        })
        .collect::<Result<Vec<_>>>()?;

    let lib = Library::open(&db)?;
    ensure!(lib.replace_local(&tracks)? == songs, "the library merged some songs");
    let ids: Vec<i64> = lib.tracks()?.iter().map(|t| t.id).collect();
    for n in 0..PLAYLISTS.min(ids.len()) {
        let id = lib.edit_playlist(PlaylistEdit::Create { name: format!("Mix {:02}", n + 1) })?.context("playlist id")?;
        let from = (n * 700) % ids.len();
        let to = (from + 200 + n * 40).min(ids.len());
        lib.edit_playlist(PlaylistEdit::Add { id, track_ids: ids[from..to].to_vec() })?;
    }
    // Plays over the last two months, a few songs far more often than the rest.
    let now = now_ms() / 1000;
    for j in 0..PLAYS {
        let track_id = ids[(j * j + 7 * j) % ids.len()];
        lib.record_play(&Play { track_id, started_at: now - 1700 * j as i64, listened_ms: 30_000 + (j as u32 % 7) * 20_000, completed: j % 3 != 0 })?;
    }
    println!("{songs} songs, {PLAYLISTS} playlists, {PLAYS} plays in {}", dir.display());
    Ok(())
}
