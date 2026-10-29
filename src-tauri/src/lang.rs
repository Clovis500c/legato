//! Words the shell shows itself (tray menu, taskbar buttons) in the interface's language, which the UI sets
//! (`set_ui_language`). The interface's own texts live in `ui/src/shared/i18n`.

use std::sync::atomic::{AtomicU8, Ordering};

/// 0 = English, 1 = French. Same order as `LANGS`.
static CURRENT: AtomicU8 = AtomicU8::new(0);
const LANGS: [&str; 2] = ["en", "fr"];

const FRENCH: &[(&str, &str)] = &[
    ("Nothing playing", "Rien en lecture"),
    ("Play", "Lecture"),
    ("Pause", "Pause"),
    ("Next", "Suivant"),
    ("Previous", "Précédent"),
    ("Show Legato", "Afficher Legato"),
    ("Quit", "Quitter"),
];

/// Language code from the UI; true when it changed. Unknown codes = English.
pub fn set(code: &str) -> bool {
    let i = LANGS.iter().position(|l| *l == code).unwrap_or(0) as u8;
    CURRENT.swap(i, Ordering::Relaxed) != i
}

/// English text → the current language's (English when there's no translation).
pub fn tr(en: &'static str) -> &'static str {
    match CURRENT.load(Ordering::Relaxed) {
        1 => FRENCH.iter().find(|(k, _)| *k == en).map_or(en, |(_, v)| v),
        _ => en,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_shell_word_has_its_french() {
        // Texts passed to lang::tr in the shell's own files.
        for file in [include_str!("tray.rs"), include_str!("thumbbar.rs")] {
            for part in file.split("lang::tr(\"").skip(1) {
                let word = &part[..part.find('"').unwrap()];
                assert!(FRENCH.iter().any(|(k, _)| *k == word), "no French for {word:?}");
            }
        }
    }

    #[test]
    fn switches_and_falls_back() {
        assert!(set("fr"));
        assert!(!set("fr"));
        assert_eq!(tr("Quit"), "Quitter");
        assert_eq!(tr("Unknown words"), "Unknown words");
        assert!(set("xx"));
        assert_eq!(tr("Quit"), "Quit");
    }
}
