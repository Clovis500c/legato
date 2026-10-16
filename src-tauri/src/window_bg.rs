//! Window background before the UI paints: saved theme's bg, so a dark theme doesn't flash light.

use serde_json::Value;

// Preset bg, keep in sync with ui/src/shared/theme/theme.ts PRESETS.
const PRESETS: &[(&str, &str)] = &[
    ("modern", "#FFFFFF"),
    ("modern-dark", "#0F0F0F"),
    ("paper", "#F3F1EC"),
    ("graphite", "#121211"),
    ("studio", "#000000"),
    ("aluminum", "#ECEEF0"),
    ("bakelite", "#1C1410"),
    ("sage", "#E7ECE6"),
];

/// Theme id from stored "ui" settings ('system' default, like the UI) → bg hex.
pub fn resolve(settings: Option<&Value>, system_dark: bool) -> String {
    let theme = settings.and_then(|s| s.get("theme")?.as_str()).unwrap_or("system");
    let id = match theme {
        "system" => if system_dark { "modern-dark" } else { "modern" },
        id => id,
    };
    let custom = settings
        .and_then(|s| s.get("customThemes")?.as_array())
        .and_then(|list| list.iter().find(|t| t.get("id").and_then(Value::as_str) == Some(id)))
        .and_then(|t| t.get("bg")?.as_str())
        .filter(|hex| parse(hex).is_some());
    custom.map(str::to_owned).unwrap_or_else(|| PRESETS.iter().find(|(p, _)| *p == id).unwrap_or(&PRESETS[0]).1.to_owned())
}

/// "#RRGGBB" → (r, g, b).
pub fn parse(hex: &str) -> Option<(u8, u8, u8)> {
    let h = hex.strip_prefix('#').filter(|h| h.len() == 6 && h.is_ascii())?;
    let c = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
    Some((c(0)?, c(2)?, c(4)?))
}

/// Windows apps mode dark (UISettings background is black). False elsewhere or on error.
pub fn system_dark() -> bool {
    #[cfg(windows)]
    {
        use windows::UI::ViewManagement::{UIColorType, UISettings};
        UISettings::new().and_then(|ui| ui.GetColorValue(UIColorType::Background)).is_ok_and(|c| u16::from(c.R) + u16::from(c.G) + u16::from(c.B) < 384)
    }
    #[cfg(not(windows))]
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn system_follows_windows_mode() {
        assert_eq!(resolve(None, false), "#FFFFFF");
        assert_eq!(resolve(None, true), "#0F0F0F");
        assert_eq!(resolve(Some(&json!({ "theme": "system" })), true), "#0F0F0F");
    }

    #[test]
    fn preset_custom_and_unknown() {
        assert_eq!(resolve(Some(&json!({ "theme": "graphite" })), false), "#121211");
        let s = json!({ "theme": "custom-x", "customThemes": [{ "id": "custom-x", "bg": "#123456" }] });
        assert_eq!(resolve(Some(&s), false), "#123456");
        // Bad custom bg or unknown id: first preset, like the UI's fallback.
        let bad = json!({ "theme": "custom-x", "customThemes": [{ "id": "custom-x", "bg": "red" }] });
        assert_eq!(resolve(Some(&bad), true), "#FFFFFF");
        assert_eq!(resolve(Some(&json!({ "theme": "gone" })), true), "#FFFFFF");
    }

    #[test]
    fn parses_hex() {
        assert_eq!(parse("#FF5A1F"), Some((255, 90, 31)));
        assert_eq!(parse("FF5A1F"), None);
        assert_eq!(parse("#FF5A1"), None);
        assert_eq!(parse("#ééé"), None);
    }
}
