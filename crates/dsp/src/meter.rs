//! Loudness and levels as listeners hear them: K-weighting (ITU-R BS.1770: a high shelf around 1.5 kHz, then a high-pass
//! around 38 Hz), mean square over sliding windows, true peak. Short-term loudness (3 s) drives Adaptive Sound; momentary
//! (400 ms), fast (50 ms) and peak drive the cover animation and the meters. Until a window is full (start, seek), its
//! mean covers what was heard so far instead of rising from silence: the first seconds read right.

use crate::{Biquad, flush};

const FAST_S: f32 = 0.05;
const MOMENTARY_S: f32 = 0.4;
const SHORT_S: f32 = 3.0;

/// BS.1770-4 annex 2: the 48-tap filter that upsamples 4x for the true peak, as its 4 phases of 12 taps (tap j takes
/// the sample j back). Passband ±0.1 dB to 20 kHz at 48 kHz, -40 dB from 28 kHz. Twin: live.js `TP` (keep alike).
#[allow(clippy::excessive_precision, reason = "the standard's table, digit for digit (multiples of 2^-13, exact in f32)")]
const TRUE_PEAK: [[f32; 12]; 4] = [
    [0.0017089843750, 0.0109863281250, -0.0196533203125, 0.0332031250000, -0.0594482421875, 0.1373291015625, 0.9721679687500, -0.1022949218750, 0.0476074218750, -0.0266113281250, 0.0148925781250, -0.0083007812500],
    [-0.0291748046875, 0.0292968750000, -0.0517578125000, 0.0891113281250, -0.1665039062500, 0.4650878906250, 0.7797851562500, -0.2003173828125, 0.1015625000000, -0.0582275390625, 0.0330810546875, -0.0189208984375],
    [-0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625000000, -0.2003173828125, 0.7797851562500, 0.4650878906250, -0.1665039062500, 0.0891113281250, -0.0517578125000, 0.0292968750000, -0.0291748046875],
    [-0.0083007812500, 0.0148925781250, -0.0266113281250, 0.0476074218750, -0.1022949218750, 0.9721679687500, 0.1373291015625, -0.0594482421875, 0.0332031250000, -0.0196533203125, 0.0109863281250, 0.0017089843750],
];

/// One channel's true peak: its last 12 samples (twice over, so they read as one slice), newest first.
#[derive(Debug, Clone, Default)]
struct Oversampler {
    last: [f32; 24],
    at: usize,
}

impl Oversampler {
    /// The highest |value| among the sample and the 4 points the filter puts around it. The sample counts too (the
    /// filter's points fall between samples): a true peak is never under the sample peak, as libebur128 reads it.
    #[inline]
    fn push(&mut self, x: f32) -> f32 {
        self.at = if self.at == 0 { 11 } else { self.at - 1 };
        self.last[self.at] = x;
        self.last[self.at + 12] = x;
        let recent = &self.last[self.at..self.at + 12];
        TRUE_PEAK.iter().fold(x.abs(), |top, taps| top.max(taps.iter().zip(recent).map(|(h, v)| h * v).sum::<f32>().abs()))
    }
}

#[derive(Debug, Clone)]
pub struct Meter {
    rate: f32,
    shelf: Vec<Biquad>,
    hp: Vec<Biquad>,
    over: Vec<Oversampler>,
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
            over: vec![Oversampler::default(); channels],
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
            peak = peak.max(self.over[c].push(x));
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

    /// True peak (BS.1770-4: 4x oversampled), 1 = full scale, above it an intersample over; falls about 20 dB a second.
    pub fn peak(&self) -> f32 {
        self.peak
    }

    pub fn rate(&self) -> f32 {
        self.rate
    }

    /// After a seek: old levels would mislead the gain.
    pub fn reset(&mut self) {
        self.shelf.iter_mut().chain(self.hp.iter_mut()).for_each(Biquad::reset);
        self.over.iter_mut().for_each(|o| *o = Oversampler::default());
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
    fn the_peak_between_samples_is_read() {
        // A quarter of the rate, 45° off: every sample at 0.707 of the sine, its crests between them (BS.1770's case).
        let mut m = Meter::new(48_000.0, 2);
        for n in 0..4_800 {
            let x = 0.5 * (std::f32::consts::FRAC_PI_2 * n as f32 + std::f32::consts::FRAC_PI_4).sin();
            m.frame(&[x, x]);
        }
        assert!((m.peak() - 0.5).abs() < 0.005, "{}", m.peak());
        // An intersample over: full-scale samples, a crest above 1.
        let mut over = Meter::new(48_000.0, 2);
        for n in 0..4_800 {
            let x = (std::f32::consts::FRAC_PI_2 * n as f32 + std::f32::consts::FRAC_PI_4).sin() / std::f32::consts::FRAC_1_SQRT_2;
            over.frame(&[x, x]);
        }
        assert!(over.peak() > 1.38, "{}", over.peak());
        // A lone click: never under its sample.
        let mut click = Meter::new(48_000.0, 1);
        click.frame(&[0.8]);
        assert!(click.peak() >= 0.8);
        for _ in 0..12 {
            click.frame(&[0.0]);
        }
        click.reset();
        assert_eq!(click.peak(), 0.0);
    }

    #[test]
    fn the_oversampler_is_the_standards() {
        // Each phase passes a steady level whole (within the filter's 0.1 dB ripple), mirrored pairs alike.
        for taps in TRUE_PEAK {
            let sum: f32 = taps.iter().sum();
            assert!((sum - 1.0).abs() < 0.03, "{sum}");
        }
        for (a, b) in TRUE_PEAK[0].iter().zip(TRUE_PEAK[3].iter().rev()).chain(TRUE_PEAK[1].iter().zip(TRUE_PEAK[2].iter().rev())) {
            assert_eq!(a, b);
        }
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
