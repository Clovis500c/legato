//! How hard an import searches YouTube. Its searches are unofficial and free: Google sets the speed, and a refusal
//! ("Sorry…" page, 429) says too fast for now. Never around it: fewer at once, wait, the same song again later.

use std::time::{Duration, Instant};

const START: usize = 4;
const MOST: usize = 8;
/// Answers in a row before one more search at once.
const GROW: usize = 12;
const FIRST_WAIT: Duration = Duration::from_secs(5);
const LONGEST_WAIT: Duration = Duration::from_secs(60);
/// Refused this long, no answer: the rest waits for another import.
const GIVE_UP: Duration = Duration::from_secs(5 * 60);

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

#[cfg(test)]
mod tests {
    use super::*;

    const SECOND: Duration = Duration::from_secs(1);

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
