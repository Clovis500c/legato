//! The sound split in bands for the visualizer: 16 bands about half an octave apart (50 Hz to 12.8 kHz), two band-passes
//! each (neighbours stay apart), on the mono mix, mean square over ~50 ms, in dB (a full-scale sine at a band's center
//! reads -3). Visual only; live.js reads the same bands from Chromium's analyser.

use crate::{Biquad, flush};

pub const BANDS: usize = 16;
/// Band width for 8/15 of an octave between centers.
const Q: f32 = 2.69;
const WINDOW_S: f32 = 0.05;

/// Band center, Hz: 50 · 2^(i · 8/15).
pub fn center(i: usize) -> f32 {
    50.0 * 2f32.powf(i as f32 * 8.0 / 15.0)
}

#[derive(Debug, Clone)]
pub struct Spectrum {
    filters: [[Biquad; 2]; BANDS],
    ms: [f32; BANDS],
    a: f32,
}

impl Spectrum {
    pub fn new(rate: f32) -> Self {
        Self { filters: std::array::from_fn(|i| [Biquad::bandpass(rate, center(i).min(rate * 0.45), Q); 2]), ms: [0.0; BANDS], a: 1.0 - (-1.0 / (WINDOW_S * rate)).exp() }
    }

    /// One interleaved frame (all channels).
    #[inline]
    pub fn frame(&mut self, frame: &[f32]) {
        let x = frame.iter().sum::<f32>() / frame.len().max(1) as f32;
        for (f, m) in self.filters.iter_mut().zip(&mut self.ms) {
            let y = f.iter_mut().fold(x, |v, b| b.run(v));
            *m = flush(*m + (y * y - *m) * self.a);
        }
    }

    /// dB per band, -120 when silent.
    pub fn db(&self) -> [f32; BANDS] {
        self.ms.map(|m| if m <= 1e-12 { -120.0 } else { 10.0 * m.log10() })
    }

    pub fn reset(&mut self) {
        self.filters.iter_mut().flatten().for_each(Biquad::reset);
        self.ms = [0.0; BANDS];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tone_lights_its_own_band() {
        let mut s = Spectrum::new(48_000.0);
        let f = center(8);
        for i in 0..24_000 {
            let x = (2.0 * std::f32::consts::PI * f * i as f32 / 48_000.0).sin();
            s.frame(&[x, x]);
        }
        let db = s.db();
        assert!((db[8] + 3.0).abs() < 0.5, "{db:?}");
        assert!(db[7] < -15.0 && db[9] < -15.0 && db[5] < -35.0 && db[0] < -60.0, "{db:?}");
        s.reset();
        assert_eq!(s.db(), [-120.0; BANDS]);
    }
}
