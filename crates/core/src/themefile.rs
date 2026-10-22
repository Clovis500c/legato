//! `.theme` files: a theme's JSON, its background picture inside (base64) so one file carries everything. Pictures
//! are kept by content: the same picture twice is one file.

use anyhow::{Result, bail, ensure};
use base64::Engine;
use serde_json::Value;
use std::hash::{Hash, Hasher};

/// A picture a theme can use: PNG, JPEG, WebP or GIF, 15 MB at most.
pub const MAX_IMAGE: usize = 15 << 20;

/// Picture kind from its first bytes.
pub fn image_ext(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => Some("png"),
        [0xFF, 0xD8, 0xFF, ..] => Some("jpg"),
        [b'G', b'I', b'F', ..] => Some("gif"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("webp"),
        _ => None,
    }
}

/// File name for a background picture: `bg-<16 hex of its content>.<kind>`.
pub fn background_name(bytes: &[u8]) -> Result<String> {
    ensure!(bytes.len() <= MAX_IMAGE, "Picture too big (15 MB max)");
    let Some(ext) = image_ext(bytes) else { bail!("Not a PNG, JPEG, WebP or GIF picture") };
    let mut h = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut h);
    Ok(format!("bg-{:016x}.{ext}", h.finish()))
}

/// Theme (+ its picture) → file text.
pub fn pack(theme: &Value, picture: Option<&[u8]>) -> Result<String> {
    let mut t = theme.clone();
    let obj = t.as_object_mut().ok_or_else(|| anyhow::anyhow!("Not a theme"))?;
    obj.remove("backgroundData");
    if let Some(p) = picture {
        obj.insert("backgroundData".into(), base64::engine::general_purpose::STANDARD.encode(p).into());
    }
    Ok(serde_json::to_string_pretty(&t)?)
}

/// File text → theme JSON (still to be checked by the interface) and its picture, if any.
pub fn unpack(text: &str) -> Result<(Value, Option<Vec<u8>>)> {
    ensure!(text.len() <= MAX_IMAGE * 4 / 3 + (1 << 20), "File too big for a theme");
    let mut t: Value = serde_json::from_str(text).map_err(|_| anyhow::anyhow!("Not a theme file"))?;
    let obj = t.as_object_mut().ok_or_else(|| anyhow::anyhow!("Not a theme file"))?;
    let picture = match obj.remove("backgroundData") {
        Some(Value::String(b)) => {
            let bytes = base64::engine::general_purpose::STANDARD.decode(b).map_err(|_| anyhow::anyhow!("Damaged picture in the theme"))?;
            background_name(&bytes)?;
            Some(bytes)
        }
        _ => None,
    };
    Ok((t, picture))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 1, 2, 3];

    #[test]
    fn names_follow_the_content() {
        let a = background_name(PNG).unwrap();
        assert!(a.starts_with("bg-") && a.ends_with(".png") && a.len() == 23, "{a}");
        assert_eq!(background_name(PNG).unwrap(), a);
        assert_ne!(background_name(&[0x89, b'P', b'N', b'G', 9]).unwrap(), a);
        assert!(background_name(b"MZ\x90\x00").is_err());
    }

    #[test]
    fn a_theme_file_carries_its_picture() {
        let theme = json!({ "name": "Night", "bg": "#000000", "background": { "image": "bg-0000000000000000.png" } });
        let text = pack(&theme, Some(PNG)).unwrap();
        let (back, pic) = unpack(&text).unwrap();
        assert_eq!(back, theme);
        assert_eq!(pic.as_deref(), Some(PNG));
        assert!(unpack("{\"backgroundData\": \"TVqQ\"}").is_err());
        assert!(unpack("[1]").is_err());
        assert_eq!(unpack(&pack(&theme, None).unwrap()).unwrap().1, None);
    }
}
