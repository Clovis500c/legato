//! How hard an import searches YouTube. Its searches are unofficial and free: Google sets the speed, and a refusal
//! ("Sorry…" page, 429) says too fast for now. Never around it: fewer at once, wait, the same song again later.
//! What makes an import quicker is asking less: `Line`.

use crate::matching::{best_match, merge_tracks, normalize, primary_artist};
use crate::model::{Source, Track};
use std::cmp::Reverse;
use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

const START: usize = 4;
const MOST: usize = 8;
/// Answers in a row before one more search at once.
const GROW: usize = 12;
const FIRST_WAIT: Duration = Duration::from_secs(5);
const LONGEST_WAIT: Duration = Duration::from_secs(60);
/// Refused this long, no answer: the rest waits for another import. A real block lasted 5 min (2026-10-31), and Hide leaves the app free.
const GIVE_UP: Duration = Duration::from_secs(15 * 60);

/// Google's answer to too many requests from one address (its "Sorry…" page, or a 429): says nothing about the song
/// or the list asked for. Searches, YouTube Music's pages, its sync: one block for all of them.
pub fn refused(error: &str) -> bool {
    error.contains("429 Too Many Requests") || (error.contains("403 Forbidden") && error.contains("Sorry"))
}

pub struct Pace {
    width: usize,
    clean: usize,
    wait: Duration,
    resume: Option<Instant>,
    /// First refusal since the last answer.
    since: Option<Instant>,
    /// All of them, for the log.
    pub refusals: usize,
}

impl Default for Pace {
    fn default() -> Self {
        Pace { width: START, clean: 0, wait: FIRST_WAIT, resume: None, since: None, refusals: 0 }
    }
}

impl Pace {
    fn waiting(&self, now: Instant) -> bool {
        self.resume.is_some_and(|at| now < at)
    }

    /// How long the searches still wait.
    pub fn wait_left(&self, now: Instant) -> Duration {
        self.resume.map_or(Duration::ZERO, |at| at.saturating_duration_since(now))
    }

    /// Searches allowed at once. 0: waiting.
    pub fn width(&self, now: Instant) -> usize {
        if self.waiting(now) { 0 } else { self.width }
    }

    pub fn answered(&mut self, now: Instant) {
        // Sent before the refusal: says nothing about now.
        if self.waiting(now) {
            return;
        }
        (self.wait, self.since) = (FIRST_WAIT, None);
        self.clean += 1;
        if self.clean >= GROW {
            (self.width, self.clean) = ((self.width + 1).min(MOST), 0);
        }
    }

    pub fn refused(&mut self, now: Instant) {
        self.refusals += 1;
        // Same burst, already waiting.
        if self.waiting(now) {
            return;
        }
        (self.width, self.clean) = ((self.width / 2).max(1), 0);
        self.since.get_or_insert(now);
        self.resume = Some(now + self.wait);
        self.wait = (self.wait * 2).min(LONGEST_WAIT);
    }

    pub fn gave_up(&self, now: Instant) -> bool {
        self.since.is_some_and(|at| now.duration_since(at) >= GIVE_UP)
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
    fn grows_while_youtube_answers_never_past_the_limit() {
        let (mut pace, now) = (Pace::default(), Instant::now());
        assert_eq!(pace.width(now), START);
        (0..GROW).for_each(|_| pace.answered(now));
        assert_eq!(pace.width(now), START + 1);
        (0..GROW * 20).for_each(|_| pace.answered(now));
        assert_eq!(pace.width(now), MOST);
    }

    #[test]
    fn a_refusal_halves_it_and_waits() {
        let (mut pace, now) = (Pace::default(), Instant::now());
        pace.refused(now);
        assert_eq!(pace.width(now), 0);
        assert_eq!(pace.width(now + FIRST_WAIT - SECOND), 0);
        assert_eq!(pace.width(now + FIRST_WAIT), START / 2);
    }

    #[test]
    fn a_burst_of_refusals_counts_once() {
        let (mut pace, now) = (Pace::default(), Instant::now());
        (0..4).for_each(|_| pace.refused(now));
        assert_eq!(pace.refusals, 4);
        assert_eq!(pace.width(now + FIRST_WAIT), START / 2);
        // Not doubled by the burst.
        pace.refused(now + FIRST_WAIT);
        assert_eq!(pace.width(now + FIRST_WAIT * 3 - SECOND), 0);
        assert_eq!(pace.width(now + FIRST_WAIT * 3), 1);
    }

    #[test]
    fn waits_longer_each_time_up_to_a_minute_then_gives_up() {
        let (mut pace, mut now) = (Pace::default(), Instant::now());
        let start = now;
        let mut waits = Vec::new();
        while !pace.gave_up(now) {
            pace.refused(now);
            let from = now;
            while pace.width(now) == 0 {
                now += SECOND;
            }
            waits.push((now - from).as_secs());
        }
        assert_eq!(waits[..5], [5, 10, 20, 40, 60]);
        assert!(waits.iter().all(|w| *w <= 60));
        assert!(now - start >= GIVE_UP);
    }

    #[test]
    fn one_answer_clears_it() {
        let (mut pace, now) = (Pace::default(), Instant::now());
        pace.refused(now);
        let later = now + FIRST_WAIT;
        pace.answered(later);
        pace.refused(later);
        assert!(!pace.gave_up(later + GIVE_UP - SECOND));
        assert_eq!(pace.width(later + FIRST_WAIT), 1);
    }

    #[test]
    fn an_answer_from_before_the_wait_changes_nothing() {
        let (mut pace, now) = (Pace::default(), Instant::now());
        pace.refused(now);
        pace.answered(now + SECOND);
        assert!(pace.gave_up(now + GIVE_UP));
    }
}
