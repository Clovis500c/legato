//! The remix file `.lmix` (plan-v2 › Remixes shared outside the app), YouTube-link form: a small JSON text holding a
//! YouTube video and the Live Editor's settings for it, never audio. Dropped on Legato, the song plays with the editor
//! open on those settings. A file from outside is untrusted: size-capped, every field checked, the settings clamped
//! (`Effects::clamped`), unknown fields refused, nothing in it is a path or a command. The local-file form that carries
//! audio is not built (it waits for the owner's answers on the export warning and personal servers).

use crate::Effects;
use serde::{Deserialize, Serialize};

/// A file bigger than this is refused unread.
pub const MAX_BYTES: u64 = 64 << 10;
const FORMAT: &str = "lmix";
const VERSION: u32 = 1;
/// Longest name, title or artist, in characters.
const MAX_TEXT: usize = 200;

/// A remix: what to play and how to change it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Lmix {
    /// The mix's name (a version name in the editor).
    pub name: String,
    /// The YouTube video id (11 characters).
    pub video: String,
    pub title: String,
    pub artist: String,
    pub effects: Effects,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct File {
    format: String,
    version: u32,
    name: String,
    video: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    artist: String,
    #[serde(default)]
    effects: Effects,
}

/// A YouTube video id: 11 characters of letters, digits, `-` and `_`.
pub fn video_id_ok(id: &str) -> bool {
    id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Text from the file kept as a short single line: no control characters, bounded.
fn line(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).take(MAX_TEXT).collect::<String>().trim().to_string()
}

/// A remix as a link: `legato://remix/` and the file's text (only what differs from a neutral editor) in base64.
pub const LINK: &str = "legato://remix/";

/// Entries of `v` that differ from `base`, nested objects the same way.
fn differing(v: &serde_json::Value, base: &serde_json::Value) -> serde_json::Value {
    match (v, base) {
        (serde_json::Value::Object(o), serde_json::Value::Object(b)) => o.iter().filter_map(|(k, x)| { let d = differing(x, b.get(k).unwrap_or(&serde_json::Value::Null)); (!d.as_object().is_some_and(|m| m.is_empty()) && d != *b.get(k).unwrap_or(&serde_json::Value::Null)).then(|| (k.clone(), d)) }).collect::<serde_json::Map<_, _>>().into(),
        _ => v.clone(),
    }
}

/// The compact link of a remix: short, since a remix changes a few settings.
pub fn to_link(m: &Lmix) -> Result<String, String> {
    use base64::Engine;
    let file = pack(m)?;
    let mut v: serde_json::Value = serde_json::from_str(&file).map_err(|e| e.to_string())?;
    let base = serde_json::to_value(Effects::default()).map_err(|e| e.to_string())?;
    v["effects"] = differing(&v["effects"], &base);
    Ok(format!("{LINK}{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&v).map_err(|e| e.to_string())?)))
}

/// A remix from its link: the same checks as a file (`unpack`), the settings left out being the neutral ones.
pub fn from_link(text: &str) -> Result<Lmix, String> {
    use base64::Engine;
    let body = text.trim().strip_prefix(LINK).ok_or("Not a Legato remix link")?;
    if body.len() as u64 > MAX_BYTES * 4 / 3 {
        return Err("This remix link is too big".into());
    }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(body.as_bytes()).map_err(|_| "Not a Legato remix link".to_string())?;
    unpack(&String::from_utf8_lossy(&bytes))
}

pub fn pack(m: &Lmix) -> Result<String, String> {
    if !video_id_ok(&m.video) {
        return Err("Not a YouTube video".into());
    }
    let file = File { format: FORMAT.into(), version: VERSION, name: line(&m.name), video: m.video.clone(), title: line(&m.title), artist: line(&m.artist), effects: m.effects.clamped() };
    serde_json::to_string_pretty(&file).map_err(|e| e.to_string())
}

pub fn unpack(text: &str) -> Result<Lmix, String> {
    if text.len() as u64 > MAX_BYTES {
        return Err("This remix file is too big".into());
    }
    let f: File = serde_json::from_str(text).map_err(|_| "Not a Legato remix file".to_string())?;
    if f.format != FORMAT {
        return Err("Not a Legato remix file".into());
    }
    if f.version != VERSION {
        return Err("This remix file comes from a newer Legato".into());
    }
    if !video_id_ok(&f.video) {
        return Err("This remix file names no YouTube video".into());
    }
    let name = line(&f.name);
    Ok(Lmix { name: if name.is_empty() { "Remix".into() } else { name }, video: f.video, title: line(&f.title), artist: line(&f.artist), effects: f.effects.clamped() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mix() -> Lmix {
        Lmix { name: "Slowed".into(), video: "dQw4w9WgXcQ".into(), title: "Song".into(), artist: "Band".into(), effects: Effects { speed: 0.8, ..Effects::default() } }
    }

    #[test]
    fn a_remix_round_trips() {
        assert_eq!(unpack(&pack(&mix()).unwrap()).unwrap(), mix());
    }

    #[test]
    fn a_remix_link_is_short_and_round_trips() {
        let link = to_link(&mix()).unwrap();
        assert!(link.starts_with(LINK) && link.len() < 320, "{}", link.len());
        assert_eq!(from_link(&link).unwrap(), mix());
        // Neutral settings: nothing but the song in the link.
        let plain = Lmix { effects: Effects::default(), ..mix() };
        assert_eq!(from_link(&to_link(&plain).unwrap()).unwrap(), plain);
        assert!(to_link(&plain).unwrap().len() < link.len());
    }

    #[test]
    fn a_hostile_link_is_refused_and_a_damaged_one_never_panics() {
        for bad in ["", "legato://playlist/AAAA", "legato://remix/", "legato://remix/!!!!", "legato://remix/e30", &format!("{LINK}{}", "A".repeat(100_000))] {
            assert!(from_link(bad).is_err(), "{bad:.30}");
        }
        let good = to_link(&mix()).unwrap().into_bytes();
        let mut x: u64 = 0x9E37_79B9_7F4A_7C15;
        for _ in 0..4_000 {
            let mut b = good.clone();
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            let i = LINK.len() + (x % (b.len() - LINK.len()) as u64) as usize;
            b[i] = (x >> 8) as u8;
            if let Ok(m) = from_link(&String::from_utf8_lossy(&b)) {
                assert!(video_id_ok(&m.video));
            }
        }
    }

    #[test]
    fn a_hostile_file_is_refused_or_made_harmless() {
        let ok = |extra: &str| format!(r#"{{"format":"lmix","version":1,"name":"n","video":"dQw4w9WgXcQ"{extra}}}"#);
        assert!(unpack(&ok("")).is_ok());
        // Not ours, not this version, not a video, unknown fields (a path, a command), too big.
        assert!(unpack(r#"{"format":"x","version":1,"name":"n","video":"dQw4w9WgXcQ"}"#).is_err());
        assert!(unpack(&ok("").replace("\"version\":1", "\"version\":2")).is_err());
        assert!(unpack(&ok("").replace("dQw4w9WgXcQ", "../../etc/pw")).is_err());
        assert!(unpack(&ok(r#","path":"C:\\Windows\\x.exe""#)).is_err());
        assert!(unpack(&format!("{} ", ok("")).repeat(5_000)).is_err());
        // Numbers out of range are clamped, text is cut and cleaned.
        let m = unpack(&ok(r#","effects":{"speed":99,"pitch":-500},"title":"a\u0007b""#)).unwrap();
        assert_eq!((m.effects.speed, m.effects.pitch, m.title.as_str()), (2.5, -24.0, "ab"));
        assert_eq!(unpack(&ok("").replace("\"n\"", &format!("\"{}\"", "x".repeat(900)))).unwrap().name.chars().count(), MAX_TEXT);
    }

    #[test]
    fn damaged_files_never_panic() {
        let good = pack(&mix()).unwrap().into_bytes();
        let mut x: u64 = 0x1234_5678_9ABC_DEF1;
        for _ in 0..4_000 {
            let mut b = good.clone();
            for _ in 0..1 + (x % 6) {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                let i = (x % b.len() as u64) as usize;
                b[i] = (x >> 8) as u8;
            }
            if x.is_multiple_of(3) {
                b.truncate((x % b.len() as u64) as usize);
            }
            if let Ok(m) = unpack(&String::from_utf8_lossy(&b)) {
                assert!(video_id_ok(&m.video) && m.name.chars().count() <= MAX_TEXT);
            }
        }
    }
}
