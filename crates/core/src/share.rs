//! MA1 share code: playlist as compact binary, zlib (deflate + Adler-32 checksum), then text.
//! One entry per track, best id first: YouTube (full playback for anyone), Apple Music, else artist + title.
//! Spotify ids / ISRC skipped: receiver without Premium or Apple API can't resolve them; text it can search.

use crate::model::{Source, Track};
use anyhow::{Context, Result, bail, ensure};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use flate2::Compression;
use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use std::io::{Read, Write};
use std::path::Path;

#[derive(Debug, Clone, PartialEq)]
pub enum Item {
    Youtube(String),
    Apple(u64),
    Text { artist: String, title: String },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Shared {
    pub name: String,
    pub items: Vec<Item>,
}

const VERSION: u8 = 1;
const MAX_ITEMS: u64 = 10_000;
const MAX_TEXT: u64 = 300;
/// Decompressed cap: zip bomb guard.
const MAX_RAW: u64 = 4 << 20;
pub const LINK: &str = "musicapp://playlist/";
pub const QR: &str = "MA1:";

impl Item {
    pub fn from_track(t: &Track) -> Self {
        if let Some(id) = t.ids.get(&Source::Youtube).filter(|id| yt_pack(id).is_some()) {
            return Item::Youtube(id.clone());
        }
        if let Some(n) = t.ids.get(&Source::Apple).and_then(|id| id.parse().ok()) {
            return Item::Apple(n);
        }
        Item::Text { artist: t.artist.clone(), title: t.title.clone() }
    }
}

const B64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// YouTube id = 64-bit number in 11 base64url chars (last char holds 4 bits). None = not that shape.
fn yt_pack(id: &str) -> Option<u64> {
    let v: Vec<u64> = id.bytes().map(|b| B64.iter().position(|&c| c == b).map(|p| p as u64)).collect::<Option<_>>()?;
    if v.len() != 11 || v[10] & 3 != 0 {
        return None;
    }
    Some(v[..10].iter().fold(0, |n, d| n << 6 | d) << 4 | v[10] >> 2)
}

fn yt_unpack(n: u64) -> String {
    let mut s: Vec<u8> = (0..10).map(|i| B64[(n >> (4 + 6 * (9 - i)) & 63) as usize]).collect();
    s.push(B64[((n & 15) << 2) as usize]);
    String::from_utf8(s).unwrap()
}

fn put_varint(out: &mut Vec<u8>, mut n: u64) {
    while n >= 0x80 {
        out.push(n as u8 | 0x80);
        n >>= 7;
    }
    out.push(n as u8);
}

fn put_str(out: &mut Vec<u8>, s: &str) {
    // Cut on char boundary so receiver's length check passes.
    let mut end = s.len().min(MAX_TEXT as usize);
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    put_varint(out, end as u64);
    out.extend_from_slice(&s.as_bytes()[..end]);
}

struct Reader<'a>(&'a [u8]);

impl Reader<'_> {
    fn byte(&mut self) -> Result<u8> {
        let (&b, rest) = self.0.split_first().context("Share code is cut short")?;
        self.0 = rest;
        Ok(b)
    }
    fn varint(&mut self) -> Result<u64> {
        let mut n = 0u64;
        for shift in (0..64).step_by(7) {
            let b = self.byte()?;
            n |= u64::from(b & 0x7f) << shift;
            if b < 0x80 {
                return Ok(n);
            }
        }
        bail!("Bad number in share code")
    }
    fn str(&mut self) -> Result<String> {
        let len = self.varint()?;
        ensure!(len <= MAX_TEXT && len as usize <= self.0.len(), "Bad text in share code");
        let (s, rest) = self.0.split_at(len as usize);
        self.0 = rest;
        Ok(String::from_utf8(s.to_vec())?)
    }
}

pub fn encode(s: &Shared) -> Vec<u8> {
    let mut raw = vec![VERSION];
    put_str(&mut raw, &s.name);
    put_varint(&mut raw, s.items.len() as u64);
    for item in &s.items {
        match item {
            Item::Youtube(id) => match yt_pack(id) {
                Some(n) => {
                    raw.push(1);
                    raw.extend_from_slice(&n.to_be_bytes());
                }
                None => unreachable!("from_track keeps packable ids only"),
            },
            Item::Apple(n) => {
                raw.push(2);
                put_varint(&mut raw, *n);
            }
            Item::Text { artist, title } => {
                raw.push(3);
                put_str(&mut raw, artist);
                put_str(&mut raw, title);
            }
        }
    }
    let mut z = ZlibEncoder::new(Vec::new(), Compression::best());
    z.write_all(&raw).unwrap();
    z.finish().unwrap()
}

/// Trust boundary: bytes from anyone. Checksum, sizes and tags all checked.
pub fn decode(bytes: &[u8]) -> Result<Shared> {
    let mut raw = Vec::new();
    ZlibDecoder::new(bytes).take(MAX_RAW).read_to_end(&mut raw).context("Share code is damaged")?;
    let mut r = Reader(&raw);
    let version = r.byte()?;
    ensure!(version == VERSION, "Share code made by a newer version of Legato: update the app");
    let name = r.str()?;
    let count = r.varint()?;
    ensure!(count <= MAX_ITEMS, "Too many tracks in share code");
    let mut items = Vec::with_capacity(count as usize);
    for _ in 0..count {
        items.push(match r.byte()? {
            1 => {
                let b: [u8; 8] = r.0.get(..8).context("Share code is cut short")?.try_into()?;
                r.0 = &r.0[8..];
                Item::Youtube(yt_unpack(u64::from_be_bytes(b)))
            }
            2 => Item::Apple(r.varint()?),
            3 => Item::Text { artist: r.str()?, title: r.str()? },
            t => bail!("Unknown entry {t} in share code"),
        });
    }
    ensure!(r.0.is_empty(), "Share code has trailing data");
    Ok(Shared { name, items })
}

const B45: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/// RFC 9285. Alphabet = QR alphanumeric mode, densest QR text.
pub fn base45(bytes: &[u8]) -> String {
    let mut out = String::new();
    for c in bytes.chunks(2) {
        let (mut n, len) = if let [a, b] = c { (usize::from(*a) << 8 | usize::from(*b), 3) } else { (usize::from(c[0]), 2) };
        for _ in 0..len {
            out.push(B45[n % 45] as char);
            n /= 45;
        }
    }
    out
}

pub fn unbase45(s: &str) -> Result<Vec<u8>> {
    let v: Vec<usize> = s.bytes().map(|b| B45.iter().position(|&c| c == b)).collect::<Option<_>>().context("Not a share code")?;
    let mut out = Vec::new();
    for c in v.chunks(3) {
        let n = c.iter().rev().fold(0, |n, d| n * 45 + d);
        match c.len() {
            3 if n <= 0xffff => out.extend_from_slice(&(n as u16).to_be_bytes()),
            2 if n <= 0xff => out.push(n as u8),
            _ => bail!("Not a share code"),
        }
    }
    Ok(out)
}

/// For messages: `musicapp://playlist/…`.
pub fn to_link(s: &Shared) -> String {
    format!("{LINK}{}", URL_SAFE_NO_PAD.encode(encode(s)))
}

/// For QR codes: `MA1:` + base45, all in QR alphanumeric mode.
pub fn to_qr_text(s: &Shared) -> String {
    format!("{QR}{}", base45(&encode(s)))
}

/// QR modules (row-major, true = dark). None = too big for a QR code (share the link instead).
pub fn qr_modules(text: &str) -> Option<(usize, Vec<bool>)> {
    // Low EC: shown on a clean screen, densest code.
    let code = qrcode::QrCode::with_error_correction_level(text, qrcode::EcLevel::L).ok()?;
    Some((code.width(), code.to_colors().into_iter().map(|c| c == qrcode::Color::Dark).collect()))
}

/// QR text from a screenshot or photo (PNG / JPEG).
pub fn read_qr(path: &Path) -> Result<String> {
    let img = image::open(path).context("Can't open this image")?.to_luma8();
    let mut prepared = rqrr::PreparedImage::prepare_from_greyscale(img.width() as usize, img.height() as usize, |x, y| img.get_pixel(x as u32, y as u32).0[0]);
    prepared.detect_grids().into_iter().find_map(|g| g.decode().ok().map(|(_, text)| text)).context("No QR code found in this image")
}

/// Link or QR text. Whitespace inside links tolerated (chat apps wrap lines).
pub fn parse(text: &str) -> Result<Shared> {
    let text = text.trim();
    if let Some(rest) = text.strip_prefix(LINK) {
        let clean: String = rest.chars().filter(|c| !c.is_whitespace()).collect();
        return decode(&URL_SAFE_NO_PAD.decode(clean).context("Share link is damaged")?);
    }
    if let Some(rest) = text.strip_prefix(QR) {
        return decode(&unbase45(rest)?);
    }
    bail!("Not a Legato share code")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn sample() -> Shared {
        Shared {
            name: "Road trip ☀".into(),
            items: vec![
                Item::Youtube("dQw4w9WgXcQ".into()),
                Item::Apple(617_154_366),
                Item::Text { artist: "Stromae".into(), title: "Alors on danse".into() },
                Item::Youtube("jNQXAC9IVRw".into()),
            ],
        }
    }

    #[test]
    fn round_trips_as_link_and_qr_text() {
        assert_eq!(parse(&to_link(&sample())).unwrap(), sample());
        assert_eq!(parse(&to_qr_text(&sample())).unwrap(), sample());
        // Chat app wrapped the link.
        let link = to_link(&sample());
        assert_eq!(parse(&format!("  {}\n{} ", &link[..30], &link[30..])).unwrap(), sample());
        assert!(to_qr_text(&sample()).bytes().all(|b| B45.contains(&b) || b"MA1:".contains(&b)));
    }

    #[test]
    fn picks_best_id_per_track() {
        let t = |ids: &[(Source, &str)]| Track { title: "T".into(), artist: "A".into(), ids: ids.iter().map(|(s, i)| (*s, i.to_string())).collect::<BTreeMap<_, _>>(), ..Default::default() };
        assert_eq!(Item::from_track(&t(&[(Source::Apple, "5"), (Source::Youtube, "dQw4w9WgXcQ")])), Item::Youtube("dQw4w9WgXcQ".into()));
        assert_eq!(Item::from_track(&t(&[(Source::Apple, "5"), (Source::Spotify, "x")])), Item::Apple(5));
        // Odd YouTube id (last char not packable) and Spotify-only fall back to text.
        assert_eq!(Item::from_track(&t(&[(Source::Youtube, "abcdefghijx")])), Item::Text { artist: "A".into(), title: "T".into() });
        assert_eq!(Item::from_track(&t(&[(Source::Spotify, "x")])), Item::Text { artist: "A".into(), title: "T".into() });
    }

    #[test]
    fn hundred_youtube_tracks_fit_budget() {
        // Real ids are random 64-bit numbers: incompressible, worst case for the budget.
        let items = (1..=100u64).map(|i| Item::Youtube(yt_unpack(i.wrapping_mul(0x9E37_79B9_7F4A_7C15)))).collect();
        let s = Shared { name: "Hundred".into(), items };
        assert!(encode(&s).len() < 1200, "{} bytes", encode(&s).len());
        assert_eq!(parse(&to_link(&s)).unwrap(), s);
    }

    #[test]
    fn rejects_damaged_codes() {
        let mut bytes = encode(&sample());
        let mid = bytes.len() / 2;
        bytes[mid] ^= 0x10;
        assert!(decode(&bytes).is_err());
        assert!(decode(&encode(&sample())[..10]).is_err());
        assert!(parse("hello").is_err());
        assert!(parse("MA1:abc").is_err());
        assert!(parse(&format!("{LINK}%%%")).is_err());
        let mut z = ZlibEncoder::new(Vec::new(), Compression::fast());
        z.write_all(&[2, 0, 0]).unwrap();
        assert!(decode(&z.finish().unwrap()).unwrap_err().to_string().contains("newer"));
    }

    #[test]
    fn qr_code_reads_back_from_png() -> Result<()> {
        let text = to_qr_text(&sample());
        let (w, dark) = qr_modules(&text).unwrap();
        // 4 px per module, 4-module quiet zone, like a screenshot.
        let side = ((w + 8) * 4) as u32;
        let img = image::GrayImage::from_fn(side, side, |x, y| {
            let (mx, my) = ((x / 4) as usize, (y / 4) as usize);
            let on = (4..w + 4).contains(&mx) && (4..w + 4).contains(&my) && dark[(my - 4) * w + mx - 4];
            image::Luma([if on { 0 } else { 255 }])
        });
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("qr.png");
        img.save(&path)?;
        assert_eq!(parse(&read_qr(&path)?)?, sample());
        assert!(qr_modules(&"A".repeat(5000)).is_none());
        Ok(())
    }

    #[test]
    fn base45_matches_rfc_9285() {
        for (raw, enc) in [("AB", "BB8"), ("Hello!!", "%69 VD92EX0"), ("base-45", "UJCLQE7W581"), ("ietf!", "QED8WEX0")] {
            assert_eq!(base45(raw.as_bytes()), enc);
            assert_eq!(unbase45(enc).unwrap(), raw.as_bytes());
        }
        assert!(unbase45("GGW").is_err());
    }

    #[test]
    fn youtube_ids_pack_into_8_bytes() {
        for id in ["dQw4w9WgXcQ", "jNQXAC9IVRw", "AAAAAAAAAAA", "__________w"] {
            assert_eq!(yt_unpack(yt_pack(id).unwrap()), id);
        }
        assert!(yt_pack("short").is_none() && yt_pack("___________").is_none());
    }
}
