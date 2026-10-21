//! Is a video music? YouTube search and imports bring talks, reactions, tutorials and gameplay along with songs, and
//! many real songs aren't tagged as music. Signals add up to a score; only a clear "not music" is hidden, a doubt keeps
//! the video (user's rule, 2026-10-20: better keep a doubt than drop a real song).

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

/// YouTube Music's own kind of a video, when known (`musicVideoType`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VideoType {
    /// Song art track (ATV): a song by definition.
    Song,
    /// Official music video (OMV) or official source.
    Official,
    /// Anyone's upload (UGC): could be anything.
    User,
    Podcast,
}

impl VideoType {
    /// From InnerTube's `MUSIC_VIDEO_TYPE_*`.
    pub fn from_innertube(s: &str) -> Option<Self> {
        Some(match s {
            "MUSIC_VIDEO_TYPE_ATV" => Self::Song,
            "MUSIC_VIDEO_TYPE_OMV" | "MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC" => Self::Official,
            "MUSIC_VIDEO_TYPE_UGC" => Self::User,
            "MUSIC_VIDEO_TYPE_PODCAST_EPISODE" => Self::Podcast,
            _ => return None,
        })
    }
}

/// What a search result or playlist item tells about itself.
#[derive(Debug, Clone, Default)]
pub struct Clues<'a> {
    pub title: &'a str,
    pub channel: &'a str,
    pub duration_ms: Option<u32>,
    /// Channel carries YouTube's official artist badge.
    pub artist_badge: bool,
    pub video_type: Option<VideoType>,
    /// Live stream now.
    pub live: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Musicness {
    Music,
    /// Can't tell: shown.
    Unsure,
    /// Clearly something else: hidden until asked.
    NotMusic,
}

fn words(pattern: &str) -> Regex {
    Regex::new(&format!(r"(?i)(?:^|[^\p{{L}}\d])(?:{pattern})(?:$|[^\p{{L}}\d])")).unwrap()
}

// Music words in titles, any language the user's library shows (en, fr, es, de, ja romaji…).
static MUSIC: LazyLock<Regex> = LazyLock::new(|| {
    words(
        r"official\s+(?:music\s+)?(?:video|audio|visuali[sz]er|lyric\s+video|mv)|music\s+video|lyrics?|lyric\s+video|paroles|letra|songtext|clip\s+officiel|audio\s+officiel|vid[ée]o\s+officielle|visuali[sz]er|remix|remaster(?:ed)?|acoustic|unplugged|cover|instrumental|karaoke|slowed|reverb|sped\s+up|nightcore|bass\s+boosted|8d\s+audio|ost|soundtrack|theme\s+song|opening|ending|feat\.?|ft\.?|prod\.?|mv|amv|single|album|ep\b|live\s+(?:at|from|in|session)|session|version|edit|mashup|bootleg|freestyle|beat|type\s+beat|phonk|lofi|lo-fi",
    )
});
// Not-music words. Strong ones say it alone; weak ones only with nothing musical around.
static STRONG: LazyLock<Regex> = LazyLock::new(|| {
    words(
        r"reaction|reacts?\s+to|reacting|first\s+time\s+(?:hearing|listening|reacting)|review|tutorial|how\s+to|lesson|podcast|interview|vlog|gameplay|walkthrough|let'?s\s+play|speedrun|unboxing|explained|analysis|breakdown|documentary|behind\s+the\s+scenes|making\s+of|tier\s+list|ranking|prank|challenge|news|trailer|teaser|full\s+movie|full\s+episode|full\s+match|highlights|q\s*&\s*a|stream\s+highlights|asmr|mukbang|haul|recipe|unpopular\s+opinion",
    )
});
static WEAK: LazyLock<Regex> = LazyLock::new(|| words(r"#shorts|shorts|episode|ep\.\s*\d+|part\s+\d+|funny|compilation|top\s+\d+|vs\.?|explain|guide|tips|update|live\s+stream|livestream|stream"));
// Long uploads that are still music.
static LONG_MUSIC: LazyLock<Regex> = LazyLock::new(|| words(r"mix|playlist|full\s+album|album|compilation|hours?|\d+\s*h|loop|lofi|lo-fi|radio|dj\s+set|set|concert|live|megamix|medley|ost|soundtrack"));
static ARTIST_DASH_TITLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[^-–—|]{1,60}\s[-–—]\s.{1,120}$").unwrap());

/// Score: above 0 leans music, below leans not. Exposed for tests and sorting.
pub fn score(c: &Clues) -> i32 {
    let mut s = 0;
    match c.video_type {
        Some(VideoType::Song) => s += 6,
        Some(VideoType::Official) => s += 5,
        Some(VideoType::Podcast) => s -= 6,
        Some(VideoType::User) | None => {}
    }
    let channel = c.channel.trim();
    if channel.ends_with(" - Topic") {
        s += 6;
    }
    if channel.to_lowercase().ends_with("vevo") {
        s += 4;
    }
    if c.artist_badge {
        s += 3;
    }
    let title = c.title;
    let musical = MUSIC.find_iter(title).count() as i32;
    s += 2 * musical.min(2);
    if ARTIST_DASH_TITLE.is_match(title) {
        s += 1;
    }
    let strong = STRONG.find_iter(title).count() as i32;
    s -= 6 * strong.min(2);
    if WEAK.is_match(title) && musical == 0 {
        s -= 2;
    }
    match c.duration_ms.map(|d| d / 1000) {
        Some(d) if d < 45 => s -= 2,
        Some(d) if (90..=480).contains(&d) => s += 1,
        Some(d) if d > 20 * 60 && !LONG_MUSIC.is_match(title) => s -= 2,
        _ => {}
    }
    if c.live && musical == 0 {
        s -= 1;
    }
    s
}

pub fn classify(c: &Clues) -> Musicness {
    // Labels from YouTube Music itself settle it.
    match c.video_type {
        Some(VideoType::Song | VideoType::Official) => return Musicness::Music,
        Some(VideoType::Podcast) => return Musicness::NotMusic,
        _ => {}
    }
    match score(c) {
        s if s >= 1 => Musicness::Music,
        s if s <= -4 => Musicness::NotMusic,
        _ => Musicness::Unsure,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video(title: &str, channel: &str, secs: u32) -> Musicness {
        classify(&Clues { title, channel, duration_ms: Some(secs * 1000), ..Default::default() })
    }

    #[test]
    fn songs_are_music() {
        assert_eq!(video("Get Lucky", "Daft Punk - Topic", 248), Musicness::Music);
        assert_eq!(video("Daft Punk - Get Lucky (Official Audio) ft. Pharrell Williams", "Daft Punk", 369), Musicness::Music);
        assert_eq!(video("Hello", "AdeleVEVO", 367), Musicness::Music);
        assert_eq!(video("you are not suguru geto. (slowed + reverb)", "eramnesia", 160), Musicness::Music);
        assert_eq!(video("Stromae - Alors on danse (Clip officiel)", "Stromae", 210), Musicness::Music);
        assert_eq!(video("lofi hip hop radio - beats to relax/study to", "Lofi Girl", 3 * 3600), Musicness::Music);
    }

    #[test]
    fn untagged_songs_are_kept() {
        // Plain upload, plain title, song length: unsure, so still shown.
        assert_ne!(video("Flashing Lights", "noevdv", 158), Musicness::NotMusic);
        assert_ne!(video("A Bird's Last Look", "Ezrahkell", 332), Musicness::NotMusic);
        // Reaction to an official video: musical words pull it back to a doubt.
        assert_ne!(video("Daft Punk - Get Lucky (Official Video) REACTION", "Some Reactor", 900), Musicness::Music);
    }

    #[test]
    fn talks_and_games_are_not() {
        assert_eq!(video("FIRST TIME HEARING Queen - Bohemian Rhapsody | REACTION", "Reactor Guy", 1500), Musicness::NotMusic);
        assert_eq!(video("How to play Wonderwall on guitar (easy tutorial)", "Guitar Lessons", 720), Musicness::NotMusic);
        assert_eq!(video("Minecraft Hardcore Let's Play Episode 12", "Gamer", 2400), Musicness::NotMusic);
        assert_eq!(video("Album review: the worst record of the year", "Critic", 1100), Musicness::NotMusic);
    }

    #[test]
    fn youtube_music_labels_settle_it() {
        let c = |t| Clues { title: "Interview with the band", channel: "x", video_type: Some(t), ..Default::default() };
        assert_eq!(classify(&c(VideoType::Song)), Musicness::Music);
        assert_eq!(classify(&c(VideoType::Podcast)), Musicness::NotMusic);
        assert_eq!(VideoType::from_innertube("MUSIC_VIDEO_TYPE_OMV"), Some(VideoType::Official));
        assert_eq!(VideoType::from_innertube("SOMETHING_NEW"), None);
    }

    #[test]
    fn words_match_whole_words_only() {
        // "cover" inside "discover", "review" inside "preview": no match.
        assert_eq!(score(&Clues { title: "Discover", channel: "x", ..Default::default() }), 0);
        assert!(!STRONG.is_match("Preview of the new single"));
    }
}
