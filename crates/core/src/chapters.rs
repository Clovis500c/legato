//! Chapters of an audiobook file: the `chpl` list of an `.m4b` / `.m4a` (Nero chapters, what ffmpeg and mp4v2 write), read
//! from the `moov` box only, QuickTime chapter tracks (Apple's and Audible's books) when there is no such list, and the
//! `CHAP` frames of an mp3's ID3v2 tag.

use serde::Serialize;
use std::io::{Read, Seek, SeekFrom};

/// A `moov` box bigger than this is not read (a real one is some hundred kB; the sample tables of a long book, a few MB).
const MOOV_MAX: u64 = 32 * 1024 * 1024;
const MAX_CHAPTERS: usize = 2_000;

#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Chapter {
    pub start_ms: u64,
    pub title: String,
}

/// A box header at the reader's position: (type, content size), or None at the end / on a size that cannot be right.
fn header<R: Read>(r: &mut R, left: u64) -> Option<([u8; 4], u64)> {
    let mut h = [0u8; 8];
    r.read_exact(&mut h).ok()?;
    let (size, kind) = (u32::from_be_bytes(h[..4].try_into().ok()?) as u64, [h[4], h[5], h[6], h[7]]);
    let (total, head) = match size {
        0 => (left, 8),
        1 => {
            let mut big = [0u8; 8];
            r.read_exact(&mut big).ok()?;
            (u64::from_be_bytes(big), 16)
        }
        n => (n, 8),
    };
    (total >= head && total <= left).then_some((kind, total - head))
}

/// Walks the boxes in the next `len` bytes, handing each (type, content size) to `visit`, which reads its content (it
/// must leave the reader anywhere inside it) or not; the next box is found by position.
fn each<R: Read + Seek>(r: &mut R, len: u64, mut visit: impl FnMut(&mut R, [u8; 4], u64) -> Option<()>) -> Option<()> {
    let start = r.stream_position().ok()?;
    let end = start + len;
    let mut at = start;
    while at + 8 <= end {
        r.seek(SeekFrom::Start(at)).ok()?;
        let (kind, size) = header(r, end - at)?;
        let body = r.stream_position().ok()?;
        visit(r, kind, size)?;
        at = body + size;
    }
    Some(())
}

/// Chapters of an MP4 audiobook or an mp3 with ID3 chapters, in time order; empty when the file has none or is neither.
pub fn read_chapters<R: Read + Seek>(r: &mut R) -> Vec<Chapter> {
    let Ok(total) = r.seek(SeekFrom::End(0)) else { return Vec::new() };
    if r.seek(SeekFrom::Start(0)).is_err() {
        return Vec::new();
    }
    let mut magic = [0u8; 3];
    if r.read_exact(&mut magic).is_ok() && &magic == b"ID3" {
        return id3_chapters(r);
    }
    if r.seek(SeekFrom::Start(0)).is_err() {
        return Vec::new();
    }
    let mut moov = Vec::new();
    let _ = each(r, total, |r, kind, size| {
        if &kind == b"moov" && size <= MOOV_MAX && moov.is_empty() {
            moov = vec![0u8; size as usize];
            r.read_exact(&mut moov).ok()?;
        }
        Some(())
    });
    let nero = find(&moov, &[b"udta", b"chpl"]).map(parse_chpl).unwrap_or_default();
    if nero.is_empty() { quicktime_chapters(r, &moov) } else { nero }
}

/// The boxes laid end to end in `b`: (type, content).
fn boxes(b: &[u8]) -> Vec<([u8; 4], &[u8])> {
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(h) = b.get(at..at + 8) {
        let size = u32::from_be_bytes([h[0], h[1], h[2], h[3]]) as usize;
        if size < 8 {
            break;
        }
        let Some(body) = b.get(at + 8..at + size) else { break };
        out.push(([h[4], h[5], h[6], h[7]], body));
        at += size;
    }
    out
}

/// The content of the box reached by the path of types under `b`.
fn find<'a>(b: &'a [u8], path: &[&[u8; 4]]) -> Option<&'a [u8]> {
    let (first, rest) = path.split_first()?;
    let body = boxes(b).into_iter().find(|(k, _)| k == *first)?.1;
    if rest.is_empty() { Some(body) } else { find(body, rest) }
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// A QuickTime chapter list (Apple's and Audible's books): the first track a `tref/chap` points to is a text track whose samples
/// (a two-byte length and the title) are the chapter titles, timed by the track's sample table. Read from the sample table only:
/// durations (`stts`), sizes (`stsz`), chunks (`stsc`, `stco` / `co64`), the timescale (`mdhd`).
fn quicktime_chapters<R: Read + Seek>(r: &mut R, moov: &[u8]) -> Vec<Chapter> {
    let traks: Vec<&[u8]> = boxes(moov).into_iter().filter(|(k, _)| k == b"trak").map(|(_, b)| b).collect();
    let id = |t: &[u8]| find(t, &[b"tkhd"]).and_then(|h| be32(h, if h.first() == Some(&1) { 20 } else { 12 }));
    let Some(target) = traks.iter().find_map(|t| find(t, &[b"tref", b"chap"]).and_then(|c| be32(c, 0))) else { return Vec::new() };
    let Some(text) = traks.iter().find(|t| id(t) == Some(target)) else { return Vec::new() };
    let table = |kind: &[u8; 4]| find(text, &[b"mdia", b"minf", b"stbl", kind]);
    let Some(scale) = find(text, &[b"mdia", b"mdhd"]).and_then(|h| be32(h, if h.first() == Some(&1) { 20 } else { 12 })).filter(|&s| s > 0) else { return Vec::new() };
    let (Some(stts), Some(stsz), Some(stsc)) = (table(b"stts"), table(b"stsz"), table(b"stsc")) else { return Vec::new() };
    // Chunk offsets: 32-bit `stco`, else 64-bit `co64`.
    let offsets: Vec<u64> = if let Some(c) = table(b"stco") {
        (0..be32(c, 4).unwrap_or(0) as usize).map_while(|i| be32(c, 8 + 4 * i).map(u64::from)).collect()
    } else if let Some(c) = table(b"co64") {
        (0..be32(c, 4).unwrap_or(0) as usize).map_while(|i| c.get(8 + 8 * i..16 + 8 * i).map(|b| u64::from_be_bytes(b.try_into().unwrap_or([0; 8])))).collect()
    } else {
        return Vec::new();
    };
    let count = be32(stsz, 8).unwrap_or(0) as usize;
    if count == 0 || count > MAX_CHAPTERS {
        return Vec::new();
    }
    let fixed = be32(stsz, 4).unwrap_or(0);
    let size = |i: usize| if fixed > 0 { Some(fixed) } else { be32(stsz, 12 + 4 * i) };
    // Samples per chunk: (first chunk, samples) runs.
    let runs: Vec<(u32, u32)> = (0..be32(stsc, 4).unwrap_or(0) as usize).map_while(|i| Some((be32(stsc, 8 + 12 * i)?, be32(stsc, 12 + 12 * i)?))).collect();
    // Where each sample sits in the file.
    let mut at: Vec<u64> = Vec::new();
    'chunks: for (ci, &chunk) in offsets.iter().enumerate() {
        let n = runs.iter().rev().find(|(first, _)| *first as usize <= ci + 1).map_or(1, |r| r.1) as usize;
        let mut pos = chunk;
        for _ in 0..n {
            if at.len() == count {
                break 'chunks;
            }
            at.push(pos);
            pos += size(at.len() - 1).unwrap_or(0) as u64;
        }
    }
    let (mut out, mut ticks) = (Vec::new(), 0u64);
    let mut durations = (0..be32(stts, 4).unwrap_or(0) as usize).map_while(|i| Some((be32(stts, 8 + 8 * i)?, be32(stts, 12 + 8 * i)?))).flat_map(|(n, d)| std::iter::repeat_n(d as u64, n as usize));
    for (i, &pos) in at.iter().enumerate() {
        let (Some(len), Some(d)) = (size(i), durations.next()) else { break };
        let mut sample = vec![0u8; len.min(4096) as usize];
        if r.seek(SeekFrom::Start(pos)).is_err() || r.read_exact(&mut sample).is_err() || sample.len() < 2 {
            break;
        }
        let n = u16::from_be_bytes([sample[0], sample[1]]) as usize;
        let raw = &sample[2..(2 + n).min(sample.len())];
        let title = match raw {
            [0xfe, 0xff, rest @ ..] => String::from_utf16_lossy(&rest.as_chunks::<2>().0.iter().map(|c| u16::from_be_bytes(*c)).collect::<Vec<_>>()),
            _ => String::from_utf8_lossy(raw).into_owned(),
        };
        out.push(Chapter { start_ms: ticks * 1000 / scale as u64, title: title.trim().to_string() });
        ticks += d;
    }
    out
}

/// An ID3v2 tag larger than this is not read.
const ID3_MAX: usize = 16 * 1024 * 1024;

fn syncsafe(b: &[u8]) -> usize {
    b.iter().fold(0, |n, &x| n << 7 | (x & 0x7f) as usize)
}

/// An ID3 text frame body: an encoding byte, then the text (Latin-1, UTF-16 with or without a byte order mark, UTF-8).
fn id3_text(b: &[u8]) -> String {
    let Some((&enc, text)) = b.split_first() else { return String::new() };
    let utf16 = |t: &[u8], big: bool| String::from_utf16_lossy(&t.as_chunks::<2>().0.iter().map(|c| if big { u16::from_be_bytes(*c) } else { u16::from_le_bytes(*c) }).collect::<Vec<_>>());
    let s = match enc {
        1 => match text {
            [0xff, 0xfe, rest @ ..] => utf16(rest, false),
            [0xfe, 0xff, rest @ ..] => utf16(rest, true),
            _ => utf16(text, false),
        },
        2 => utf16(text, true),
        3 => String::from_utf8_lossy(text).into_owned(),
        _ => text.iter().map(|&c| c as char).collect(),
    };
    s.trim_matches(|c: char| c == '\0' || c.is_whitespace()).to_string()
}

/// The frames in `b` (ID3v2.3 sizes are plain numbers, v2.4's syncsafe): (id, body), stopping at the padding or a size that
/// does not fit.
fn id3_frames(b: &[u8], v4: bool) -> Vec<([u8; 4], &[u8])> {
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(h) = b.get(at..at + 10) {
        if h[0] == 0 {
            break;
        }
        let size = if v4 { syncsafe(&h[4..8]) } else { u32::from_be_bytes([h[4], h[5], h[6], h[7]]) as usize };
        let Some(body) = b.get(at + 10..at + 10 + size) else { break };
        out.push(([h[0], h[1], h[2], h[3]], body));
        at += 10 + size;
    }
    out
}

/// The `CHAP` frames of the ID3v2.3 / v2.4 tag at the start of the file (the reader is after the "ID3" mark): the start in
/// milliseconds and the `TIT2` title of each.
fn id3_chapters<R: Read>(r: &mut R) -> Vec<Chapter> {
    let mut head = [0u8; 7];
    if r.read_exact(&mut head).is_err() || !(3..=4).contains(&head[0]) {
        return Vec::new();
    }
    let size = syncsafe(&head[3..7]);
    if size > ID3_MAX {
        return Vec::new();
    }
    let mut tag = vec![0u8; size];
    if r.read_exact(&mut tag).is_err() {
        return Vec::new();
    }
    let v4 = head[0] == 4;
    // The extended header (flag 0x40) comes first: its size is syncsafe in v2.4, plain (not counting itself) in v2.3.
    let skip = if head[2] & 0x40 == 0 || tag.len() < 4 {
        0
    } else if v4 {
        syncsafe(&tag[..4])
    } else {
        4 + u32::from_be_bytes([tag[0], tag[1], tag[2], tag[3]]) as usize
    };
    let mut out = Vec::new();
    for (id, body) in id3_frames(tag.get(skip..).unwrap_or(&[]), v4) {
        if &id != b"CHAP" {
            continue;
        }
        let Some(end) = body.iter().position(|&c| c == 0) else { continue };
        let Some(times) = body.get(end + 1..end + 17) else { continue };
        let start_ms = u32::from_be_bytes([times[0], times[1], times[2], times[3]]) as u64;
        let title = id3_frames(&body[end + 17..], v4).into_iter().find(|(id, _)| id == b"TIT2").map(|(_, t)| id3_text(t)).unwrap_or_default();
        out.push(Chapter { start_ms, title });
        if out.len() >= MAX_CHAPTERS {
            break;
        }
    }
    out.sort_by_key(|c| c.start_ms);
    out
}

/// A `chpl` body: version, flags, (version 1: 4 reserved bytes), a count, then per chapter a start in 100 ns units and a
/// title with a one-byte length.
fn parse_chpl(b: &[u8]) -> Vec<Chapter> {
    let Some(&version) = b.first() else { return Vec::new() };
    let mut at = if version == 1 { 8 } else { 4 };
    let (count, rest) = match b.get(at) {
        Some(&n) => (n as usize, at + 1),
        None => return Vec::new(),
    };
    at = rest;
    let mut out = Vec::new();
    for _ in 0..count.min(MAX_CHAPTERS) {
        let (Some(start), Some(&len)) = (b.get(at..at + 8), b.get(at + 8)) else { break };
        let Some(title) = b.get(at + 9..at + 9 + len as usize) else { break };
        let ms = u64::from_be_bytes(start.try_into().unwrap_or([0; 8])) / 10_000;
        out.push(Chapter { start_ms: ms, title: String::from_utf8_lossy(title).trim().to_string() });
        at += 9 + len as usize;
    }
    out.sort_by_key(|c| c.start_ms);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn boxed(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut v = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        v.extend(kind);
        v.extend(body);
        v
    }

    fn chpl(list: &[(u64, &str)]) -> Vec<u8> {
        let mut b = vec![1, 0, 0, 0, 0, 0, 0, 0, list.len() as u8];
        for (ms, title) in list {
            b.extend((ms * 10_000).to_be_bytes());
            b.push(title.len() as u8);
            b.extend(title.as_bytes());
        }
        boxed(b"chpl", &b)
    }

    fn book(list: &[(u64, &str)]) -> Vec<u8> {
        let mut file = boxed(b"ftyp", b"M4B \0\0\0\0M4B ");
        file.extend(boxed(b"mdat", &[0u8; 100]));
        file.extend(boxed(b"moov", &[boxed(b"mvhd", &[0u8; 20]), boxed(b"udta", &chpl(list))].concat()));
        file
    }

    #[test]
    fn reads_the_chapters_of_a_book_in_time_order() {
        let file = book(&[(61_500, "Chapter 2"), (0, "Opening"), (3_600_000, "Café")]);
        let c = read_chapters(&mut Cursor::new(file));
        assert_eq!(c.iter().map(|c| (c.start_ms, c.title.as_str())).collect::<Vec<_>>(), [(0, "Opening"), (61_500, "Chapter 2"), (3_600_000, "Café")]);
    }

    fn frame(id: &[u8; 4], body: &[u8], v4: bool) -> Vec<u8> {
        let n = body.len();
        let size = if v4 { vec![(n >> 21) as u8 & 0x7f, (n >> 14) as u8 & 0x7f, (n >> 7) as u8 & 0x7f, n as u8 & 0x7f] } else { (n as u32).to_be_bytes().to_vec() };
        [id.as_slice(), &size, &[0, 0], body].concat()
    }

    fn chap(name: &str, start: u32, title: &[u8], v4: bool) -> Vec<u8> {
        let mut b = name.as_bytes().to_vec();
        b.push(0);
        b.extend(start.to_be_bytes());
        b.extend([0xff; 12]);
        b.extend(frame(b"TIT2", title, v4));
        frame(b"CHAP", &b, v4)
    }

    fn mp3(version: u8, frames: &[Vec<u8>]) -> Vec<u8> {
        let body: Vec<u8> = frames.concat();
        let n = body.len() + 20;
        let mut f = vec![b'I', b'D', b'3', version, 0, 0, (n >> 21) as u8 & 0x7f, (n >> 14) as u8 & 0x7f, (n >> 7) as u8 & 0x7f, n as u8 & 0x7f];
        f.extend(body);
        f.extend([0u8; 20]);
        f.extend([0xff, 0xfb, 0x90, 0x00]);
        f
    }

    fn b32(n: u32) -> Vec<u8> {
        n.to_be_bytes().to_vec()
    }

    /// A book whose chapters are a QuickTime text track: samples (length + title) in one `mdat`, two chunks.
    fn quicktime_book(titles: &[&str], durations: &[u32]) -> Vec<u8> {
        let ftyp = boxed(b"ftyp", b"M4B \0\0\0\0M4B ");
        let samples: Vec<Vec<u8>> = titles.iter().map(|t| [(t.len() as u16).to_be_bytes().to_vec(), t.as_bytes().to_vec()].concat()).collect();
        // Chunk 1 holds the first sample, chunk 2 the rest.
        let mdat_at = (ftyp.len() + 8) as u32;
        let second = mdat_at + samples[0].len() as u32;
        let mdat = boxed(b"mdat", &samples.concat());
        let stbl = boxed(
            b"stbl",
            &[
                boxed(b"stts", &[b32(0), b32(durations.len() as u32), durations.iter().flat_map(|d| [b32(1), b32(*d)].concat()).collect()].concat()),
                boxed(b"stsc", &[b32(0), b32(2), b32(1), b32(1), b32(1), b32(2), b32(titles.len() as u32 - 1), b32(1)].concat()),
                boxed(b"stsz", &[b32(0), b32(0), b32(samples.len() as u32), samples.iter().flat_map(|s| b32(s.len() as u32)).collect()].concat()),
                boxed(b"stco", &[b32(0), b32(2), b32(mdat_at), b32(second)].concat()),
            ]
            .concat(),
        );
        let tkhd = |id: u32| boxed(b"tkhd", &[b32(0), b32(0), b32(0), b32(id), vec![0u8; 68]].concat());
        let audio = boxed(b"trak", &[tkhd(1), boxed(b"tref", &boxed(b"chap", &b32(2)))].concat());
        let text = boxed(b"trak", &[tkhd(2), boxed(b"mdia", &[boxed(b"mdhd", &[b32(0), b32(0), b32(0), b32(1000), b32(0)].concat()), boxed(b"minf", &stbl)].concat())].concat());
        [ftyp, mdat, boxed(b"moov", &[audio, text].concat())].concat()
    }

    #[test]
    fn reads_a_quicktime_chapter_track() {
        let file = quicktime_book(&["Opening", "Chapter 2", "Épilogue"], &[61_500, 30_000, 5_000]);
        let c = read_chapters(&mut Cursor::new(file.clone()));
        assert_eq!(c.iter().map(|c| (c.start_ms, c.title.as_str())).collect::<Vec<_>>(), [(0, "Opening"), (61_500, "Chapter 2"), (91_500, "Épilogue")]);
        for cut in 0..file.len() {
            let _ = read_chapters(&mut Cursor::new(file[..cut].to_vec()));
        }
    }

    #[test]
    fn reads_the_id3_chapters_of_an_mp3_in_both_versions() {
        for v4 in [false, true] {
            let tag = mp3(if v4 { 4 } else { 3 }, &[frame(b"TIT2", b"\x00Book", v4), chap("ch2", 61_500, b"\x03Caf\xc3\xa9", v4), chap("ch1", 0, b"\x01\xff\xfeO\x00n\x00e\x00", v4), chap("ch3", 90_000, b"\x00Three", v4)]);
            let c = read_chapters(&mut Cursor::new(tag));
            assert_eq!(c.iter().map(|c| (c.start_ms, c.title.as_str())).collect::<Vec<_>>(), [(0, "One"), (61_500, "Café"), (90_000, "Three")], "v4 {v4}");
        }
        // A tag without chapters, and one cut anywhere, give none and never panic.
        assert!(read_chapters(&mut Cursor::new(mp3(4, &[frame(b"TIT2", b"\x00Song", true)]))).is_empty());
        let tag = mp3(3, &[chap("a", 5, b"\x00A", false)]);
        for cut in 0..tag.len() {
            let _ = read_chapters(&mut Cursor::new(tag[..cut].to_vec()));
        }
    }

    #[test]
    fn a_file_without_chapters_or_cut_short_gives_none_and_never_panics() {
        assert!(read_chapters(&mut Cursor::new(book(&[]))).is_empty());
        assert!(read_chapters(&mut Cursor::new(b"ID3\x04 not an mp4".to_vec())).is_empty());
        assert!(read_chapters(&mut Cursor::new(Vec::new())).is_empty());
        let file = book(&[(0, "One"), (5_000, "Two")]);
        for cut in 0..file.len() {
            let _ = read_chapters(&mut Cursor::new(file[..cut].to_vec()));
        }
        // A box that claims more than the file holds, and a chapter title longer than what is left.
        let mut liar = boxed(b"moov", &[]);
        liar[..4].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(read_chapters(&mut Cursor::new(liar)).is_empty());
    }
}
