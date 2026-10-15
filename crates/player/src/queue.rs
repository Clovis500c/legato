use std::path::PathBuf;

/// Play order + gapless bookkeeping: `loaded` = items from `pos` already in audio sink.
#[derive(Debug, Default)]
pub struct Queue {
    items: Vec<PathBuf>,
    pos: usize,
    loaded: usize,
}

impl Queue {
    pub fn new(items: Vec<PathBuf>, start: usize) -> Self {
        Self { pos: start.min(items.len()), items, loaded: 0 }
    }

    /// None once queue ran out.
    pub fn current(&self) -> Option<&PathBuf> {
        self.items.get(self.pos)
    }

    /// Items to append now: current on fresh start, next one as gapless preload.
    pub fn to_load(&mut self) -> Vec<PathBuf> {
        // Invariant: loaded <= want (sync shrinks loaded when pos moves).
        let want = (self.items.len() - self.pos).min(2);
        let out = self.items[self.pos + self.loaded..self.pos + want].to_vec();
        self.loaded = want;
        out
    }

    /// Sink holds `left` sources now. Drop finished ones, return how many.
    pub fn sync(&mut self, left: usize) -> usize {
        let done = self.loaded.saturating_sub(left);
        self.pos += done;
        self.loaded -= done;
        done
    }

    /// Move by `delta`. False if out of range. Caller resets sink.
    pub fn jump(&mut self, delta: isize) -> bool {
        match self.pos.checked_add_signed(delta) {
            Some(p) if p < self.items.len() => {
                self.pos = p;
                self.loaded = 0;
                true
            }
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(n: usize, start: usize) -> Queue {
        Queue::new((0..n).map(|i| PathBuf::from(i.to_string())).collect(), start)
    }

    fn names(v: Vec<PathBuf>) -> Vec<String> {
        v.into_iter().map(|p| p.display().to_string()).collect()
    }

    #[test]
    fn start_is_clamped() {
        assert_eq!(q(3, 1).current(), Some(&PathBuf::from("1")));
        assert_eq!(q(3, 9).current(), None);
        assert!(q(0, 0).to_load().is_empty());
    }

    #[test]
    fn preloads_next_once() {
        let mut q = q(3, 0);
        assert_eq!(names(q.to_load()), ["0", "1"]);
        assert!(q.to_load().is_empty());
    }

    #[test]
    fn gapless_chain_advances_and_preloads_following() {
        let mut q = q(3, 0);
        q.to_load();
        assert_eq!(q.sync(2), 0);
        // Track 0 ended, sink now plays preloaded 1.
        assert_eq!(q.sync(1), 1);
        assert_eq!(q.current(), Some(&PathBuf::from("1")));
        assert_eq!(names(q.to_load()), ["2"]);
        assert_eq!(q.sync(1), 1);
        assert!(q.to_load().is_empty(), "last track: nothing to preload");
        assert_eq!(q.sync(0), 1);
        assert_eq!(q.current(), None);
    }

    #[test]
    fn failed_decode_is_skipped() {
        // Current fails to decode: only next reaches sink.
        let mut q = q(3, 0);
        q.to_load();
        assert_eq!(q.sync(1), 1);
        assert_eq!(q.current(), Some(&PathBuf::from("1")));
    }

    #[test]
    fn jump_bounds_and_reload() {
        let mut q = q(3, 0);
        q.to_load();
        assert!(!q.jump(-1));
        assert!(q.jump(2));
        assert_eq!(names(q.to_load()), ["2"]);
        assert!(!q.jump(1));
        // After end, prev goes back to last track.
        q.sync(0);
        assert!(q.jump(-1));
        assert_eq!(q.current(), Some(&PathBuf::from("2")));
    }
}
