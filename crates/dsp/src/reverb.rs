//! Room reverb, Schroeder / Freeverb layout: 8 damped comb filters in parallel, then 4 allpasses in series, per
//! channel (the right side slightly longer for width). Cheap, smooth, and buildable from Web Audio nodes too: live.js
//! uses the same delays and gains, so YouTube and local files sound alike.

/// Comb and allpass lengths at 44.1 kHz (scaled to the stream's rate). Mutually prime-ish: no ringing pile-ups.
pub const COMBS: [usize; 8] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
pub const ALLPASSES: [usize; 4] = [556, 441, 341, 225];
/// Right channel offset.
pub const SPREAD: usize = 23;
/// Comb feedback: 0.7 (small room) .. 0.98 (hall).
pub fn feedback(size: f32) -> f32 {
    0.7 + 0.28 * size.clamp(0.0, 1.0)
}
/// Damping pole in the comb loop.
pub fn damp(damping: f32) -> f32 {
    0.4 * damping.clamp(0.0, 1.0)
}
/// Dry and wet levels for a mix (0..1): the sum stays about as loud as the dry song, whatever the room. Measured on
/// noise: the tail's level grows as (1 - feedback²)^-0.26 with room size; sqrt(mix) keeps small amounts audible.
pub fn levels(mix: f32, size: f32) -> (f32, f32) {
    let mix = mix.clamp(0.0, 1.0);
    (1.0 - 0.5 * mix, 1.75 * mix.sqrt() * (1.0 - feedback(size).powi(2)).powf(0.26))
}
/// Input gain into the combs (keeps the sum of 8 under control).
pub const INPUT: f32 = 0.015;
pub const ALLPASS_GAIN: f32 = 0.5;

struct Comb {
    buf: Vec<f32>,
    i: usize,
    store: f32,
}

impl Comb {
    fn new(len: usize) -> Self {
        Self { buf: vec![0.0; len.max(1)], i: 0, store: 0.0 }
    }

    #[inline]
    fn run(&mut self, x: f32, feedback: f32, damp: f32) -> f32 {
        let out = self.buf[self.i];
        self.store = out * (1.0 - damp) + self.store * damp;
        self.buf[self.i] = x + self.store * feedback;
        self.i = (self.i + 1) % self.buf.len();
        out
    }
}

struct Allpass {
    buf: Vec<f32>,
    i: usize,
}

impl Allpass {
    fn new(len: usize) -> Self {
        Self { buf: vec![0.0; len.max(1)], i: 0 }
    }

    #[inline]
    fn run(&mut self, x: f32) -> f32 {
        let delayed = self.buf[self.i];
        self.buf[self.i] = x + delayed * ALLPASS_GAIN;
        self.i = (self.i + 1) % self.buf.len();
        delayed - x
    }
}

struct Side {
    combs: Vec<Comb>,
    allpasses: Vec<Allpass>,
}

impl Side {
    fn new(scale: f32, offset: usize) -> Self {
        let n = |l: usize| ((l + offset) as f32 * scale).round() as usize;
        Self { combs: COMBS.iter().map(|&l| Comb::new(n(l))).collect(), allpasses: ALLPASSES.iter().map(|&l| Allpass::new(n(l))).collect() }
    }

    #[inline]
    fn run(&mut self, x: f32, feedback: f32, damp: f32) -> f32 {
        let wet: f32 = self.combs.iter_mut().map(|c| c.run(x, feedback, damp)).sum();
        self.allpasses.iter_mut().fold(wet, |s, a| a.run(s))
    }
}

/// Stereo reverb with pre-delay. `run` takes a stereo frame, gives the wet signal only.
pub struct Reverb {
    left: Side,
    right: Side,
    pre: Vec<[f32; 2]>,
    pre_i: usize,
    pre_len: usize,
    rate: f32,
}

impl Reverb {
    pub fn new(rate: f32) -> Self {
        let scale = rate / 44_100.0;
        Self { left: Side::new(scale, 0), right: Side::new(scale, SPREAD), pre: vec![[0.0; 2]; (rate * 0.25) as usize + 1], pre_i: 0, pre_len: 1, rate }
    }

    pub fn set_predelay(&mut self, ms: f32) {
        self.pre_len = ((ms.clamp(0.0, 250.0) / 1000.0 * self.rate) as usize).clamp(1, self.pre.len());
    }

    /// Wet output of one frame.
    #[inline]
    pub fn run(&mut self, l: f32, r: f32, feedback: f32, damp: f32) -> [f32; 2] {
        // Pre-delay: a ring read pre_len frames back.
        let len = self.pre.len();
        self.pre[self.pre_i] = [l, r];
        let back = self.pre[(self.pre_i + len - self.pre_len + 1) % len];
        self.pre_i = (self.pre_i + 1) % len;
        let x = (back[0] + back[1]) * INPUT;
        [self.left.run(x, feedback, damp), self.right.run(x, feedback, damp)]
    }

    pub fn reset(&mut self) {
        let rate = self.rate;
        let pre_len = self.pre_len;
        *self = Self::new(rate);
        self.pre_len = pre_len;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_click_rings_on_and_fades() {
        let mut r = Reverb::new(48_000.0);
        r.set_predelay(10.0);
        let (fb, dmp) = (feedback(0.7), damp(0.4));
        let energy = |from: usize, to: usize, r: &mut Reverb| (from..to).map(|i| {
            let x = if i == 0 { 1.0 } else { 0.0 };
            let [a, b] = r.run(x, x, fb, dmp);
            a * a + b * b
        }).sum::<f32>();
        // Silent during the pre-delay (10 ms = 480 frames), then a tail.
        let first = energy(0, 470, &mut r);
        let early = energy(470, 24_000, &mut r);
        let late = energy(24_000, 96_000, &mut r);
        let gone = energy(96_000, 400_000, &mut r);
        assert_eq!(first, 0.0);
        assert!(early > 0.0 && late > 0.0 && late < early, "{early} {late}");
        assert!(gone < late * 0.05, "{gone} {late}");
        // Bigger room, longer tail.
        let mut small = Reverb::new(48_000.0);
        let mut big = Reverb::new(48_000.0);
        let tail = |r: &mut Reverb, size: f32| (0..96_000).map(|i| {
            let x = if i == 0 { 1.0 } else { 0.0 };
            let [a, b] = r.run(x, x, feedback(size), dmp);
            if i > 48_000 { a * a + b * b } else { 0.0 }
        }).sum::<f32>();
        assert!(tail(&mut big, 1.0) > tail(&mut small, 0.2) * 4.0);
    }
}
