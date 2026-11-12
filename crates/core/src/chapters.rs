//! Chapters of an audiobook file: the `chpl` list of an `.m4b` / `.m4a` (Nero chapters, what ffmpeg and mp4v2 write),
//! read from the `moov` box only. Other chapter forms (a QuickTime text track, ID3 `CHAP`) are not read: no chapters.

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

/// Chapters of an MP4 audiobook, in time order; empty when the file has none or is not one.
pub fn read_chapters<R: Read + Seek>(r: &mut R) -> Vec<Chapter> {
    let Ok(total) = r.seek(SeekFrom::End(0)) else { return Vec::new() };
    if r.seek(SeekFrom::Start(0)).is_err() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let _ = each(r, total, |r, kind, size| {
        if &kind == b"moov" && size <= MOOV_MAX {
            each(r, size, |r, kind, size| {
                if &kind != b"udta" {
                    return Some(());
                }
                each(r, size, |r, kind, size| {
                    if &kind == b"chpl" && size <= MOOV_MAX {
                        let mut body = vec![0u8; size as usize];
                        r.read_exact(&mut body).ok()?;
                        out = parse_chpl(&body);
                    }
                    Some(())
                })
            })?;
        }
        Some(())
    });
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
