//! Visualizer v2 data: the sound as 1/6-octave bands per channel (or 1/12, a choice), at 60 Hz, plus left / right
//! levels for needles. Hann window, 4096-point FFT (8192 for 1/12 octave), `hop = rate / 60`. Visual only: nothing
//! stored, nothing sent anywhere.
//!
//! Reading: a sine of amplitude 1 reads 0 dB in its band (the band's energy, Parseval, so noise reads the same
//! whatever the window). Bands narrower than ~3 bins (below ~300 Hz either way: 1/6 octave at 4096 points, 1/12 at
//! 8192) widen to 3 bins around their center, which reads a sine right but spreads it over the neighbours: the FFT
//! cannot split a 2.4 Hz band (shortcut: a longer window for the lows, if bass detail ever matters). Its twin:
//! `crates/shield/src/live.js` (`viz:begin`), Chromium's analyser with a Blackman window, same band mapping and
//! calibration; `fixtures/viz.json` is the shared test signal.

use crate::tap::Listener;
use realfft::num_complex::Complex;
use realfft::{RealFftPlanner, RealToComplex};
use std::sync::Arc;

pub const BANDS: usize = 61;
/// Bands at 1/12 octave.
pub const FINE_BANDS: usize = 121;
pub const FFT: usize = 4096;
/// The 1/12-octave window: twice as long, so its bands resolve from ~300 Hz as the 1/6 ones do.
pub const FINE_FFT: usize = 8192;
pub const FPS: u32 = 60;
/// Narrowest a band reads, FFT bins (3 bins hold 98 % of a Hann sine, 97 % of a Blackman one).
const MIN_WIDTH: f64 = 3.0;
/// Frame layout: version, band count, flags, reserved, rms L, rms R, peak L, peak R, bands L, bands R, then the wave
/// blocks if flagged. Every dB value is one byte, (dB + 120) · 2: 0.5 dB steps from -120 up to +7.5.
pub const FORMAT: u8 = 1;
pub const HEADER: usize = 8;
pub const FRAME_BYTES: usize = HEADER + 2 * BANDS;
/// Flags byte: the frame ends with wave blocks.
const HAS_WAVE: u8 = 1;
/// Samples per side in a wave block (the scopes, asked only while one is drawn): the last 1024 frames, every two
/// averaged (21 ms at 48 kHz), as i16 little-endian (32767 = full scale). 2 KB a frame.
pub const WAVE: usize = 512;
/// Ticks without news before a silent frame is sent (~100 ms).
const STILL_TICKS: u32 = 6;

/// The bands a frame carries: 1/6 octave (61, the default) or 1/12 (121, Settings › Playback › Visualizer bands). Both
/// base 10 (ANSI / IEC): 19.95 Hz to 19.95 kHz, a center at 1 kHz, 20 or 40 bands a decade.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Bands {
    #[default]
    Sixth,
    Twelfth,
}

impl Bands {
    pub const fn count(self) -> usize {
        match self {
            Self::Sixth => BANDS,
            Self::Twelfth => FINE_BANDS,
        }
    }

    /// FFT size that reads them.
    pub const fn fft(self) -> usize {
        match self {
            Self::Sixth => FFT,
            Self::Twelfth => FINE_FFT,
        }
    }

    fn per_decade(self) -> f64 {
        ((self.count() - 1) / 3) as f64
    }

    /// Band `i`'s center, Hz: band 34 (68) is 1 kHz.
    pub fn centre(self, i: usize) -> f64 {
        let kilo = (self.count() - 1) * 17 / 30;
        1000.0 * 10f64.powf((i as f64 - kilo as f64) / self.per_decade())
    }

    /// A band's upper edge over its center: half a step.
    fn edge(self) -> f64 {
        10f64.powf(0.5 / self.per_decade())
    }
}

/// 1/6-octave band center, Hz.
pub fn centre(i: usize) -> f64 {
    Bands::Sixth.centre(i)
}

pub fn db(energy: f64) -> f32 {
    if energy < 1e-12 { -120.0 } else { (10.0 * energy.log10()) as f32 }
}

pub fn quantize(db: f32) -> u8 {
    ((db + 120.0) * 2.0).round().clamp(0.0, 255.0) as u8
}

pub fn dequantize(q: u8) -> f32 {
    q as f32 / 2.0 - 120.0
}

/// Which bins make which band, and how much of each bin counts (a bin owns [k - 0.5, k + 0.5] bins of frequency).
#[derive(Debug, Clone)]
pub struct BandMap {
    /// Per band: first bin, start in `shares`.
    spans: Vec<(usize, usize)>,
    shares: Vec<f64>,
}

impl BandMap {
    pub fn new(rate: f64, n: usize, bands: Bands) -> Self {
        let (df, half) = (rate / n as f64, (n / 2) as f64);
        let edge = bands.edge();
        let (mut spans, mut shares) = (Vec::with_capacity(bands.count()), Vec::new());
        for i in 0..bands.count() {
            let c = bands.centre(i) / df;
            let (mut lo, mut hi) = (c / edge, c * edge);
            if hi - lo < MIN_WIDTH {
                (lo, hi) = (c - MIN_WIDTH / 2.0, c + MIN_WIDTH / 2.0);
            }
            // Above Nyquist: nothing there. DC and Nyquist bins are in only as far as the band reaches them.
            let (lo, hi) = (lo.max(-0.5), hi.min(half + 0.5));
            let start = shares.len();
            if c > half || lo >= hi {
                spans.push((0, start));
                continue;
            }
            let first = (lo + 0.5).floor().max(0.0) as usize;
            let mut k = first;
            while (k as f64) - 0.5 < hi {
                shares.push(((hi.min(k as f64 + 0.5)) - lo.max(k as f64 - 0.5)).max(0.0));
                k += 1;
            }
            spans.push((first, start));
        }
        Self { spans, shares }
    }

    /// Band `i`'s bins: first bin and shares.
    pub fn band(&self, i: usize) -> (usize, &[f64]) {
        let end = self.spans.get(i + 1).map_or(self.shares.len(), |s| s.1);
        (self.spans[i].0, &self.shares[self.spans[i].1..end])
    }

    /// Σ share · power over each band.
    pub fn sum(&self, power: &[f32]) -> Vec<f64> {
        (0..self.spans.len())
            .map(|i| {
                let (first, shares) = self.band(i);
                shares.iter().enumerate().map(|(j, s)| s * power.get(first + j).copied().unwrap_or(0.0) as f64).sum()
            })
            .collect()
    }
}

/// One moment of the music: levels in dB (0 = full scale; a full-scale sine's rms reads -3), bands in dB (61 or 121
/// per side), the wave blocks when asked (`WAVE` samples per side, -1 to 1).
#[derive(Debug, Clone, PartialEq)]
pub struct Frame {
    pub rms: [f32; 2],
    pub peak: [f32; 2],
    pub bands: [Vec<f32>; 2],
    pub wave: Option<[Vec<f32>; 2]>,
}

/// The last `2 · WAVE` samples, every two averaged: a side's wave block (silence before a shorter input).
pub fn wave_of(x: &[f32]) -> Vec<f32> {
    let mut out = vec![0.0; WAVE.saturating_sub(x.len() / 2)];
    out.extend(x[x.len().saturating_sub(2 * WAVE)..].as_chunks::<2>().0.iter().map(|[a, b]| (a + b) / 2.0));
    out
}

fn sample16(s: f32) -> i16 {
    (s.clamp(-1.0, 1.0) * 32767.0).round() as i16
}

impl Frame {
    pub fn silent() -> Self {
        Self::quiet(Bands::Sixth)
    }

    /// Nothing sounds, in these bands.
    pub fn quiet(bands: Bands) -> Self {
        Self { rms: [-120.0; 2], peak: [-120.0; 2], bands: [vec![-120.0; bands.count()], vec![-120.0; bands.count()]], wave: None }
    }

    pub fn pack(&self) -> Vec<u8> {
        let n = self.bands[0].len();
        let mut out = Vec::with_capacity(HEADER + 2 * n + if self.wave.is_some() { 4 * WAVE } else { 0 });
        out.extend([FORMAT, n as u8, if self.wave.is_some() { HAS_WAVE } else { 0 }, 0]);
        out.extend(self.rms.iter().chain(&self.peak).map(|&v| quantize(v)));
        out.extend(self.bands.iter().flatten().map(|&v| quantize(v)));
        if let Some(w) = &self.wave {
            out.extend(w.iter().flat_map(|side| (0..WAVE).map(|i| side.get(i).copied().unwrap_or(0.0))).flat_map(|s| sample16(s).to_le_bytes()));
        }
        out
    }

    /// Back from bytes (tests, and the contract the front end's `vizFrames.ts` unpacks): `None` if not a frame.
    pub fn unpack(b: &[u8]) -> Option<Self> {
        let n = *b.get(1)? as usize;
        let waves = b.get(2)? & HAS_WAVE != 0;
        if b[0] != FORMAT || (n != BANDS && n != FINE_BANDS) || b.len() != HEADER + 2 * n + if waves { 4 * WAVE } else { 0 } {
            return None;
        }
        let d = |i: usize| dequantize(b[i]);
        let side = |c: usize| (0..n).map(|i| d(HEADER + c * n + i)).collect();
        let at = HEADER + 2 * n;
        let wave = |c: usize| (0..WAVE).map(|i| i16::from_le_bytes([b[at + 2 * (c * WAVE + i)], b[at + 2 * (c * WAVE + i) + 1]]) as f32 / 32767.0).collect();
        Some(Self { rms: [d(4), d(5)], peak: [d(6), d(7)], bands: [side(0), side(1)], wave: waves.then(|| [wave(0), wave(1)]) })
    }
}

/// Windowed FFT → bands. Allocates its buffers once.
pub struct Analyzer {
    bands: Bands,
    fft: Arc<dyn RealToComplex<f32>>,
    window: Vec<f32>,
    /// 4 / (N · Σ window²): a sine of amplitude A through the FFT gives A² in a band that holds it.
    norm: f64,
    map: BandMap,
    rate: u32,
    time: Vec<f32>,
    spec: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
    power: Vec<f32>,
}

impl Analyzer {
    pub fn new() -> Self {
        Self::with(Bands::Sixth)
    }

    pub fn with(bands: Bands) -> Self {
        let n = bands.fft();
        let fft = RealFftPlanner::<f32>::new().plan_fft_forward(n);
        // Periodic Hann: the window's sum is exactly N / 2.
        let window: Vec<f32> = (0..n).map(|i| (0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / n as f64).cos()) as f32).collect();
        let energy: f64 = window.iter().map(|&w| (w as f64) * (w as f64)).sum();
        Self { bands, time: fft.make_input_vec(), spec: fft.make_output_vec(), scratch: fft.make_scratch_vec(), power: vec![0.0; n / 2 + 1], fft, window, norm: 4.0 / (n as f64 * energy), map: BandMap::new(48_000.0, n, bands), rate: 48_000 }
    }

    fn read(&mut self, x: &[f32]) -> Vec<f32> {
        for ((t, &s), &w) in self.time.iter_mut().zip(x).zip(&self.window) {
            *t = s * w;
        }
        // Lengths are fixed at construction: cannot fail.
        let _ = self.fft.process_with_scratch(&mut self.time, &mut self.spec, &mut self.scratch);
        for (p, c) in self.power.iter_mut().zip(&self.spec) {
            *p = c.norm_sqr();
        }
        self.map.sum(&self.power).into_iter().map(|e| db(e * self.norm)).collect()
    }

    /// `left` / `right`: the last `bands.fft()` frames. Rms: the last `FFT` of them (the needles read alike at either
    /// banding). Peak: the last `hop` frames only (the time since the last frame).
    pub fn analyze(&mut self, left: &[f32], right: &[f32], rate: u32, hop: usize) -> Frame {
        if rate != self.rate && rate > 0 {
            self.rate = rate;
            self.map = BandMap::new(rate as f64, self.bands.fft(), self.bands);
        }
        let level = |x: &[f32]| {
            let w = &x[x.len().saturating_sub(FFT)..];
            let rms = (w.iter().map(|&s| (s as f64) * (s as f64)).sum::<f64>() / w.len().max(1) as f64).sqrt();
            let peak = x[x.len().saturating_sub(hop.max(1))..].iter().fold(0f32, |m, s| m.max(s.abs()));
            (db(rms * rms), db((peak as f64) * (peak as f64)))
        };
        let ((rl, pl), (rr, pr)) = (level(left), level(right));
        Frame { rms: [rl, rr], peak: [pl, pr], bands: [self.read(left), self.read(right)], wave: None }
    }
}

impl Default for Analyzer {
    fn default() -> Self {
        Self::new()
    }
}

/// What the worker does every tick (~60 Hz) while someone subscribes: a frame when there is news, one silent frame when
/// the sound stopped (pause, silence), then nothing until it comes back.
pub struct Pump {
    listener: Listener,
    analyzer: Analyzer,
    left: Vec<f32>,
    right: Vec<f32>,
    seen: u64,
    still: u32,
    /// The silent frame went out, nothing since.
    idle: bool,
    /// The silent frame, in these bands.
    silent: Vec<u8>,
    /// Frames carry the wave blocks (a scope is drawn).
    waves: bool,
}

impl Pump {
    pub fn new(listener: Listener) -> Self {
        Self::with(listener, Bands::Sixth)
    }

    pub fn with(listener: Listener, bands: Bands) -> Self {
        let n = bands.fft();
        Self { seen: listener.head(), listener, analyzer: Analyzer::with(bands), left: vec![0.0; n], right: vec![0.0; n], still: 0, idle: false, silent: Frame::quiet(bands).pack(), waves: false }
    }

    /// Frames with the wave blocks (`WAVE` samples a side) or without. The silent frame never has them.
    pub fn waves(mut self, on: bool) -> Self {
        self.waves = on;
        self
    }

    /// The silent frame went out and nothing plays: the caller may look less often.
    pub fn idle(&self) -> bool {
        self.idle
    }

    /// The packed frame to push now, if any.
    pub fn step(&mut self) -> Option<Vec<u8>> {
        let head = self.listener.head();
        if head == self.seen {
            self.still += 1;
            return (self.still == STILL_TICKS && !std::mem::replace(&mut self.idle, true)).then(|| self.silent.clone());
        }
        self.seen = head;
        self.still = 0;
        self.listener.latest(&mut self.left, &mut self.right);
        let sound = self.left.iter().chain(&self.right).any(|&s| s != 0.0);
        if !sound {
            return (!std::mem::replace(&mut self.idle, true)).then(|| self.silent.clone());
        }
        self.idle = false;
        let rate = self.listener.rate();
        let mut frame = self.analyzer.analyze(&self.left, &self.right, rate, (rate / FPS) as usize);
        if self.waves {
            frame.wave = Some([wave_of(&self.left), wave_of(&self.right)]);
        }
        Some(frame.pack())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tap::Tap;
    use serde::{Deserialize, Serialize};
    use std::f64::consts::PI;

    fn sine(hz: f64, amp: f64, rate: u32, n: usize) -> Vec<f32> {
        (0..n).map(|i| (amp * (2.0 * PI * hz * i as f64 / rate as f64).sin()) as f32).collect()
    }

    #[test]
    fn bands_are_a_sixth_of_an_octave_from_20_hz_to_20_khz() {
        assert_eq!(BANDS, 61);
        assert!((centre(0) - 19.95).abs() < 0.01 && (centre(34) - 1000.0).abs() < 1e-9 && (centre(BANDS - 1) - 19_952.6).abs() < 0.1);
        // Six steps double the frequency (base 10: ×1.995).
        assert!((centre(40) / centre(34) - 1.9953).abs() < 1e-3);
    }

    #[test]
    fn twelfths_are_half_a_sixth_from_20_hz_to_20_khz() {
        let fine = Bands::Twelfth;
        assert_eq!((fine.count(), fine.fft()), (121, 8192));
        assert!((fine.centre(0) - 19.95).abs() < 0.01 && fine.centre(68) == 1000.0 && (fine.centre(120) - 19_952.6).abs() < 0.1);
        // Every other twelfth is a sixth; twelve steps double the frequency.
        assert!((0..BANDS).all(|i| (fine.centre(2 * i) / centre(i) - 1.0).abs() < 1e-12));
        assert!((fine.centre(80) / fine.centre(68) - 1.9953).abs() < 1e-3);
    }

    #[test]
    fn the_band_map_is_pure_arithmetic() {
        let map = BandMap::new(48_000.0, FFT, Bands::Sixth);
        let df = 48_000.0 / FFT as f64;
        // Wide band (1 kHz): its shares add up to its width in bins, first bin right.
        let (first, shares) = map.band(34);
        let width = centre(34) * (10f64.powf(0.025) - 10f64.powf(-0.025)) / df;
        assert!((shares.iter().sum::<f64>() - width).abs() < 1e-9, "{shares:?}");
        assert!((first as f64 - 0.5) <= centre(34) / 10f64.powf(0.025) / df);
        // Narrow band (20 Hz, 2.4 Hz wide, under one bin): widened to 3 bins.
        assert!((map.band(0).1.iter().sum::<f64>() - 3.0).abs() < 1e-9, "{:?}", map.band(0));
        // Above Nyquist: empty (22.05 kHz rate: the top bands are gone, the 10 kHz band stays).
        let low = BandMap::new(22_050.0, FFT, Bands::Sixth);
        assert!(low.band(BANDS - 1).1.is_empty() && !low.band(50).1.is_empty());
        // Power in a bin counts by its share.
        let mut power = vec![0.0f32; FFT / 2 + 1];
        power[first + 1] = 2.0;
        assert!((map.sum(&power)[34] - 2.0 * shares[1]).abs() < 1e-9);
    }

    /// Bands of a stereo signal: `left` / `right` at `rate`, the way the worker reads them.
    fn read(left: &[f32], right: &[f32], rate: u32) -> Frame {
        Analyzer::new().analyze(left, right, rate, (rate / FPS) as usize)
    }

    #[test]
    fn a_sine_at_a_bands_center_lights_that_band_within_half_a_db() {
        for (bands, width) in [(Bands::Sixth, 0.122), (Bands::Twelfth, 0.061)] {
            let (n, count) = (bands.fft(), bands.count());
            for rate in [44_100, 48_000, 96_000] {
                let mut a = Analyzer::with(bands);
                for i in 0..count {
                    let s = sine(bands.centre(i), 1.0, rate, n);
                    let f = a.analyze(&s, &s, rate, (rate / FPS) as usize);
                    let tol = if rate > 48_000 { 1.5 } else { 0.5 };
                    assert!(f.bands[0][i].abs() < tol, "{bands:?} {rate} Hz, band {i} ({:.1} Hz) reads {}", bands.centre(i), f.bands[0][i]);
                    assert_eq!(f.bands[0], f.bands[1]);
                    // Neighbours 15 dB under where the bands are wider than the window can see (3.3 bins: 320 Hz and
                    // up at 48 kHz either way; at 355 Hz they read -22 dB). Below, bands overlap by design: the lit
                    // one is no more than 1 dB under its neighbours (at 200 Hz they read -6 dB, at 25 Hz about 0).
                    let df = rate as f64 / n as f64;
                    for j in [i.wrapping_sub(1), i + 1].into_iter().filter(|&j| j < count && bands.centre(j) < rate as f64 * 0.45) {
                        if bands.centre(i) * width / df >= 3.3 {
                            assert!(f.bands[0][j] < -15.0, "{bands:?} {rate} Hz, band {i} lights {j}: {}", f.bands[0][j]);
                        } else {
                            assert!(f.bands[0][j] <= f.bands[0][i] + 1.0, "{bands:?} {rate} Hz, band {i} vs {j}");
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn twelfths_split_what_a_sixth_holds() {
        // Two sines a twelfth apart at 2 kHz, 20 dB between them: the twelfths read each its own level, the 2 kHz sixth
        // (whose upper edge the quiet one sits on) reads the loud one.
        let (lo, hi) = (Bands::Twelfth.centre(80), Bands::Twelfth.centre(81));
        let mix = |n: usize| -> Vec<f32> { sine(lo, 0.5, 48_000, n).iter().zip(sine(hi, 0.05, 48_000, n)).map(|(a, b)| a + b).collect() };
        let fine = Analyzer::with(Bands::Twelfth).analyze(&mix(FINE_FFT), &mix(FINE_FFT), 48_000, 800);
        assert!((fine.bands[0][80] + 6.0).abs() < 0.5 && (fine.bands[0][81] + 26.0).abs() < 1.0, "{:?}", &fine.bands[0][78..84]);
        let coarse = read(&mix(FFT), &mix(FFT), 48_000);
        assert!((coarse.bands[0][40] + 6.0).abs() < 0.5, "{}", coarse.bands[0][40]);
        // The needles' level reads the same window either way.
        assert!((fine.rms[0] - coarse.rms[0]).abs() < 0.1);
    }

    #[test]
    fn a_left_only_sine_shows_only_on_the_left() {
        let s = sine(1000.0, 0.5, 48_000, FFT);
        let f = read(&s, &vec![0.0; FFT], 48_000);
        assert!((f.bands[0][34] + 6.0).abs() < 0.5, "{}", f.bands[0][34]);
        assert!(f.bands[1].iter().all(|&v| v == -120.0), "{:?}", f.bands[1]);
        assert!((f.rms[0] + 9.0).abs() < 0.1 && f.rms[1] == -120.0);
        assert!((f.peak[0] + 6.0).abs() < 0.1 && f.peak[1] == -120.0);
    }

    #[test]
    fn a_comb_of_sines_reads_each_bands_own_level() {
        // One sine in each band from 1 kHz up, loud and 20 dB quieter in turn: levels stay apart (the lobes of
        // sines 10 bins apart do not meet).
        let mut x = vec![0f32; FFT];
        for i in 34..BANDS {
            let amp = if i % 2 == 0 { 0.5 } else { 0.05 };
            for (n, v) in x.iter_mut().enumerate() {
                *v += (amp * (2.0 * PI * centre(i) * n as f64 / 48_000.0).sin()) as f32;
            }
        }
        let f = read(&x, &x, 48_000);
        for i in 34..BANDS {
            let want = if i % 2 == 0 { -6.02 } else { -26.02 };
            assert!((f.bands[0][i] - want).abs() < 0.5, "band {i}: {} vs {want}", f.bands[0][i]);
        }
    }

    #[test]
    fn peak_is_the_last_hop_and_rms_the_window() {
        let mut x = vec![0.1f32; FFT];
        x[FFT - 5] = 0.9;
        let f = read(&x, &x, 48_000);
        assert!((f.peak[0] - 20.0 * 0.9f32.log10()).abs() < 0.01);
        x[FFT - 5] = 0.1;
        x[10] = 0.9;
        let f = read(&x, &x, 48_000);
        assert!((f.peak[0] - 20.0 * 0.1f32.log10()).abs() < 0.01, "an old peak is not this frame's");
    }

    #[test]
    fn frames_pack_to_half_decibel_bytes() {
        assert_eq!(Frame::silent().pack().len(), FRAME_BYTES);
        assert_eq!(Frame::silent().pack()[HEADER..].iter().max(), Some(&0));
        let mut f = Frame::silent();
        f.rms = [-3.0, -120.0];
        f.peak = [0.0, 20.0];
        f.bands[1][60] = -0.26;
        let b = f.pack();
        assert_eq!((b[0], b[1], b[4], b[5], b[6], b[7]), (1, 61, 234, 0, 240, 255));
        let back = Frame::unpack(&b).unwrap();
        assert_eq!((back.rms, back.peak), ([-3.0, -120.0], [0.0, 7.5]));
        assert_eq!(back.bands[1][60], -0.5);
        assert!(Frame::unpack(&b[1..]).is_none() && Frame::unpack(&[0; FRAME_BYTES]).is_none());
        // Twelfths: 121 bands a side, the count in the header.
        let fine = Frame::quiet(Bands::Twelfth).pack();
        assert_eq!((fine.len(), fine[1]), (HEADER + 2 * FINE_BANDS, 121));
        assert_eq!(Frame::unpack(&fine).unwrap().bands[1].len(), FINE_BANDS);
        assert!(Frame::unpack(&fine[..FRAME_BYTES]).is_none());
    }

    #[test]
    fn a_pump_in_twelfths_sends_twelfths() {
        let tap = Arc::new(Tap::default());
        let mut pump = Pump::with(tap.listen(), Bands::Twelfth);
        let first: Vec<_> = (0..20).filter_map(|_| pump.step()).collect();
        assert_eq!(first, vec![Frame::quiet(Bands::Twelfth).pack()]);
        let block: Vec<f32> = sine(1000.0, 0.5, 48_000, FINE_FFT).iter().flat_map(|&x| [x, x]).collect();
        tap.push(&block, 2, 48_000);
        let f = Frame::unpack(&pump.step().unwrap()).unwrap();
        assert!((f.bands[0][68] + 6.0).abs() < 0.6, "{}", f.bands[0][68]);
        assert!(f.wave.is_none());
    }

    #[test]
    fn wave_blocks_come_when_asked_left_and_right_apart() {
        let tap = Arc::new(Tap::default());
        let mut pump = Pump::with(tap.listen(), Bands::Sixth).waves(true);
        // A left-only 1 kHz sine at 0.5: its last 1024 samples, every two averaged, on the left; the right silent.
        let left = sine(1000.0, 0.5, 48_000, FFT);
        let block: Vec<f32> = left.iter().flat_map(|&x| [x, 0.0]).collect();
        tap.push(&block, 2, 48_000);
        let b = pump.step().unwrap();
        assert_eq!((b.len(), b[2]), (FRAME_BYTES + 4 * WAVE, 1));
        let w = Frame::unpack(&b).unwrap().wave.unwrap();
        assert_eq!((w[0].len(), w[1].len()), (WAVE, WAVE));
        let want = wave_of(&left);
        assert!(w[0].iter().zip(&want).all(|(a, b)| (a - b).abs() < 1e-4));
        assert!(w[0].iter().fold(0f32, |m, v| m.max(v.abs())) > 0.45 && w[1].iter().all(|&v| v == 0.0));
        // The silent frame carries none; a frame cut short is no frame.
        assert!(Frame::unpack(&b[..b.len() - 2]).is_none());
        assert_eq!(wave_of(&[0.5; 10]).len(), WAVE);
        assert_eq!(wave_of(&[0.25, 0.75, 1.0, 1.0])[WAVE - 2..], [0.5, 1.0]);
    }

    #[test]
    fn the_pump_pushes_while_sound_moves_and_stops_when_it_does_not() {
        let tap = Arc::new(Tap::default());
        let mut pump = Pump::new(tap.listen());
        // Nothing playing: one silent frame after a moment, then nothing.
        let first: Vec<_> = (0..20).filter_map(|_| pump.step()).collect();
        assert_eq!(first, vec![Frame::silent().pack()]);
        // Sound: a frame per tick that has news, none without.
        let s = sine(1000.0, 0.5, 44_100, 735);
        let block: Vec<f32> = s.iter().flat_map(|&x| [x, 0.0]).collect();
        tap.push(&block, 2, 44_100);
        let f = Frame::unpack(&pump.step().unwrap()).unwrap();
        assert!(f.peak[0] > -7.0 && f.peak[1] == -120.0, "{f:?}");
        assert!(pump.step().is_none());
        // Stops: silent frame once, then quiet.
        let after: Vec<_> = (0..20).filter_map(|_| pump.step()).collect();
        assert_eq!(after, vec![Frame::silent().pack()]);
        // Digital silence still being written: also one silent frame, none after, until sound returns.
        for _ in 0..8 {
            tap.push(&vec![0.0; 2 * 735], 2, 44_100);
            let _ = pump.step();
        }
        tap.push(&vec![0.0; 2 * 735], 2, 44_100);
        assert!(pump.step().is_none());
        tap.push(&block, 2, 44_100);
        assert!(pump.step().is_some());
    }

    #[test]
    fn nobody_subscribed_means_nothing_is_copied() {
        let tap = Arc::new(Tap::default());
        tap.push(&[0.5; 1024], 2, 48_000);
        let l = tap.listen();
        assert_eq!(l.head(), 0);
    }

    // ---- The shared fixture: the same signals go through live.js (viz.test.ts) ----

    #[derive(Serialize, Deserialize)]
    struct Component {
        hz: f64,
        amp: f64,
        phase: f64,
        left: bool,
        right: bool,
    }
    #[derive(Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Signal {
        name: String,
        components: Vec<Component>,
        left: Vec<f64>,
        right: Vec<f64>,
        /// The same signal over `FINE_FFT` samples, in twelfths.
        fine_left: Vec<f64>,
        fine_right: Vec<f64>,
    }
    #[derive(Serialize, Deserialize)]
    struct Fixture {
        /// Samples per signal: one FFT window.
        rate: u32,
        signals: Vec<Signal>,
    }

    fn fixture_signals() -> Vec<(String, Vec<Component>)> {
        let c = |hz, amp, phase, left, right| Component { hz, amp, phase, left, right };
        let mut many = Vec::new();
        for k in 0..120 {
            // Pink-ish: amplitude falls with the root of the frequency, phases scattered.
            let hz = 60.0 * 1.0412f64.powi(k);
            many.push(c(hz, 0.05 * (1000.0 / hz).sqrt().min(1.5), (k as f64 * 2.399963).rem_euclid(std::f64::consts::TAU), true, true));
        }
        vec![
            ("sine 1 kHz, left only".into(), vec![c(1000.0, 0.5, 0.0, true, false)]),
            ("sines 125 Hz and 4 kHz, both".into(), vec![c(125.0, 0.4, 0.3, true, true), c(4000.0, 0.2, 1.0, true, true)]),
            ("sines 440 Hz left, 3 kHz right".into(), vec![c(440.0, 0.6, 0.0, true, false), c(3000.0, 0.3, 0.5, false, true)]),
            ("pink-ish, 120 sines".into(), many),
        ]
    }

    fn render(components: &[Component], rate: u32, n: usize) -> (Vec<f64>, Vec<f64>) {
        let (mut l, mut r) = (vec![0.0; n], vec![0.0; n]);
        for c in components {
            for i in 0..n {
                let v = c.amp * (2.0 * PI * c.hz * i as f64 / rate as f64 + c.phase).sin();
                if c.left {
                    l[i] += v;
                }
                if c.right {
                    r[i] += v;
                }
            }
        }
        (l, r)
    }

    /// `UPDATE_VIZ_FIXTURE=1 cargo test -p music-dsp viz_fixture` rewrites `fixtures/viz.json`. The file holds the
    /// signals and what this twin reads from them (rounded to 0.01 dB); live.js must agree within its tolerance.
    #[test]
    fn viz_fixture_holds_what_this_twin_reads() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/viz.json");
        let rate = 48_000;
        let mut out = Fixture { rate, signals: Vec::new() };
        let mut read_back = Vec::new();
        let round = |b: &[f32]| b.iter().map(|&v| (v as f64 * 100.0).round() / 100.0).collect::<Vec<_>>();
        let f32s = |x: &[f64]| x.iter().map(|&v| v as f32).collect::<Vec<_>>();
        for (name, components) in fixture_signals() {
            let (l, r) = render(&components, rate, FFT);
            let f = Analyzer::new().analyze(&f32s(&l), &f32s(&r), rate, 800);
            let (l, r) = render(&components, rate, FINE_FFT);
            let fine = Analyzer::with(Bands::Twelfth).analyze(&f32s(&l), &f32s(&r), rate, 800);
            let s = Signal { name, components, left: round(&f.bands[0]), right: round(&f.bands[1]), fine_left: round(&fine.bands[0]), fine_right: round(&fine.bands[1]) };
            read_back.push([s.left.clone(), s.right.clone(), s.fine_left.clone(), s.fine_right.clone()]);
            out.signals.push(s);
        }
        if std::env::var_os("UPDATE_VIZ_FIXTURE").is_some() {
            std::fs::create_dir_all(concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures")).unwrap();
            std::fs::write(path, serde_json::to_string_pretty(&out).unwrap() + "\n").unwrap();
        }
        let saved: Fixture = serde_json::from_str(&std::fs::read_to_string(path).expect("run once with UPDATE_VIZ_FIXTURE=1")).unwrap();
        assert_eq!(saved.rate, rate);
        for (s, got) in saved.signals.iter().zip(&read_back) {
            for (want, got) in [&s.left, &s.right, &s.fine_left, &s.fine_right].into_iter().zip(got) {
                assert_eq!(want.len(), got.len(), "{}", s.name);
                for (want, got) in want.iter().zip(got) {
                    assert!((want - got).abs() < 0.02, "{}: {want} vs {got}", s.name);
                }
            }
        }
        assert_eq!(saved.signals.len(), read_back.len());
    }
}
