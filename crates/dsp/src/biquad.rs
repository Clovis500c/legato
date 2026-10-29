//! Second-order IIR filter (transposed direct form II), coefficients from the RBJ audio EQ cookbook formulas.

use std::f32::consts::PI;

#[derive(Debug, Clone, Copy, Default)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    fn new(b0: f32, b1: f32, b2: f32, a0: f32, a1: f32, a2: f32) -> Self {
        Self { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, z1: 0.0, z2: 0.0 }
    }

    pub fn highpass(rate: f32, freq: f32, q: f32) -> Self {
        let w = 2.0 * PI * freq / rate;
        let (s, c) = w.sin_cos();
        let alpha = s / (2.0 * q);
        Self::new((1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha)
    }

    pub fn lowpass(rate: f32, freq: f32, q: f32) -> Self {
        let w = 2.0 * PI * freq / rate;
        let (s, c) = w.sin_cos();
        let alpha = s / (2.0 * q);
        Self::new((1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha)
    }

    /// Passes a band around `freq`, 0 dB at its center.
    pub fn bandpass(rate: f32, freq: f32, q: f32) -> Self {
        let w = 2.0 * PI * freq / rate;
        let (s, c) = w.sin_cos();
        let alpha = s / (2.0 * q);
        Self::new(alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * c, 1.0 - alpha)
    }

    /// Shelf boosting / cutting above `freq` by `db` (slope 1).
    pub fn highshelf(rate: f32, freq: f32, db: f32) -> Self {
        let a = 10f32.powf(db / 40.0);
        let w = 2.0 * PI * freq / rate;
        let (s, c) = w.sin_cos();
        let alpha = s / 2.0 * 2f32.sqrt();
        let k = 2.0 * a.sqrt() * alpha;
        Self::new(a * ((a + 1.0) + (a - 1.0) * c + k), -2.0 * a * ((a - 1.0) + (a + 1.0) * c), a * ((a + 1.0) + (a - 1.0) * c - k), (a + 1.0) - (a - 1.0) * c + k, 2.0 * ((a - 1.0) - (a + 1.0) * c), (a + 1.0) - (a - 1.0) * c - k)
    }

    /// Shelf boosting / cutting below `freq` by `db` (slope 1).
    pub fn lowshelf(rate: f32, freq: f32, db: f32) -> Self {
        let a = 10f32.powf(db / 40.0);
        let w = 2.0 * PI * freq / rate;
        let (s, c) = w.sin_cos();
        let alpha = s / 2.0 * 2f32.sqrt();
        let k = 2.0 * a.sqrt() * alpha;
        Self::new(a * ((a + 1.0) - (a - 1.0) * c + k), 2.0 * a * ((a - 1.0) - (a + 1.0) * c), a * ((a + 1.0) - (a - 1.0) * c - k), (a + 1.0) + (a - 1.0) * c + k, -2.0 * ((a - 1.0) + (a + 1.0) * c), (a + 1.0) + (a - 1.0) * c - k)
    }

    /// Bell around `freq`.
    pub fn peaking(rate: f32, freq: f32, q: f32, db: f32) -> Self {
        let a = 10f32.powf(db / 40.0);
        let w = 2.0 * PI * freq / rate;
        let (s, c) = w.sin_cos();
        let alpha = s / (2.0 * q);
        Self::new(1.0 + alpha * a, -2.0 * c, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * c, 1.0 - alpha / a)
    }

    /// New coefficients, state kept (no click when a setting moves).
    pub fn retune(&mut self, other: Biquad) {
        (self.b0, self.b1, self.b2, self.a1, self.a2) = (other.b0, other.b1, other.b2, other.a1, other.a2);
    }

    #[inline]
    pub fn run(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        let (z1, z2) = (self.b1 * x - self.a1 * y + self.z2, self.b2 * x - self.a2 * y);
        // Silent: both to 0 together (crate::flush). One alone throws the pair off balance: z1 then grew ×2 a sample
        // and hovered near 1e-20, squares denormal forever.
        (self.z1, self.z2) = if z1.abs() < 1e-20 && z2.abs() < 1e-20 { (0.0, 0.0) } else { (z1, z2) };
        y
    }

    pub fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }

    /// Gain at `freq` (magnitude of the response), for tests and curves.
    pub fn gain_at(&self, rate: f32, freq: f32) -> f32 {
        let w = 2.0 * PI * freq / rate;
        let (re1, im1) = (w.cos(), -w.sin());
        let (re2, im2) = ((2.0 * w).cos(), -(2.0 * w).sin());
        let num = (self.b0 + self.b1 * re1 + self.b2 * re2, self.b1 * im1 + self.b2 * im2);
        let den = (1.0 + self.a1 * re1 + self.a2 * re2, self.a1 * im1 + self.a2 * im2);
        (num.0.hypot(num.1)) / (den.0.hypot(den.1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gain_to_db;

    #[test]
    fn silence_ends_in_zeros_not_denormals() {
        // Denormal floats run ~50× slower: a decaying filter lands on 0 and stays there.
        let mut f = Biquad::highpass(48_000.0, 38.1, 0.5);
        (0..4_800).for_each(|_| _ = f.run(0.5));
        let tail: Vec<f32> = (0..48_000).map(|_| f.run(0.0)).collect();
        assert!(tail.iter().all(|y| *y == 0.0 || y.is_normal()));
        assert!(tail[24_000..].iter().all(|y| *y == 0.0));
    }

    #[test]
    fn shapes_follow_the_cookbook() {
        let r = 48_000.0;
        let ls = Biquad::lowshelf(r, 100.0, 6.0);
        assert!((gain_to_db(ls.gain_at(r, 20.0)) - 6.0).abs() < 0.5);
        assert!(gain_to_db(ls.gain_at(r, 5_000.0)).abs() < 0.2);
        let hs = Biquad::highshelf(r, 1_500.0, 4.0);
        assert!((gain_to_db(hs.gain_at(r, 10_000.0)) - 4.0).abs() < 0.3);
        let pk = Biquad::peaking(r, 1_000.0, 1.0, -9.0);
        assert!((gain_to_db(pk.gain_at(r, 1_000.0)) + 9.0).abs() < 0.1);
        let hp = Biquad::highpass(r, 40.0, 0.5);
        assert!(gain_to_db(hp.gain_at(r, 10.0)) < -10.0);
        assert!(gain_to_db(hp.gain_at(r, 1_000.0)).abs() < 0.1);
    }

    #[test]
    fn filters_a_signal_and_settles() {
        let mut lp = Biquad::lowpass(48_000.0, 1_000.0, 0.707);
        // DC goes through a low-pass unchanged once settled.
        let mut y = 0.0;
        for _ in 0..10_000 {
            y = lp.run(1.0);
        }
        assert!((y - 1.0).abs() < 1e-3);
    }
}
