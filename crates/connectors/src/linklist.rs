//! What a pasted Deezer or Apple Music link gives back: a name, a cover and a track list. Metadata only; the shell
//! finds each song on YouTube like it does for a Spotify link.

use music_core::model::Track;

#[derive(Debug, PartialEq)]
pub struct LinkList {
    /// "playlist" or "album".
    pub kind: &'static str,
    pub name: String,
    pub cover: Option<String>,
    pub tracks: Vec<Track>,
    /// Songs the service says the list has (more than `tracks` when its page showed only the first ones).
    pub total: usize,
}

/// Most songs one link brings in (a list is matched song by song).
pub const MAX_TRACKS: usize = 3000;
