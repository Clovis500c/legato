//! A local song's shape for the seek bar (Settings › Appearance › Progress bar › Song's shape): how loud it is along the
//! song, measured in the same decode as the silence scan and the levelling (`level::analyse`), kept by the shell. Local
//! files only: a stream's audio is never taken for it.

/// Points across a song.
pub const POINTS: usize = 400;
/// Windows the level is measured in, s.
const WINDOW_S: f32 = 0.05;
/// dB under full scale RMS shown above the floor: -36 dBFS and quieter = 0, full scale = 255.
const RANGE_DB: f32 = 36.0;

/// The mean square of every window (all channels together), then each point's.
pub struct Shape {
    /// Samples a window, all channels counted.
    per: usize,
    sum: f64,
    n: usize,
    windows: Vec<f32>,
}

impl Shape {
    pub fn new(rate: u32, channels: usize) -> Self {
        Self { per: ((rate as f32 * WINDOW_S) as usize).max(1) * channels.max(1), sum: 0.0, n: 0, windows: Vec::new() }
    }

    pub fn push(&mut self, x: f32) {
        self.sum += f64::from(x) * f64::from(x);
        self.n += 1;
        if self.n == self.per {
            self.windows.push((self.sum / self.n as f64) as f32);
            self.sum = 0.0;
            self.n = 0;
        }
    }

    /// `points` levels across the song, 0 (silent) to 255 (full scale): each the RMS of its windows in dB. None for an
    /// empty file.
    pub fn finish(mut self, points: usize) -> Vec<u8> {
        if self.n > 0 {
            self.windows.push((self.sum / self.n as f64) as f32);
        }
        let w = self.windows.len();
        if w == 0 {
            return Vec::new();
        }
        (0..points)
            .map(|i| {
                // A song shorter than the points: windows shown more than once.
                let a = (i * w / points).min(w - 1);
                let b = ((i + 1) * w / points).clamp(a + 1, w);
                level(self.windows[a..b].iter().sum::<f32>() / (b - a) as f32)
            })
            .collect()
    }
}

/// A mean square as 0..=255 on the dB scale.
fn level(mean_square: f32) -> u8 {
    if mean_square <= 0.0 {
        return 0;
    }
    let db = 10.0 * mean_square.log10();
    (((db + RANGE_DB) / RANGE_DB).clamp(0.0, 1.0) * 255.0).round() as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stereo sine of `amp` at 440 Hz, `seconds` long, at 48 kHz.
    fn sine(shape: &mut Shape, amp: f32, seconds: f32) {
        for i in 0..(48_000.0 * seconds) as usize {
            let x = amp * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 48_000.0).sin();
            shape.push(x);
            shape.push(x);
        }
    }

    #[test]
    fn a_steady_sine_gives_a_flat_shape_at_its_rms() {
        let mut s = Shape::new(48_000, 2);
        sine(&mut s, 0.5, 10.0);
        let points = s.finish(POINTS);
        assert_eq!(points.len(), POINTS);
        // Peak -6 dBFS: RMS -9 dBFS, 27 dB over the floor of 36.
        let want = (27.0 / 36.0 * 255.0_f32).round() as u8;
        assert!(points.iter().all(|&p| p.abs_diff(want) <= 1), "{:?}", &points[..8]);
    }

    #[test]
    fn silence_reads_zero_and_a_loud_half_stands_up() {
        let mut s = Shape::new(48_000, 2);
        for _ in 0..48_000 * 2 * 5 {
            s.push(0.0);
        }
        sine(&mut s, 1.0, 5.0);
        let points = s.finish(100);
        assert!(points[..49].iter().all(|&p| p == 0));
        // Full scale sine: RMS -3 dBFS.
        assert!(points[51..].iter().all(|&p| p >= 230), "{:?}", &points[51..55]);
        // Under the floor reads zero too.
        let mut quiet = Shape::new(48_000, 1);
        for i in 0..48_000 {
            quiet.push(if i % 2 == 0 { 0.01 } else { -0.01 });
        }
        assert!(quiet.finish(10).iter().all(|&p| p == 0));
    }

    #[test]
    fn a_short_file_still_gives_every_point_and_an_empty_one_none() {
        let mut s = Shape::new(48_000, 1);
        for i in 0..4_800 {
            s.push(if i < 2_400 { 0.0 } else { 0.5 });
        }
        let points = s.finish(POINTS);
        assert_eq!(points.len(), POINTS);
        assert_eq!(points[0], 0);
        assert!(points[POINTS - 1] > 150);
        assert!(Shape::new(48_000, 2).finish(POINTS).is_empty());
    }
}
