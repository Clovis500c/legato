use crate::model::Track;
use regex::Regex;
use std::sync::LazyLock;
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

/// YouTube clip often has intro/outro audio lacks. Allow slack.
const DURATION_TOLERANCE_MS: u32 = 10_000;

static BRACKET_NOISE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)[(\[][^)\]]*\b(?:feat|ft|with|official|lyrics?|audio|video|remaster(?:ed)?|hd|hq|explicit|clean|visuali[sz]er|mv)\b[^)\]]*[)\]]",
    )
    .unwrap()
});
static REMASTER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s+-\s+(?:\d{4}\s+)?remaster(?:ed)?\b.*$").unwrap());
static FEAT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s(?:feat|ft)\.?\s.*$").unwrap());
static ARTIST_SPLIT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i),|&|;|/|\s(?:feat|ft)\.?\s|\sx\s|\svs\.?\s").unwrap());

/// Comparable form: lowercase, no accents, no "(Official Video)", no "feat.", no punctuation.
pub fn normalize(s: &str) -> String {
    let s: String = s.nfkd().filter(|c| !is_combining_mark(*c)).collect::<String>().to_lowercase();
    let s = BRACKET_NOISE.replace_all(&s, " ");
    let s = REMASTER.replace(&s, "");
    let s = FEAT.replace(&s, "").replace('&', " and ");
    s.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ")
}

/// First credited artist as written ("A, B & C feat. D" → "A").
pub fn first_artist(artist: &str) -> &str {
    ARTIST_SPLIT.split(artist).next().unwrap_or("").trim()
}

/// First credited artist, normalized ("A, B & C feat. D" → "a").
pub fn primary_artist(artist: &str) -> String {
    normalize(first_artist(artist))
}

pub fn match_key(title: &str, artist: &str) -> String {
    format!("{}|{}", normalize(title), primary_artist(artist))
}

fn artists_overlap(a: &str, b: &str) -> bool {
    let (pa, pb) = (primary_artist(a), primary_artist(b));
    if pa.is_empty() || pb.is_empty() {
        return false;
    }
    format!(" {} ", normalize(a)).contains(&format!(" {pb} ")) || format!(" {} ", normalize(b)).contains(&format!(" {pa} "))
}

/// Same recording? Shared id or ISRC first (different ISRC = different recording), else title + artist + duration.
pub fn same_track(a: &Track, b: &Track) -> bool {
    if a.ids.iter().any(|(s, id)| b.ids.get(s) == Some(id)) {
        return true;
    }
    if let (Some(x), Some(y)) = (&a.isrc, &b.isrc) {
        return x.eq_ignore_ascii_case(y);
    }
    if normalize(&a.title) != normalize(&b.title) || !artists_overlap(&a.artist, &b.artist) {
        return false;
    }
    match (a.duration_ms, b.duration_ms) {
        (Some(x), Some(y)) => x.abs_diff(y) <= DURATION_TOLERANCE_MS,
        _ => true,
    }
}

/// Another upload of the same song (any channel): same title once cleaned, same length. For videos whose owner
/// blocks embedding: the uploader often differs, so artists aren't compared.
pub fn same_song_upload(a: &Track, b: &Track) -> bool {
    if same_track(a, b) {
        return true;
    }
    normalize(&a.title) == normalize(&b.title) && a.duration_ms.zip(b.duration_ms).is_none_or(|(x, y)| x.abs_diff(y) <= DURATION_TOLERANCE_MS)
}

/// Best candidate: exact ISRC first, then fuzzy.
pub fn best_match<'a>(track: &Track, candidates: &'a [Track]) -> Option<&'a Track> {
    track
        .isrc
        .as_ref()
        .and_then(|isrc| candidates.iter().find(|c| c.isrc.as_ref().is_some_and(|x| x.eq_ignore_ascii_case(isrc))))
        .or_else(|| candidates.iter().find(|c| same_track(track, c)))
}

/// Merge two views of same track. `a` wins on filled fields.
pub fn merge_tracks(a: &Track, b: &Track) -> Track {
    let mut ids = b.ids.clone();
    ids.extend(a.ids.clone());
    Track {
        title: a.title.clone(),
        artist: a.artist.clone(),
        album: a.album.clone().or_else(|| b.album.clone()),
        duration_ms: a.duration_ms.or(b.duration_ms),
        isrc: a.isrc.clone().or_else(|| b.isrc.clone()),
        ids,
        art: crate::model::pick_art(a.art.clone(), b.art.clone()),
        musicness: crate::musicness::Musicness::merge(b.musicness, a.musicness),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Source;

    fn t(title: &str, artist: &str) -> Track {
        Track { title: title.into(), artist: artist.into(), ..Default::default() }
    }

    #[test]
    fn other_upload_same_title_and_length_any_channel() {
        let blocked = Track { duration_ms: Some(200_000), ..t("DO4LOVE (Slowed + Reverbed)", "Capt. Slowed") };
        let copy = Track { duration_ms: Some(201_000), ..t("DO4LOVE (Slowed + Reverbed)", "slowed vibes") };
        let longer = Track { duration_ms: Some(260_000), ..t("DO4LOVE (Slowed + Reverbed)", "slowed vibes") };
        assert!(same_song_upload(&blocked, &copy));
        assert!(!same_song_upload(&blocked, &longer));
        assert!(!same_song_upload(&blocked, &t("GREEDY", "Capt. Slowed")));
    }

    #[test]
    fn normalize_cases() {
        for (input, out) in [
            ("Get Lucky (feat. Pharrell Williams)", "get lucky"),
            ("Get Lucky feat. Pharrell", "get lucky"),
            ("Bohemian Rhapsody - Remastered 2011", "bohemian rhapsody"),
            ("Bohemian Rhapsody (Official Video) [HD]", "bohemian rhapsody"),
            ("Beyoncé", "beyonce"),
            ("Simon & Garfunkel", "simon and garfunkel"),
            ("Feather", "feather"),
            ("夜に駆ける", "夜に駆ける"),
            ("Live Forever (Live)", "live forever live"),
        ] {
            assert_eq!(normalize(input), out, "{input}");
        }
    }

    #[test]
    fn primary_artist_and_key() {
        assert_eq!(primary_artist("Daft Punk, Pharrell Williams"), "daft punk");
        assert_eq!(primary_artist("Daft Punk ft. Pharrell"), "daft punk");
        assert_eq!(primary_artist("Calvin Harris x Dua Lipa"), "calvin harris");
        assert_eq!(match_key("Song (Lyrics)", "Simon & Garfunkel"), "song|simon");
    }

    #[test]
    fn isrc_rules() {
        let mut a = t("A", "X");
        let mut b = t("B", "X");
        a.isrc = Some("USUM71703861".into());
        b.isrc = Some("usum71703861".into());
        assert!(same_track(&a, &b));
        b.isrc = Some("GBAYE1100001".into());
        assert!(!same_track(&a, &b));
    }

    #[test]
    fn shared_source_id() {
        let mut a = t("A", "X");
        let mut b = t("B", "Y");
        a.ids.insert(Source::Spotify, "x".into());
        b.ids.insert(Source::Spotify, "x".into());
        assert!(same_track(&a, &b));
    }

    #[test]
    fn fuzzy_fallback() {
        let mut sp = t("Get Lucky (feat. Pharrell Williams)", "Daft Punk, Pharrell Williams");
        sp.duration_ms = Some(248_000);
        sp.isrc = Some("USQX91300108".into());
        let mut yt = t("Get Lucky (Official Audio) ft. Pharrell Williams", "Daft Punk");
        yt.duration_ms = Some(250_000);
        assert!(same_track(&sp, &yt));
        yt.duration_ms = Some(310_000);
        assert!(!same_track(&sp, &yt));
        yt.duration_ms = None;
        assert!(same_track(&sp, &yt));
        assert!(!same_track(&t("Hello", "Adele"), &t("Hello", "Muse")));
        assert!(!same_track(&t("Hello", "Adele"), &t("Hello (Live)", "Adele")));
    }

    #[test]
    fn best_match_prefers_isrc() {
        let mut fuzzy = t("Song", "Artist");
        fuzzy.ids.insert(Source::Spotify, "1".into());
        let mut exact = t("Other title", "Artist");
        exact.isrc = Some("FRZ111700001".into());
        let mut q = t("Song", "Artist");
        q.isrc = Some("FRZ111700001".into());
        let cands = [fuzzy.clone(), exact.clone()];
        assert_eq!(best_match(&q, &cands), Some(&exact));
        assert_eq!(best_match(&t("Song", "Artist"), &cands), Some(&fuzzy));
        assert_eq!(best_match(&t("Nope", "Artist"), &cands), None);
    }

    #[test]
    fn merge_keeps_a() {
        let mut a = t("A", "X");
        a.ids.insert(Source::Youtube, "y".into());
        a.duration_ms = Some(1);
        let mut b = t("B", "Y");
        b.ids.insert(Source::Spotify, "s".into());
        b.isrc = Some("I".into());
        b.album = Some("Al".into());
        b.duration_ms = Some(2);
        let m = merge_tracks(&a, &b);
        assert_eq!((m.title.as_str(), m.duration_ms, m.isrc.as_deref(), m.album.as_deref()), ("A", Some(1), Some("I"), Some("Al")));
        assert_eq!(m.ids.len(), 2);
    }
}
