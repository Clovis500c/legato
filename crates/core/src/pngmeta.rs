//! A share card's hidden text: a PNG `tEXt` chunk named "Legato" holding the song's share link, so a card dropped back on
//! the app brings its music back even where the picture itself can't be read (the QR in its corner is the pixel form,
//! `share::read_qr`). Chats such as Discord strip such chunks: that is why both exist. The file is untrusted when read:
//! chunks are walked with bounds, only a short ASCII link is returned, and the caller checks it parses as a share.

const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];
/// Chunks looked at in a picture, and the longest text kept (a link is a few hundred characters).
const MAX_CHUNKS: usize = 4_000;
const MAX_TEXT: usize = 20_000;
pub const KEY: &str = "Legato";

/// CRC-32 (PNG's): bitwise, a chunk is small.
fn crc32(parts: &[&[u8]]) -> u32 {
    let mut crc = !0u32;
    for b in parts.iter().flat_map(|p| p.iter()) {
        crc ^= u32::from(*b);
        for _ in 0..8 {
            crc = if crc & 1 == 1 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

/// `png` with a `tEXt` chunk `key` = `text` before its end; None when it isn't a PNG, or the text isn't short ASCII.
pub fn add_text(png: &[u8], key: &str, text: &str) -> Option<Vec<u8>> {
    if !png.starts_with(&SIGNATURE) || text.len() > MAX_TEXT || !text.is_ascii() || text.contains('\0') || key.is_empty() || key.len() > 79 || !key.is_ascii() {
        return None;
    }
    // The end chunk is the last 12 bytes (length 0, "IEND", CRC).
    let end = png.len().checked_sub(12).filter(|&e| &png[e + 4..e + 8] == b"IEND")?;
    let body: Vec<u8> = key.bytes().chain([0]).chain(text.bytes()).collect();
    let mut out = png[..end].to_vec();
    out.extend((body.len() as u32).to_be_bytes());
    out.extend(b"tEXt");
    out.extend(&body);
    out.extend(crc32(&[b"tEXt", &body]).to_be_bytes());
    out.extend(&png[end..]);
    Some(out)
}

/// The text of the first `tEXt` chunk named `key`. Bounded walk; None when absent or not plain ASCII.
pub fn read_text(png: &[u8], key: &str) -> Option<String> {
    let mut at = SIGNATURE.len();
    if !png.starts_with(&SIGNATURE) {
        return None;
    }
    for _ in 0..MAX_CHUNKS {
        let head = png.get(at..at + 8)?;
        let len = u32::from_be_bytes(head[..4].try_into().ok()?) as usize;
        let kind = &head[4..8];
        let data = png.get(at + 8..at.checked_add(8)?.checked_add(len)?)?;
        if kind == b"tEXt"
            && len <= MAX_TEXT + 100
            && let Some(z) = data.iter().position(|&b| b == 0)
            && &data[..z] == key.as_bytes()
            && data[z + 1..].len() <= MAX_TEXT
            && data[z + 1..].is_ascii()
        {
            return Some(String::from_utf8_lossy(&data[z + 1..]).into_owned());
        }
        if kind == b"IEND" {
            return None;
        }
        at = at.checked_add(12)?.checked_add(len)?;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> Vec<u8> {
        let mut out = Vec::new();
        image::DynamicImage::new_luma8(4, 4).write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png).unwrap();
        out
    }

    #[test]
    fn a_text_chunk_goes_in_and_comes_out_and_the_picture_still_opens() {
        let with = add_text(&png(), KEY, "legato://playlist/ABC123").unwrap();
        assert_eq!(read_text(&with, KEY).as_deref(), Some("legato://playlist/ABC123"));
        assert_eq!(read_text(&with, "Other"), None);
        assert_eq!(read_text(&png(), KEY), None);
        assert_eq!(image::load_from_memory(&with).unwrap().width(), 4);
    }

    #[test]
    fn what_is_not_a_png_or_not_short_ascii_is_refused() {
        assert!(add_text(b"not a png", KEY, "x").is_none());
        assert!(add_text(&png(), KEY, "é").is_none() && add_text(&png(), KEY, &"x".repeat(MAX_TEXT + 1)).is_none());
        assert_eq!(read_text(b"", KEY), None);
    }

    #[test]
    fn damaged_pictures_never_panic() {
        let good = add_text(&png(), KEY, "legato://playlist/ABC").unwrap();
        let mut x: u64 = 0x2545_F491_4F6C_DD1D;
        for _ in 0..5_000 {
            let mut b = good.clone();
            for _ in 0..1 + (x % 5) {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                let i = (x % b.len() as u64) as usize;
                b[i] = (x >> 9) as u8;
            }
            if x.is_multiple_of(4) {
                b.truncate((x % b.len() as u64) as usize);
            }
            if let Some(t) = read_text(&b, KEY) {
                assert!(t.is_ascii() && t.len() <= MAX_TEXT);
            }
        }
    }
}
