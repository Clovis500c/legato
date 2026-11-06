//! How hard an import searches YouTube. Its searches are unofficial and free: Google sets the speed, and a refusal
//! ("Sorry…" page, 429) says too fast. Never around it. A refusal costs more than the import: Google then limits the
//! whole address for hours, YouTube's own player too (2026-11-01: an import's 1840 searches, up to 8 at once, then a
//! third of the songs refused at their start all evening). So one search at a time, spaced, more spaced after a refusal,
//! which waits minutes. What makes an import quicker is asking less: `Line`.

use crate::matching::{best_match, merge_tracks, normalize, primary_artist};
use crate::model::{Source, Track};
use std::cmp::Reverse;
use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

/// Between two searches' starts: 20 a minute at most (a song can ask twice: YouTube Music, then YouTube).
const GAP: Duration = Duration::from_secs(3);
/// Each refusal doubles the gap, up to this, for the rest of the run.
const LONGEST_GAP: Duration = Duration::from_secs(15);
/// After a refusal: a real block lasted 5 min (2026-10-31). Doubled by the next refusal with no answer between.
const FIRST_WAIT: Duration = Duration::from_secs(5 * 60);
/// Refused this long, no answer: the rest waits for another import (two searches into a block at most). Hide leaves the
/// app free.
const GIVE_UP: Duration = Duration::from_secs(15 * 60);

/// Google's answer to too many requests from one address (its "Sorry…" page, or a 429): says nothing about the song
/// or the list asked for. Searches, YouTube Music's pages, its sync: one block for all of them.
pub fn refused(error: &str) -> bool {
    error.contains("429 Too Many Requests") || (error.contains("403 Forbidden") && error.contains("Sorry"))
}

pub struct Pace {
    gap: Duration,
    /// When the last search started.
    last: Option<Instant>,
    wait: Duration,
    resume: Option<Instant>,
    /// First refusal since the last answer.
    since: Option<Instant>,
    /// All of them, for the log.
    pub refusals: usize,
}

impl Default for Pace {
    fn default() -> Self {
        Pace { gap: GAP, last: None, wait: FIRST_WAIT, resume: None, since: None, refusals: 0 }
    }
}

impl Pace {
    fn waiting(&self, now: Instant) -> bool {
        self.resume.is_some_and(|at| now < at)
    }

    /// How long a refusal's wait still lasts.
    pub fn wait_left(&self, now: Instant) -> Duration {
        self.resume.map_or(Duration::ZERO, |at| at.saturating_duration_since(now))
    }

    /// May the next search start: no refusal's wait, the gap since the last one's start gone.
    pub fn ready(&self, now: Instant) -> bool {
        !self.waiting(now) && self.last.is_none_or(|at| now.saturating_duration_since(at) >= self.gap)
    }

    /// A search starts.
    pub fn started(&mut self, now: Instant) {
        self.last = Some(now);
    }

    pub fn answered(&mut self, now: Instant) {
        // Sent before the refusal: says nothing about now.
        if self.waiting(now) {
            return;
        }
        (self.wait, self.since) = (FIRST_WAIT, None);
    }

    pub fn refused(&mut self, now: Instant) {
        self.refusals += 1;
        // Already waiting.
        if self.waiting(now) {
            return;
        }
        self.gap = (self.gap * 2).min(LONGEST_GAP);
        self.since.get_or_insert(now);
        self.resume = Some(now + self.wait);
        self.wait = (self.wait * 2).min(GIVE_UP);
    }

    pub fn gave_up(&self, now: Instant) -> bool {
        self.since.is_some_and(|at| now.duration_since(at) >= GIVE_UP)
    }
}

/// Between two lookups nobody waits for.
const SPARSE_GAP: Duration = Duration::from_secs(60);
/// After a refusal: three times a real block (5 min, 2026-10-31).
const SPARSE_REFUSED: Duration = Duration::from_secs(15 * 60);

/// Lookups nobody waits for (Discord's artist picture, the owner's choice 2026-11-06): one a minute at most, none for
/// 15 minutes after a refusal. One not taken just isn't asked.
#[derive(Default)]
pub struct Sparse {
    next: Option<Instant>,
}

impl Sparse {
    pub const fn new() -> Self {
        Sparse { next: None }
    }

    /// May one start now; if so, the next waits a minute.
    pub fn take(&mut self, now: Instant) -> bool {
        if self.next.is_some_and(|at| now < at) {
            return false;
        }
        self.next = Some(now + SPARSE_GAP);
        true
    }

    pub fn refused(&mut self, now: Instant) {
        self.next = Some(now + SPARSE_REFUSED);
    }
}

/// Songs waiting for a search, by place in the list being searched. One search brings back around twenty songs: those
/// settle the songs in line with no search of their own. Artists with the most songs first, so that happens early.
pub struct Line {
    todo: VecDeque<usize>,
    /// Songs in line by title, to find them from an answer.
    titles: HashMap<String, Vec<usize>>,
    settled: Vec<bool>,
}

impl Line {
    pub fn new(songs: &[Track], mut todo: Vec<usize>) -> Line {
        let mut artists: HashMap<String, usize> = HashMap::new();
        for &i in &todo {
            *artists.entry(primary_artist(&songs[i].artist)).or_default() += 1;
        }
        todo.sort_by_cached_key(|&i| Reverse(artists[&primary_artist(&songs[i].artist)]));
        let mut titles: HashMap<String, Vec<usize>> = HashMap::new();
        for &i in &todo {
            titles.entry(normalize(&songs[i].title)).or_default().push(i);
        }
        Line { todo: todo.into(), titles, settled: vec![false; songs.len()] }
    }

    pub fn pop(&mut self) -> Option<usize> {
        while let Some(i) = self.todo.pop_front() {
            if !self.settled[i] {
                return Some(i);
            }
        }
        None
    }

    /// Refused: back of the line.
    pub fn again(&mut self, i: usize) {
        self.todo.push_back(i);
    }

    /// Still to search, the ones running aside.
    pub fn left(&self) -> usize {
        self.todo.iter().filter(|&&i| !self.settled[i]).count()
    }

    /// False: another song's answer already settled it.
    pub fn settle(&mut self, i: usize) -> bool {
        !std::mem::replace(&mut self.settled[i], true)
    }

    /// Songs in line that an answer brought back, each with its version, by the rules of a search of its own.
    pub fn also_found(&mut self, songs: &[Track], seen: &[Track]) -> Vec<(usize, Track)> {
        let mut out = Vec::new();
        for hit in seen.iter().filter(|t| t.ids.contains_key(&Source::Youtube)) {
            for &i in self.titles.get(&normalize(&hit.title)).into_iter().flatten() {
                if !self.settled[i] && best_match(&songs[i], std::slice::from_ref(hit)).is_some() {
                    self.settled[i] = true;
                    out.push((i, merge_tracks(&songs[i], hit)));
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_too_many_requests_from_other_failures() {
        assert!(refused("YouTube Music search → 403 Forbidden <html><head><title>Sorry...</title>"));
        assert!(refused("YouTube search → 429 Too Many Requests "));
        assert!(!refused("YouTube Music search → 403 Forbidden {\"error\":{\"message\":\"expired\"}}"));
        assert!(!refused("YouTube Music search → 500 Internal Server Error"));
        assert!(!refused("error sending request"));
    }

    const SECOND: Duration = Duration::from_secs(1);

    #[test]
    fn sparse_lookups_one_a_minute_none_for_a_quarter_hour_after_a_refusal() {
        let t = Instant::now();
        let mut s = Sparse::new();
        assert!(s.take(t));
        assert!(!s.take(t + 59 * SECOND));
        assert!(s.take(t + 60 * SECOND));
        s.refused(t + 61 * SECOND);
        assert!(!s.take(t + 61 * SECOND + 14 * 60 * SECOND));
        assert!(s.take(t + 61 * SECOND + 15 * 60 * SECOND));
    }

    fn song(title: &str, artist: &str) -> Track {
        Track { title: title.into(), artist: artist.into(), ids: [(Source::Spotify, format!("s-{title}"))].into(), ..Default::default() }
    }

    fn video(title: &str, artist: &str) -> Track {
        Track { title: title.into(), artist: artist.into(), ids: [(Source::Youtube, format!("v-{title}"))].into(), ..Default::default() }
    }

    #[test]
    fn the_artists_with_most_songs_go_first() {
        let songs = [song("A", "Solo"), song("B", "Band"), song("C", "Band"), song("D", "Other")];
        let mut line = Line::new(&songs, vec![0, 1, 2, 3]);
        assert_eq!(line.pop(), Some(1));
        assert_eq!(line.pop(), Some(2));
        assert_eq!(line.pop(), Some(0), "the rest in order");
    }

    #[test]
    fn an_answer_settles_the_other_songs_it_brought_back() {
        let songs = [song("One", "Band"), song("Two", "Band"), song("Three", "Band")];
        let mut line = Line::new(&songs, vec![0, 1, 2]);
        let first = line.pop().unwrap();
        assert!(line.settle(first));
        let others = line.also_found(&songs, &[video("One", "Band"), video("Two", "Band"), video("Elsewhere", "Band")]);
        assert_eq!(others.len(), 1);
        assert_eq!(others[0].0, 1);
        assert!(others[0].1.ids.contains_key(&Source::Youtube));
        assert!(others[0].1.ids.contains_key(&Source::Spotify), "still the same song");
        assert_eq!(line.left(), 1);
        assert_eq!(line.pop(), Some(2));
        assert_eq!(line.pop(), None);
    }

    #[test]
    fn the_same_title_by_someone_else_settles_nothing() {
        let songs = [song("Home", "Band"), song("Home", "Other")];
        let mut line = Line::new(&songs, vec![0, 1]);
        let found = line.also_found(&songs, &[video("Home", "Band")]);
        assert_eq!(found.iter().map(|f| f.0).collect::<Vec<_>>(), [0]);
        assert_eq!(line.left(), 1);
    }

    #[test]
    fn a_song_with_no_youtube_id_in_the_answer_settles_nothing() {
        let songs = [song("One", "Band")];
        let mut line = Line::new(&songs, vec![0]);
        assert!(line.also_found(&songs, &[song("One", "Band")]).is_empty());
    }

    #[test]
    fn a_song_settled_while_searching_counts_once() {
        let songs = [song("One", "Band"), song("Two", "Band")];
        let mut line = Line::new(&songs, vec![0, 1]);
        let (a, b) = (line.pop().unwrap(), line.pop().unwrap());
        assert!(line.settle(a));
        assert_eq!(line.also_found(&songs, &[video("Two", "Band")]).len(), 1);
        assert!(!line.settle(b));
    }

    #[test]
    fn a_refused_song_comes_back_last_unless_settled_meanwhile() {
        let songs = [song("One", "Band"), song("Two", "Band"), song("Three", "Solo")];
        let mut line = Line::new(&songs, vec![0, 1, 2]);
        let first = line.pop().unwrap();
        line.again(first);
        assert_eq!(line.left(), 3);
        line.also_found(&songs, &[video("One", "Band")]);
        assert_eq!(line.pop(), Some(1));
        assert_eq!(line.pop(), Some(2));
        assert_eq!(line.pop(), None, "settled in the meantime");
    }

    #[test]
    fn tells_how_long_the_wait_lasts() {
        let (mut pace, now) = (Pace::default(), Instant::now());
        assert_eq!(pace.wait_left(now), Duration::ZERO);
        pace.refused(now);
        assert_eq!(pace.wait_left(now), FIRST_WAIT);
        assert_eq!(pace.wait_left(now + SECOND), FIRST_WAIT - SECOND);
        assert_eq!(pace.wait_left(now + FIRST_WAIT * 2), Duration::ZERO);
    }

    #[test]
    fn one_search_at_a_time_spaced_however_well_youtube_answers() {
        let (mut pace, now) = (Pace::default(), Instant::now());
        assert!(pace.ready(now));
        pace.started(now);
        pace.answered(now + SECOND);
        assert!(!pace.ready(now + GAP - SECOND));
        assert!(pace.ready(now + GAP));
        // Regression guard: up to 8 at once got the address limited for hours (2026-11-01).
        (0..500).for_each(|_| pace.answered(now + GAP));
        pace.started(now + GAP);
        assert!(!pace.ready(now + GAP * 2 - SECOND));
    }

    #[test]
    fn a_refusal_waits_minutes_then_goes_on_more_spaced() {
        let (mut pace, now) = (Pace::default(), Instant::now());
        pace.started(now);
        pace.refused(now + SECOND);
        let back = now + SECOND + FIRST_WAIT;
        assert!(!pace.ready(back - SECOND));
        assert!(pace.ready(back));
        pace.started(back);
        pace.answered(back + SECOND);
        assert!(!pace.ready(back + GAP * 2 - SECOND));
        assert!(pace.ready(back + GAP * 2));
    }

    #[test]
    fn each_refusal_spaces_them_more_up_to_a_limit() {
        let (mut pace, mut now) = (Pace::default(), Instant::now());
        for _ in 0..6 {
            pace.refused(now);
            now += pace.wait_left(now);
            pace.answered(now);
        }
        pace.started(now);
        assert!(!pace.ready(now + LONGEST_GAP - SECOND));
        assert!(pace.ready(now + LONGEST_GAP));
    }

    #[test]
    fn a_refusal_while_waiting_counts_once() {
        let (mut pace, now) = (Pace::default(), Instant::now());
        (0..3).for_each(|_| pace.refused(now));
        assert_eq!(pace.refusals, 3);
        assert!(pace.ready(now + FIRST_WAIT), "not doubled");
    }

    #[test]
    fn refused_again_waits_longer_then_gives_up_two_searches_in() {
        let (mut pace, mut now) = (Pace::default(), Instant::now());
        let start = now;
        let mut tries = 0;
        while !pace.gave_up(now) {
            pace.started(now);
            pace.refused(now);
            tries += 1;
            while !pace.ready(now) {
                now += SECOND;
            }
        }
        assert_eq!(tries, 2, "not dozens of searches into a block");
        assert_eq!(now - start, FIRST_WAIT * 3);
    }

    #[test]
    fn one_answer_clears_it() {
        let (mut pace, now) = (Pace::default(), Instant::now());
        pace.refused(now);
        let later = now + FIRST_WAIT;
        pace.answered(later);
        pace.refused(later);
        assert!(!pace.gave_up(later + GIVE_UP - SECOND));
        assert!(pace.ready(later + FIRST_WAIT), "back to the first wait");
    }

    #[test]
    fn an_answer_from_before_the_wait_changes_nothing() {
        let (mut pace, now) = (Pace::default(), Instant::now());
        pace.refused(now);
        pace.answered(now + SECOND);
        assert!(pace.gave_up(now + GIVE_UP));
    }
}
