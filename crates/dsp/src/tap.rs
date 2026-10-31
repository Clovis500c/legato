//! A copy of what plays, out of the audio thread for the visualizer's FFT. Lock-free: the audio thread stores the last
//! frames (left, right) into a ring of atomics and moves a counter; a reader copies the newest ones when it wants.
//! No lock, no allocation on the audio side; nobody listening = one atomic load per block and nothing else.
//! A copy torn by a write in the same instant is a wrong pixel for one frame, never a crash (all atomics).

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering::{Acquire, Relaxed, Release}};

/// Frames kept (power of two): 340 ms at 48 kHz, four times what a reader takes, so a copy is never lapped.
const CAP: usize = 1 << 14;

#[derive(Debug)]
pub struct Tap {
    listeners: AtomicU32,
    rate: AtomicU32,
    /// Frames written so far, ever (only counts while someone listens).
    head: AtomicU64,
    left: Box<[AtomicU32]>,
    right: Box<[AtomicU32]>,
}

impl Default for Tap {
    fn default() -> Self {
        let ring = || (0..CAP).map(|_| AtomicU32::new(0)).collect::<Box<[_]>>();
        Self { listeners: AtomicU32::new(0), rate: AtomicU32::new(48_000), head: AtomicU64::new(0), left: ring(), right: ring() }
    }
}

impl Tap {
    /// Audio thread: `block` (whole interleaved frames) as played, at `rate`. Mono is both sides, more than two
    /// channels: the first two.
    #[inline]
    pub fn push(&self, block: &[f32], channels: usize, rate: u32) {
        if self.listeners.load(Relaxed) == 0 || channels == 0 {
            return;
        }
        self.rate.store(rate, Relaxed);
        let mut h = self.head.load(Relaxed);
        for f in block.chunks_exact(channels) {
            let i = h as usize & (CAP - 1);
            self.left[i].store(f[0].to_bits(), Relaxed);
            self.right[i].store(f[channels.min(2) - 1].to_bits(), Relaxed);
            h += 1;
        }
        self.head.store(h, Release);
    }

    /// Starts copying (until the listener is dropped). Several at once are fine.
    pub fn listen(self: &Arc<Self>) -> Listener {
        self.listeners.fetch_add(1, Relaxed);
        Listener { tap: self.clone(), since: self.head.load(Acquire) }
    }
}

#[derive(Debug)]
pub struct Listener {
    tap: Arc<Tap>,
    /// Head when it began: older ring content is from an earlier listening.
    since: u64,
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.tap.listeners.fetch_sub(1, Relaxed);
    }
}

impl Listener {
    /// Frames written since this listener began.
    pub fn head(&self) -> u64 {
        self.tap.head.load(Acquire)
    }

    /// Sample rate of what was last written.
    pub fn rate(&self) -> u32 {
        self.tap.rate.load(Relaxed)
    }

    /// The newest `left.len()` frames into `left` / `right` (same length), oldest first; zeros before the start.
    pub fn latest(&self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len()).min(CAP / 2);
        let head = self.head();
        for j in 0..n {
            // Frame index of slot j: the newest is head - 1.
            let age = (n - j) as u64;
            let (l, r) = match head.checked_sub(age).filter(|&f| f >= self.since) {
                Some(f) => {
                    let i = f as usize & (CAP - 1);
                    (f32::from_bits(self.tap.left[i].load(Relaxed)), f32::from_bits(self.tap.right[i].load(Relaxed)))
                }
                None => (0.0, 0.0),
            };
            left[j] = l;
            right[j] = r;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nobody_listening_keeps_nothing() {
        let tap = Arc::new(Tap::default());
        tap.push(&[1.0, 1.0, 1.0, 1.0], 2, 44_100);
        let l = tap.listen();
        assert_eq!(l.head(), 0);
        assert_eq!(tap.listeners.load(Relaxed), 1);
        drop(l);
        assert_eq!(tap.listeners.load(Relaxed), 0);
    }

    #[test]
    fn the_newest_frames_come_out_in_order_with_zeros_before_the_start() {
        let tap = Arc::new(Tap::default());
        let l = tap.listen();
        // Left 1, 2, 3 and right -1, -2, -3.
        tap.push(&[1.0, -1.0, 2.0, -2.0, 3.0, -3.0], 2, 44_100);
        let (mut a, mut b) = ([9.0; 5], [9.0; 5]);
        l.latest(&mut a, &mut b);
        assert_eq!(a, [0.0, 0.0, 1.0, 2.0, 3.0]);
        assert_eq!(b, [0.0, 0.0, -1.0, -2.0, -3.0]);
        assert_eq!(l.rate(), 44_100);
        assert_eq!(l.head(), 3);
    }

    #[test]
    fn mono_is_both_sides_and_old_content_is_not_shown_to_a_new_listener() {
        let tap = Arc::new(Tap::default());
        let first = tap.listen();
        tap.push(&[0.5, 0.25], 1, 48_000);
        drop(first);
        let second = tap.listen();
        tap.push(&[0.75], 1, 48_000);
        let (mut a, mut b) = ([9.0; 3], [9.0; 3]);
        second.latest(&mut a, &mut b);
        assert_eq!((a, b), ([0.0, 0.0, 0.75], [0.0, 0.0, 0.75]));
    }

    #[test]
    fn the_ring_wraps() {
        let tap = Arc::new(Tap::default());
        let l = tap.listen();
        let block: Vec<f32> = (0..CAP * 3 / 2).map(|i| i as f32).collect();
        tap.push(&block, 1, 48_000);
        let (mut a, mut b) = ([0.0; 4], [0.0; 4]);
        l.latest(&mut a, &mut b);
        let end = (CAP * 3 / 2) as f32;
        assert_eq!(a, [end - 4.0, end - 3.0, end - 2.0, end - 1.0]);
    }
}
