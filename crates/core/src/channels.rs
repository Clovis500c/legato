//! The YouTube channel found for an artist's name (an uploader that is no catalogue artist), kept so a song's byline is read once per artist.
//! A library setting, `ytChannels`: lower-case name → channel id. Local only, never in a share link or a sync file of its own.

use std::collections::BTreeMap;

/// Names kept at most; past it the map starts again (a name is found again from one song).
// shortcut: no ordering of what is oldest; a library with more uploaders than this simply re-reads some bylines.
pub const MAX: usize = 2_000;

/// How a name is looked up: trimmed, lower case.
pub fn key(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Keeps `id` for `name`. False: the id is not a YouTube channel id (`UC…`, letters, digits, - and _), nothing kept.
pub fn remember(map: &mut BTreeMap<String, String>, name: &str, id: &str) -> bool {
    let ok = id.starts_with("UC") && id.len() >= 3 && id.len() <= 40 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    let k = key(name);
    if !ok || k.is_empty() || k.chars().count() > 200 {
        return false;
    }
    if map.len() >= MAX && !map.contains_key(&k) {
        map.clear();
    }
    map.insert(k, id.into());
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_channel_by_lower_case_name_and_refuses_what_is_not_one() {
        let mut m = BTreeMap::new();
        assert!(remember(&mut m, "  ProdPhanda ", "UCchan0000000000000000aa"));
        assert_eq!(m.get(&key("prodphanda")).map(String::as_str), Some("UCchan0000000000000000aa"));
        for bad in ["", "VLPL1", "UC../x", "UC x", "https://evil.example"] {
            assert!(!remember(&mut m, "x", bad), "{bad:?}");
        }
        assert!(!remember(&mut m, "  ", "UCchan0000000000000000aa"));
        assert_eq!(m.len(), 1);
    }

    #[test]
    fn is_bounded() {
        let mut m = BTreeMap::new();
        for i in 0..MAX {
            assert!(remember(&mut m, &format!("a{i}"), "UCx"));
        }
        assert_eq!(m.len(), MAX);
        assert!(remember(&mut m, "one more", "UCy"));
        assert_eq!(m.len(), 1);
        // An update of a known name never clears.
        assert!(remember(&mut m, "one more", "UCz"));
        assert_eq!(m.len(), 1);
    }
}
