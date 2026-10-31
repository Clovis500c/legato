//! Is a video music? YouTube search and imports bring talks, reactions, tutorials and gameplay along with songs, and
//! many real songs aren't tagged as music. Signals add up to a score; only a clear "not music" is hidden, a doubt keeps
//! the video (user's rule, 2026-10-20: better keep a doubt than drop a real song).

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;
use ts_rs::TS;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
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
        r"official\s+(?:music\s+)?(?:video|audio|visuali[sz]er|lyric\s+video|mv)|music\s+video|lyrics?|lyric\s+video|paroles|letra|songtext|clip\s+officiel|audio\s+officiel|vid[ée]o\s+officielle|visuali[sz]er|remix|remaster(?:ed)?|acoustic|unplugged|cover|instrumental|karaoke|slowed|reverb|sped\s+up|nightcore|bass\s+boosted|8d\s+audio|ost|soundtrack|theme\s+song|song|songs|ncs|opening|ending|feat\.?|ft\.?|prod\.?|mv|amv|single|album|ep\b|live\s+(?:at|from|in|session)|session|version|edit|mashup|bootleg|freestyle|beat|type\s+beat|phonk|lofi|lo-fi|bops?|bangers?|tunes",
    )
});
// Not-music words. Strong ones say it alone; weak ones only with nothing musical around.
static STRONG: LazyLock<Regex> = LazyLock::new(|| {
    words(
        r"reaction|reacts?\s+to|reacting|first\s+time\s+(?:hearing|listening|reacting)|review|tutorial|how\s+to\s+(?:\w+ly\s+)?(?:make|create|add|use|get|play|install|fix|build|code|script|animate|set\s*up|learn|draw|find|style|work|sync|optimi[sz]e|edit|design|start|earn|win|beat\s+the)|lesson|podcast|interview|vlog|gameplay|walkthrough|let'?s\s+play|speedrun|unboxing|explained|analysis|breakdown|documentary|behind\s+the\s+scenes|making\s+of|tier\s+list|ranking|prank|challenge|news|trailer|teaser|full\s+movie|full\s+episode|full\s+match|highlights|q\s*&\s*a|stream\s+highlights|asmr|mukbang|haul|recipe|unpopular\s+opinion",
    )
});
static WEAK: LazyLock<Regex> = LazyLock::new(|| words(r"#shorts|shorts|episode|ep\.\s*\d+|part\s+\d+|funny|compilation|top\s+\d+|vs\.?|explain|guide|tips|update|live\s+stream|livestream|stream|how\s+to"));
// Talk and how-to vocabulary (dev, games, tech, money): each counts, with nothing musical around. User's report
// 2026-10-22: Roblox scripting videos filled two Daily Mixes.
static TALK: LazyLock<Regex> = LazyLock::new(|| {
    words(
        r"roblox|robux|studio|scripting|script|coding|programming|programmer|developers?|development|devlog|gamedev|game\s+dev|code|api|ui|ux|lua|luau|typescript|python|javascript|unity|unreal|godot|blender|after\s+effects|davinci|optimi[sz](?:e|ed|ing|ations?)|function|systems?|remote\s*events?|raycast\w*|hitbox|tweens?|npc|vfx|plugin|module|server|cross-server|exploit|bypass|bug|windows|microsoft|setup|career|job|money|business|compan(?:y|ies)|tips|tricks|beginners?|advanced|easiest|underrated|insane|satisfying|finally\s+possible|stop\s+(?:using|creating|doing)|is\s+(?:extremely|really)|voice\s+chat|text\s*chat|loading\s+screen|game|games",
    )
});
// Long uploads that are still music.
static LONG_MUSIC: LazyLock<Regex> = LazyLock::new(|| words(r"mix|playlist|full\s+album|album|compilation|hours?|\d+\s*h|loop|lofi|lo-fi|radio|dj\s+set|set|concert|live|megamix|medley|ost|soundtrack"));
// Music hashtags (#ncsmusic, #phonk, #lofihiphop…).
static HASHTAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)#\w*(music|song|remix|phonk|lofi|beat|rap|edm)\w*").unwrap());
static ARTIST_DASH_TITLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[^-–—|]{1,60}\s[-–—]\s.{1,120}$").unwrap());

/// Score: above 0 leans music, below leans not. Exposed for tests and sorting.
pub fn score(c: &Clues) -> i32 {
    let mut s = 0;
    match c.video_type {
        Some(VideoType::Song) => s += 6,
        Some(VideoType::Official) => s += 5,
        // YouTube Music files some radio uploads of songs as podcast episodes: a strong hint, not the last word.
        Some(VideoType::Podcast) => s -= 4,
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
    if HASHTAG.is_match(title) {
        s += 2;
    }
    if ARTIST_DASH_TITLE.is_match(title) {
        s += 2;
    }
    let strong = STRONG.find_iter(title).count() as i32;
    s -= 6 * strong.min(2);
    if WEAK.is_match(title) && musical == 0 {
        s -= 2;
    }
    if musical == 0 {
        s -= 2 * (TALK.find_iter(title).count() as i32).min(2);
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

impl Musicness {
    /// Database text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Music => "music",
            Self::Unsure => "unsure",
            Self::NotMusic => "notMusic",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "music" => Self::Music,
            "unsure" => Self::Unsure,
            "notMusic" => Self::NotMusic,
            _ => return None,
        })
    }

    /// Two views of the same track: a "music" from anywhere settles it, else the newer word.
    pub fn merge(old: Option<Self>, new: Option<Self>) -> Option<Self> {
        match (old, new) {
            (Some(Self::Music), _) | (_, Some(Self::Music)) => Some(Self::Music),
            (o, n) => n.or(o),
        }
    }
}

/// Stored word against today's rules (they get better; old imports carry none): a "not music" stays, a "music" goes only
/// on clear talk, the rest is asked again. The user's own choice is applied by the caller, above all this.
pub fn judge(stored: Option<Musicness>, c: &Clues) -> Musicness {
    match stored {
        Some(Musicness::NotMusic) => Musicness::NotMusic,
        Some(Musicness::Music) if score(c) > CLEAR_TALK => Musicness::Music,
        _ => classify(c),
    }
}

/// Score this low: talk even if once filed as music (old rules, a guess).
const CLEAR_TALK: i32 = -6;

/// Channels that are mostly talk (two "not music" or more, at least as many as songs): their doubts are talk too.
/// `items` = (channel, word) of the whole library; returns the channels.
pub fn talk_channels<'a>(items: impl IntoIterator<Item = (&'a str, Musicness)>) -> std::collections::HashSet<String> {
    let mut count: std::collections::HashMap<String, (u32, u32)> = std::collections::HashMap::new();
    for (channel, m) in items {
        let e = count.entry(channel.trim().to_lowercase()).or_default();
        match m {
            Musicness::NotMusic => e.0 += 1,
            Musicness::Music => e.1 += 1,
            Musicness::Unsure => {}
        }
    }
    count.into_iter().filter(|(_, (talk, songs))| *talk >= 2 && talk >= songs).map(|(c, _)| c).collect()
}

pub fn classify(c: &Clues) -> Musicness {
    // Labels from YouTube Music itself settle it.
    if matches!(c.video_type, Some(VideoType::Song | VideoType::Official)) {
        return Musicness::Music;
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
    fn songs_with_misleading_tags_stay() {
        // 2026-10-21, the user's library: a radio upload filed as a podcast, an NCS song tagged #asmr.
        let radio = Clues { title: "Crystal Waters - Gypsy Woman (La Da Dee La Da Da)", channel: "Radio Studio80", duration_ms: Some(240_000), video_type: Some(VideoType::Podcast), ..Default::default() };
        assert_ne!(classify(&radio), Musicness::NotMusic);
        assert_ne!(video("Song: SUPXR - TRANSFER #ncsmusic #blender #asmr", "Wingless Mecha", 180), Musicness::NotMusic);
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
    fn dev_talk_is_not_music() {
        // 2026-10-22, the user's library: Roblox scripting channels in Daily Mixes.
        assert_eq!(video("Is Roblox Development A Viable Career?", "SmartyRBX", 538), Musicness::NotMusic);
        assert_eq!(video("Reliable vs Unreliable RemoteEvents on Roblox", "Roblox Learn", 556), Musicness::NotMusic);
        assert_eq!(video("STOP USING LUA... Use ROBLOX TS instead!", "Cookie Tech", 1361), Musicness::NotMusic);
        assert_eq!(video("Roblox RaycastHitbox Is Extremely Useful...", "Paul1Rb", 733), Musicness::NotMusic);
        assert_eq!(video("How To EASILY Make Procedural Animations In Roblox", "Roox4", 406), Musicness::NotMusic);
        // Songs with "how to" in the title stay.
        assert_ne!(video("how to sleep", "Deathbrain", 203), Musicness::NotMusic);
        assert_ne!(video("show me the sky. show me how to live", "AZALI", 104), Musicness::NotMusic);
        assert_ne!(video("Roblox Bacon Dancing + Nostalgia Roblox Song But Low Quality", "GuestVIP", 1735), Musicness::NotMusic);
        assert_ne!(video("MONTAGEM NIGHTMARE", "DJ DJN, DJ ZIRCON", 77), Musicness::NotMusic);
        assert_ne!(video("MORE video game bops for locking in", "Denz1000", 3105), Musicness::NotMusic);
    }

    #[test]
    fn stored_words_meet_new_rules() {
        let talk = Clues { title: "Is Roblox Development A Viable Career?", channel: "SmartyRBX", duration_ms: Some(538_000), ..Default::default() };
        let song = Clues { title: "Get Lucky", channel: "Daft Punk", duration_ms: Some(248_000), ..Default::default() };
        assert_eq!(judge(None, &talk), Musicness::NotMusic);
        assert_eq!(judge(Some(Musicness::Unsure), &talk), Musicness::NotMusic);
        assert_eq!(judge(Some(Musicness::NotMusic), &song), Musicness::NotMusic);
        assert_eq!(judge(Some(Musicness::Music), &song), Musicness::Music);
        let tutorial = Clues { title: "How To Make A Combat System In Roblox Studio", channel: "x", duration_ms: Some(1_373_000), ..Default::default() };
        assert_eq!(judge(Some(Musicness::Music), &tutorial), Musicness::NotMusic);
        let channels = talk_channels([("Roblox Learn", Musicness::NotMusic), ("roblox learn", Musicness::NotMusic), ("Roblox Learn", Musicness::Unsure), ("Band", Musicness::NotMusic), ("Band", Musicness::Music), ("Band", Musicness::Music)]);
        assert_eq!(channels.into_iter().collect::<Vec<_>>(), vec!["roblox learn".to_string()]);
    }

    #[test]
    fn words_match_whole_words_only() {
        // "cover" inside "discover", "review" inside "preview": no match.
        assert_eq!(score(&Clues { title: "Discover", channel: "x", ..Default::default() }), 0);
        assert!(!STRONG.is_match("Preview of the new single"));
    }
}
