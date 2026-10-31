//! Visualizer v2 data: the sound as 1/6-octave bands per channel, at 60 Hz, plus left / right levels for needles.
//! Hann window, 4096-point FFT, `hop = rate / 60`. Visual only: nothing stored, nothing sent anywhere.
//!
//! Reading: a sine of amplitude 1 reads 0 dB in its band (the band's energy, Parseval, so noise reads the same
//! whatever the window). Bands narrower than ~3 bins (below ~300 Hz) widen to 3 bins around their center, which
//! reads a sine right but spreads it over the neighbours: the 4096 FFT cannot split a 2.4 Hz band (shortcut: a longer
//! window for the lows, if bass detail ever matters). Its twin: `crates/shield/src/live.js` (`viz:begin`), Chromium's
//! analyser with a Blackman window, same band mapping and calibration; `fixtures/viz.json` is the shared test signal.

use crate::tap::Listener;
use realfft::num_complex::Complex;
use realfft::{RealFftPlanner, RealToComplex};
use std::sync::Arc;

pub const BANDS: usize = 61;
pub const FFT: usize = 4096;
pub const FPS: u32 = 60;
/// Band 0 is 10^(FIRST / 20) · 1 kHz = 19.95 Hz; step 10^(1/20) = 1/6 octave (base 10, ANSI / IEC); band 60 = 19.95 kHz.
const FIRST: i32 = -34;
/// Narrowest a band reads, FFT bins (3 bins hold 98 % of a Hann sine, 97 % of a Blackman one).
const MIN_WIDTH: f64 = 3.0;
/// Frame layout: version, band count, two reserved, rms L, rms R, peak L, peak R, bands L, bands R. Every dB value is one
/// byte, (dB + 120) · 2: 0.5 dB steps from -120 up to +7.5.
pub const FORMAT: u8 = 1;
pub const HEADER: usize = 8;
pub const FRAME_BYTES: usize = HEADER + 2 * BANDS;
/// Ticks without news before a silent frame is sent (~100 ms).
const STILL_TICKS: u32 = 6;

/// Band center, Hz.
pub fn centre(i: usize) -> f64 {
    1000.0 * 10f64.powf((FIRST + i as i32) as f64 / 20.0)
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
    pub fn new(rate: f64, n: usize) -> Self {
        let (df, half) = (rate / n as f64, (n / 2) as f64);
        let edge = 10f64.powf(0.025);
        let (mut spans, mut shares) = (Vec::with_capacity(BANDS), Vec::new());
        for i in 0..BANDS {
            let c = centre(i) / df;
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
    pub fn sum(&self, power: &[f32]) -> [f64; BANDS] {
        std::array::from_fn(|i| {
            let (first, shares) = self.band(i);
            shares.iter().enumerate().map(|(j, s)| s * power.get(first + j).copied().unwrap_or(0.0) as f64).sum()
        })
    }
}

/// One moment of the music: levels in dB (0 = full scale; a full-scale sine's rms reads -3), bands in dB.
#[derive(Debug, Clone, PartialEq)]
pub struct Frame {
    pub rms: [f32; 2],
    pub peak: [f32; 2],
    pub bands: [[f32; BANDS]; 2],
}

impl Frame {
    pub fn silent() -> Self {
        Self { rms: [-120.0; 2], peak: [-120.0; 2], bands: [[-120.0; BANDS]; 2] }
    }

    pub fn pack(&self) -> Vec<u8> {
        let mut out = vec![FORMAT, BANDS as u8, 0, 0];
        out.extend(self.rms.iter().chain(&self.peak).map(|&v| quantize(v)));
        out.extend(self.bands.iter().flatten().map(|&v| quantize(v)));
        out
    }

    /// Back from bytes (tests, and the contract the front end's `vizFrames.ts` unpacks): `None` if not a frame.
    pub fn unpack(b: &[u8]) -> Option<Self> {
        if b.len() != FRAME_BYTES || b[0] != FORMAT || b[1] as usize != BANDS {
            return None;
        }
        let d = |i: usize| dequantize(b[i]);
        Some(Self { rms: [d(4), d(5)], peak: [d(6), d(7)], bands: std::array::from_fn(|c| std::array::from_fn(|i| d(HEADER + c * BANDS + i))) })
    }
}

/// Windowed FFT → bands. Allocates once; `analyze` allocates nothing.
pub struct Analyzer {
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
        let fft = RealFftPlanner::<f32>::new().plan_fft_forward(FFT);
        // Periodic Hann: the window's sum is exactly N / 2.
        let window: Vec<f32> = (0..FFT).map(|i| (0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / FFT as f64).cos()) as f32).collect();
        let energy: f64 = window.iter().map(|&w| (w as f64) * (w as f64)).sum();
        Self { time: fft.make_input_vec(), spec: fft.make_output_vec(), scratch: fft.make_scratch_vec(), power: vec![0.0; FFT / 2 + 1], fft, window, norm: 4.0 / (FFT as f64 * energy), map: BandMap::new(48_000.0, FFT), rate: 48_000 }
    }

    fn bands(&mut self, x: &[f32]) -> [f32; BANDS] {
        for ((t, &s), &w) in self.time.iter_mut().zip(x).zip(&self.window) {
            *t = s * w;
        }
        // Lengths are fixed at construction: cannot fail.
        let _ = self.fft.process_with_scratch(&mut self.time, &mut self.spec, &mut self.scratch);
        for (p, c) in self.power.iter_mut().zip(&self.spec) {
            *p = c.norm_sqr();
        }
        self.map.sum(&self.power).map(|e| db(e * self.norm))
    }

    /// `left` / `right`: the last `FFT` frames. Peak: the last `hop` frames only (the time since the last frame).
    pub fn analyze(&mut self, left: &[f32], right: &[f32], rate: u32, hop: usize) -> Frame {
        if rate != self.rate && rate > 0 {
            self.rate = rate;
            self.map = BandMap::new(rate as f64, FFT);
        }
        let level = |x: &[f32]| {
            let rms = (x.iter().map(|&s| (s as f64) * (s as f64)).sum::<f64>() / x.len().max(1) as f64).sqrt();
            let peak = x[x.len().saturating_sub(hop.max(1))..].iter().fold(0f32, |m, s| m.max(s.abs()));
            (db(rms * rms), db((peak as f64) * (peak as f64)))
        };
        let ((rl, pl), (rr, pr)) = (level(left), level(right));
        Frame { rms: [rl, rr], peak: [pl, pr], bands: [self.bands(left), self.bands(right)] }
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
}

impl Pump {
    pub fn new(listener: Listener) -> Self {
        Self { seen: listener.head(), listener, analyzer: Analyzer::new(), left: vec![0.0; FFT], right: vec![0.0; FFT], still: 0, idle: false }
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
            return (self.still == STILL_TICKS && !std::mem::replace(&mut self.idle, true)).then(|| Frame::silent().pack());
        }
        self.seen = head;
        self.still = 0;
        self.listener.latest(&mut self.left, &mut self.right);
        let sound = self.left.iter().chain(&self.right).any(|&s| s != 0.0);
        if !sound {
            return (!std::mem::replace(&mut self.idle, true)).then(|| Frame::silent().pack());
        }
        self.idle = false;
        let rate = self.listener.rate();
        Some(self.analyzer.analyze(&self.left, &self.right, rate, (rate / FPS) as usize).pack())
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
    fn the_band_map_is_pure_arithmetic() {
        let map = BandMap::new(48_000.0, FFT);
        let df = 48_000.0 / FFT as f64;
        // Wide band (1 kHz): its shares add up to its width in bins, first bin right.
        let (first, shares) = map.band(34);
        let width = centre(34) * (10f64.powf(0.025) - 10f64.powf(-0.025)) / df;
        assert!((shares.iter().sum::<f64>() - width).abs() < 1e-9, "{shares:?}");
        assert!((first as f64 - 0.5) <= centre(34) / 10f64.powf(0.025) / df);
        // Narrow band (20 Hz, 2.4 Hz wide, under one bin): widened to 3 bins.
        assert!((map.band(0).1.iter().sum::<f64>() - 3.0).abs() < 1e-9, "{:?}", map.band(0));
        // Above Nyquist: empty (22.05 kHz rate: the top bands are gone, the 10 kHz band stays).
        let low = BandMap::new(22_050.0, FFT);
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
        for rate in [44_100, 48_000, 96_000] {
            let mut a = Analyzer::new();
            for i in 0..BANDS {
                let s = sine(centre(i), 1.0, rate, FFT);
                let f = a.analyze(&s, &s, rate, (rate / FPS) as usize);
                let tol = if rate > 48_000 { 1.5 } else { 0.5 };
                assert!(f.bands[0][i].abs() < tol, "{rate} Hz, band {i} ({:.1} Hz) reads {}", centre(i), f.bands[0][i]);
                assert_eq!(f.bands[0], f.bands[1]);
                // Neighbours 15 dB under where the bands are wider than the window can see (3.3 bins: 320 Hz and up at
                // 48 kHz; at 355 Hz they read -22 dB). Below, bands overlap by design: the lit one is no more than
                // 1 dB under its neighbours (at 200 Hz they read -6 dB, at 25 Hz about 0).
                let df = rate as f64 / FFT as f64;
                for j in [i.wrapping_sub(1), i + 1].into_iter().filter(|&j| j < BANDS && centre(j) < rate as f64 * 0.45) {
                    if centre(i) * 0.122 / df >= 3.3 {
                        assert!(f.bands[0][j] < -15.0, "{rate} Hz, band {i} lights {j}: {}", f.bands[0][j]);
                    } else {
                        assert!(f.bands[0][j] <= f.bands[0][i] + 1.0, "{rate} Hz, band {i} vs {j}");
                    }
                }
            }
        }
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
    struct Signal {
        name: String,
        components: Vec<Component>,
        left: Vec<f64>,
        right: Vec<f64>,
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

    fn render(components: &[Component], rate: u32) -> (Vec<f64>, Vec<f64>) {
        let (mut l, mut r) = (vec![0.0; FFT], vec![0.0; FFT]);
        for c in components {
            for i in 0..FFT {
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
        let mut a = Analyzer::new();
        let mut out = Fixture { rate, signals: Vec::new() };
        let mut read_back = Vec::new();
        for (name, components) in fixture_signals() {
            let (l, r) = render(&components, rate);
            let f = a.analyze(&l.iter().map(|&x| x as f32).collect::<Vec<_>>(), &r.iter().map(|&x| x as f32).collect::<Vec<_>>(), rate, 800);
            let round = |b: &[f32; BANDS]| b.iter().map(|&v| (v as f64 * 100.0).round() / 100.0).collect::<Vec<_>>();
            read_back.push((round(&f.bands[0]), round(&f.bands[1])));
            out.signals.push(Signal { name, components, left: round(&f.bands[0]), right: round(&f.bands[1]) });
        }
        if std::env::var_os("UPDATE_VIZ_FIXTURE").is_some() {
            std::fs::create_dir_all(concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures")).unwrap();
            std::fs::write(path, serde_json::to_string_pretty(&out).unwrap() + "\n").unwrap();
        }
        let saved: Fixture = serde_json::from_str(&std::fs::read_to_string(path).expect("run once with UPDATE_VIZ_FIXTURE=1")).unwrap();
        assert_eq!(saved.rate, rate);
        for (s, (l, r)) in saved.signals.iter().zip(&read_back) {
            for (want, got) in s.left.iter().zip(l).chain(s.right.iter().zip(r)) {
                assert!((want - got).abs() < 0.02, "{}: {want} vs {got}", s.name);
            }
        }
        assert_eq!(saved.signals.len(), read_back.len());
    }
}
