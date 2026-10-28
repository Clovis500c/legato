//! Loudness and levels as listeners hear them: K-weighting (ITU-R BS.1770: a high shelf around 1.5 kHz, then a high-pass
//! around 38 Hz), mean square over sliding windows, peak. Short-term loudness (3 s) drives Adaptive Sound; momentary
//! (400 ms), fast (50 ms) and peak drive the cover animation and the meters. Until a window is full (start, seek), its
//! mean covers what was heard so far instead of rising from silence: the first seconds read right.

use crate::{Biquad, flush};

const FAST_S: f32 = 0.05;
const MOMENTARY_S: f32 = 0.4;
const SHORT_S: f32 = 3.0;

#[derive(Debug, Clone)]
pub struct Meter {
    rate: f32,
    shelf: Vec<Biquad>,
    hp: Vec<Biquad>,
    /// Running mean squares (exponential, time constants of the windows).
    fast: f32,
    momentary: f32,
    short: f32,
    peak: f32,
    a_fast: f32,
    a_mom: f32,
    a_short: f32,
    /// Peak fall per sample (about 20 dB a second).
    fall: f32,
    /// Frames since the start (or the last reset).
    n: u32,
}

/// Mean square → LUFS (BS.1770: -0.691 + 10 log10).
fn lufs(ms: f32) -> f32 {
    if ms <= 1e-12 { -120.0 } else { -0.691 + 10.0 * ms.log10() }
}

impl Meter {
    pub fn new(rate: f32, channels: usize) -> Self {
        Self {
            rate,
            shelf: (0..channels).map(|_| Biquad::highshelf(rate, 1_681.0, 4.0)).collect(),
            hp: (0..channels).map(|_| Biquad::highpass(rate, 38.1, 0.5)).collect(),
            fast: 0.0,
            momentary: 0.0,
            short: 0.0,
            peak: 0.0,
            a_fast: 1.0 - (-1.0 / (FAST_S * rate)).exp(),
            a_mom: 1.0 - (-1.0 / (MOMENTARY_S * rate)).exp(),
            a_short: 1.0 - (-1.0 / (SHORT_S * rate)).exp(),
            fall: 10f32.powf(-20.0 / 20.0 / rate),
            n: 0,
        }
    }

    /// One interleaved frame (all channels).
    #[inline]
    pub fn frame(&mut self, frame: &[f32]) {
        let mut sum = 0.0;
        let mut peak: f32 = 0.0;
        for (c, &x) in frame.iter().enumerate() {
            let k = self.hp[c].run(self.shelf[c].run(x));
            sum += k * k;
            peak = peak.max(x.abs());
        }
        // Channel weights are 1 for left / right (BS.1770). Plain average of all so far until a window is full.
        self.n = self.n.saturating_add(1);
        let so_far = 1.0 / self.n as f32;
        self.fast = flush(self.fast + (sum - self.fast) * self.a_fast.max(so_far));
        self.momentary = flush(self.momentary + (sum - self.momentary) * self.a_mom.max(so_far));
        self.short = flush(self.short + (sum - self.short) * self.a_short.max(so_far));
        self.peak = flush(self.peak * self.fall).max(peak);
    }

    pub fn fast_lufs(&self) -> f32 {
        lufs(self.fast)
    }

    /// Seconds heard since the start or the last reset.
    pub fn heard_s(&self) -> f32 {
        self.n as f32 / self.rate
    }

    pub fn momentary_lufs(&self) -> f32 {
        lufs(self.momentary)
    }

    pub fn short_lufs(&self) -> f32 {
        lufs(self.short)
    }

    pub fn peak(&self) -> f32 {
        self.peak
    }

    pub fn rate(&self) -> f32 {
        self.rate
    }

    /// After a seek: old levels would mislead the gain.
    pub fn reset(&mut self) {
        self.shelf.iter_mut().chain(self.hp.iter_mut()).for_each(Biquad::reset);
        self.fast = 0.0;
        self.momentary = 0.0;
        self.short = 0.0;
        self.peak = 0.0;
        self.n = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(meter: &mut Meter, freq: f32, amp: f32, secs: f32) {
        let r = meter.rate();
        for i in 0..(secs * r) as usize {
            let x = amp * (2.0 * std::f32::consts::PI * freq * i as f32 / r).sin();
            meter.frame(&[x, x]);
        }
    }

    #[test]
    fn a_full_scale_1k_sine_reads_about_zero_lufs_per_channel_pair() {
        // BS.1770: a 0 dBFS 1 kHz sine on both channels ≈ 0 LUFS. Cookbook shelf instead of the standard's exact
        // coefficients: within a dB, plenty for loudness matching.
        let mut m = Meter::new(48_000.0, 2);
        sine(&mut m, 1_000.0, 1.0, 6.0);
        assert!((m.short_lufs() - 0.0).abs() < 1.0, "{}", m.short_lufs());
        assert!((m.peak() - 1.0).abs() < 0.01);
        // 20 dB quieter reads 20 dB lower.
        let mut q = Meter::new(48_000.0, 2);
        sine(&mut q, 1_000.0, 0.1, 6.0);
        assert!((m.short_lufs() - q.short_lufs() - 20.0).abs() < 0.2);
    }

    #[test]
    fn reads_right_from_the_first_second() {
        let mut m = Meter::new(48_000.0, 2);
        sine(&mut m, 1_000.0, 0.1, 0.5);
        // Same as after 6 s (about -20): no climb from silence.
        assert!((m.short_lufs() + 20.0).abs() < 1.0, "{}", m.short_lufs());
        assert!((m.fast_lufs() + 20.0).abs() < 1.0, "{}", m.fast_lufs());
    }

    #[test]
    fn deep_bass_counts_less_and_silence_reads_floor() {
        let mut low = Meter::new(48_000.0, 2);
        sine(&mut low, 30.0, 1.0, 6.0);
        let mut mid = Meter::new(48_000.0, 2);
        sine(&mut mid, 1_000.0, 1.0, 6.0);
        assert!(low.short_lufs() < mid.short_lufs() - 2.0);
        let silent = Meter::new(48_000.0, 2);
        assert_eq!(silent.short_lufs(), -120.0);
    }
}
