//! Integrated loudness of a whole song, ITU-R BS.1770-4 / EBU R128 as ReplayGain 2.0 measures it: the standard's own
//! K-weighting (`meter` uses a cookbook shelf, within a dB: fine live, not for matching scanners' tags), mean square
//! over 400 ms blocks every 100 ms, gated at -70 LUFS, then 10 LU under the mean of what passed. Offline: fed every
//! sample of a decoded file once (`music_player::level`).

/// What a song measured: loudness in LUFS (None: silent throughout) and sample peak (1.0 = full scale).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Loudness {
    pub lufs: Option<f32>,
    pub peak: f32,
}

/// Second-order section in f64 (transposed direct form II): a whole song's sums need the precision.
#[derive(Debug, Clone, Copy)]
struct Section {
    b: [f64; 3],
    a: [f64; 2],
    z: [f64; 2],
}

impl Section {
    #[inline]
    fn run(&mut self, x: f64) -> f64 {
        let y = self.b[0] * x + self.z[0];
        let z = [self.b[1] * x - self.a[0] * y + self.z[1], self.b[2] * x - self.a[1] * y];
        // Silence: both to 0 together, never hovering near denormals.
        self.z = if z[0].abs() < 1e-30 && z[1].abs() < 1e-30 { [0.0; 2] } else { z };
        y
    }
}

/// BS.1770's two stages at `rate`, from their analog prototypes (the standard lists 48 kHz coefficients only).
fn k_weighting(rate: f64) -> [Section; 2] {
    // Stage 1: high shelf, about +4 dB above 1.7 kHz (the head's effect).
    let (f0, gain_db, q) = (1_681.974_450_955_533, 3.999_843_853_973_347, 0.707_175_236_955_419_6);
    let k = (std::f64::consts::PI * f0 / rate).tan();
    let vh = 10f64.powf(gain_db / 20.0);
    let vb = vh.powf(0.499_666_774_154_541_6);
    let a0 = 1.0 + k / q + k * k;
    let shelf = Section { b: [(vh + vb * k / q + k * k) / a0, 2.0 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0], a: [2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0], z: [0.0; 2] };
    // Stage 2: high-pass around 38 Hz (RLB weighting).
    let (f0, q) = (38.135_470_876_024_44, 0.500_327_037_323_877_3);
    let k = (std::f64::consts::PI * f0 / rate).tan();
    let a0 = 1.0 + k / q + k * k;
    let high_pass = Section { b: [1.0, -2.0, 1.0], a: [2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0], z: [0.0; 2] };
    [shelf, high_pass]
}

const ABSOLUTE_GATE: f64 = -70.0;
const RELATIVE_GATE: f64 = 10.0;

/// Weighted mean square → LUFS.
fn lufs(power: f64) -> f64 {
    -0.691 + 10.0 * power.log10()
}

/// Fed a file's samples, says how loud it is.
#[derive(Debug, Clone)]
pub struct Integrated {
    filters: Vec<[Section; 2]>,
    weights: Vec<f64>,
    /// Channel of the next sample.
    channel: usize,
    /// Weighted K-filtered squares of the 100 ms hop being filled, its frames so far and in full.
    hop: f64,
    in_hop: usize,
    per_hop: usize,
    /// The last four hops (a block), by hop number mod 4.
    last: [f64; 4],
    hops: usize,
    /// Mean square of every block: the relative gate needs them all (10 a second, 80 bytes).
    blocks: Vec<f64>,
    peak: f32,
}

impl Integrated {
    pub fn new(rate: u32, channels: usize) -> Self {
        // BS.1770's weights: front channels 1, surrounds 1.41, LFE left out (5.1 = L R C LFE Ls Rs). Mono counts twice:
        // it plays on both speakers, as loud as the same sound on two channels.
        let weights = match channels.max(1) {
            1 => vec![2.0],
            5 => vec![1.0, 1.0, 1.0, 1.41, 1.41],
            6 => vec![1.0, 1.0, 1.0, 0.0, 1.41, 1.41],
            n => vec![1.0; n],
        };
        let rate = rate.max(1);
        Self { filters: vec![k_weighting(rate as f64); weights.len()], weights, channel: 0, hop: 0.0, in_hop: 0, per_hop: (rate as usize).div_ceil(10), last: [0.0; 4], hops: 0, blocks: Vec::new(), peak: 0.0 }
    }

    /// Next sample, channels interleaved.
    #[inline]
    pub fn push(&mut self, x: f32) {
        self.peak = self.peak.max(x.abs());
        let c = self.channel;
        let [shelf, high_pass] = &mut self.filters[c];
        let y = high_pass.run(shelf.run(x as f64));
        self.hop += self.weights[c] * y * y;
        self.channel += 1;
        if self.channel < self.weights.len() {
            return;
        }
        self.channel = 0;
        self.in_hop += 1;
        if self.in_hop < self.per_hop {
            return;
        }
        self.last[self.hops % 4] = self.hop;
        self.hops += 1;
        if self.hops >= 4 {
            self.blocks.push(self.last.iter().sum::<f64>() / (4 * self.per_hop) as f64);
        }
        self.hop = 0.0;
        self.in_hop = 0;
    }

    /// The song so far: blocks louder than -70 LUFS, then those within 10 LU of their mean. A last partial block
    /// doesn't count (the standard's way).
    pub fn result(&self) -> Loudness {
        let mean_over = |floor: f64| {
            let (sum, n) = self.blocks.iter().filter(|&&p| p > 0.0 && lufs(p) > floor).fold((0.0, 0usize), |(s, n), &p| (s + p, n + 1));
            (n > 0).then(|| sum / n as f64)
        };
        let lufs = mean_over(ABSOLUTE_GATE).and_then(|all| mean_over(ABSOLUTE_GATE.max(lufs(all) - RELATIVE_GATE))).map(|p| lufs(p) as f32);
        Loudness { lufs, peak: self.peak }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `secs` of a sine on every one of `channels` channels.
    fn tone(m: &mut Integrated, rate: u32, channels: usize, freq: f64, amp: f64, secs: f64) {
        for i in 0..(secs * rate as f64) as usize {
            let x = (amp * (2.0 * std::f64::consts::PI * freq * i as f64 / rate as f64).sin()) as f32;
            (0..channels).for_each(|_| m.push(x));
        }
    }

    fn measured(rate: u32, channels: usize, freq: f64, amp: f64, secs: f64) -> f32 {
        let mut m = Integrated::new(rate, channels);
        tone(&mut m, rate, channels, freq, amp, secs);
        m.result().lufs.unwrap()
    }

    #[test]
    fn the_standards_own_coefficients_at_48_khz() {
        let [shelf, high_pass] = k_weighting(48_000.0);
        let near = |a: &[f64], b: &[f64]| a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-6);
        assert!(near(&shelf.b, &[1.535_124_859_586_97, -2.691_696_189_406_38, 1.198_392_810_852_85]), "{:?}", shelf.b);
        assert!(near(&shelf.a, &[-1.690_659_293_182_41, 0.732_480_774_215_85]), "{:?}", shelf.a);
        assert!(near(&high_pass.a, &[-1.990_047_454_833_98, 0.990_072_250_366_21]), "{:?}", high_pass.a);
    }

    #[test]
    fn a_1k_sine_reads_its_level_at_any_rate() {
        // BS.1770: 0 dBFS 1 kHz on two channels = 0 LUFS (-3.01 on one); -20 dBFS reads -20.
        for rate in [44_100, 48_000, 96_000] {
            assert!(measured(rate, 2, 1_000.0, 1.0, 5.0).abs() < 0.1, "{rate}");
            assert!((measured(rate, 2, 1_000.0, 0.1, 5.0) + 20.0).abs() < 0.1, "{rate}");
        }
        assert!((measured(48_000, 1, 1_000.0, 0.1, 5.0) + 20.0).abs() < 0.1, "mono = both speakers");
        // Treble counts more (the shelf), deep bass less.
        let mid = measured(48_000, 2, 1_000.0, 0.1, 5.0);
        assert!((measured(48_000, 2, 10_000.0, 0.1, 5.0) - mid - 3.3).abs() < 0.4);
        assert!(measured(48_000, 2, 20.0, 0.1, 5.0) < mid - 5.0);
    }

    #[test]
    fn silence_and_quiet_parts_are_gated_out() {
        let mut m = Integrated::new(48_000, 2);
        tone(&mut m, 48_000, 2, 1_000.0, 0.1, 10.0);
        tone(&mut m, 48_000, 2, 1_000.0, 0.0, 10.0);
        let r = m.result();
        assert!((r.lufs.unwrap() + 20.0).abs() < 0.1, "{r:?}");
        assert!((r.peak - 0.1).abs() < 1e-3);
        // 20 dB under the rest: under the relative gate, left out.
        tone(&mut m, 48_000, 2, 1_000.0, 0.01, 10.0);
        assert!((m.result().lufs.unwrap() + 20.0).abs() < 0.1);
        // 6 dB under: within 10 LU, it counts (mean of the two powers).
        let mut both = Integrated::new(48_000, 2);
        tone(&mut both, 48_000, 2, 1_000.0, 0.1, 10.0);
        tone(&mut both, 48_000, 2, 1_000.0, 0.05, 10.0);
        assert!((both.result().lufs.unwrap() + 22.04).abs() < 0.1, "{:?}", both.result());
    }

    #[test]
    fn nothing_to_measure_reads_none() {
        let mut m = Integrated::new(44_100, 2);
        assert_eq!(m.result(), Loudness { lufs: None, peak: 0.0 });
        tone(&mut m, 44_100, 2, 1_000.0, 0.0, 3.0);
        assert_eq!(m.result().lufs, None);
        // Shorter than one block.
        let mut short = Integrated::new(44_100, 2);
        tone(&mut short, 44_100, 2, 1_000.0, 0.5, 0.3);
        assert_eq!(short.result().lufs, None);
    }
}
