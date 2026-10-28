//! 3D / 8D for headphones: the song (folded to one source) placed around a spherical head. Interaural time difference
//! (Woodworth), head shadow on the far ear and presence on the near one (Brown–Duda one-pole / one-zero), a little
//! brightness up or down for elevation, level by distance. 8D = the azimuth going round. The YouTube side uses
//! Chromium's HRTF panner (live.js) with the same position.

use crate::Biquad;
use std::f32::consts::PI;

const HEAD_M: f32 = 0.0875;
const SOUND_MS: f32 = 343.0;

/// Seconds the far ear hears it later (Woodworth), azimuth in radians.
pub fn itd(azimuth: f32) -> f32 {
    let a = azimuth.abs().min(PI - azimuth.abs()).min(PI / 2.0);
    HEAD_M / SOUND_MS * (a + a.sin())
}

/// Brown–Duda head shadow for one ear: alpha from the angle between source and ear (0 = facing it, π = opposite).
fn shadow_alpha(angle: f32) -> f32 {
    let limit = 150f32.to_radians();
    1.05 + 0.95 * (angle.min(limit) / limit * PI).cos()
}

/// One-pole / one-zero head shadow filter (bilinear), retuned as the source moves.
#[derive(Clone, Copy, Default)]
struct Shadow {
    b0: f32,
    b1: f32,
    a1: f32,
    x1: f32,
    y1: f32,
}

impl Shadow {
    fn tune(&mut self, rate: f32, alpha: f32) {
        // H(s) = (alpha s / (2 w0) + 1) / (s / (2 w0) + 1), w0 = c / a.
        let w0 = SOUND_MS / HEAD_M;
        let k = 2.0 * rate;
        let t = 2.0 * w0;
        let (n1, n0) = (alpha / t, 1.0);
        let (d1, d0) = (1.0 / t, 1.0);
        let norm = d1 * k + d0;
        self.b0 = (n1 * k + n0) / norm;
        self.b1 = (n0 - n1 * k) / norm;
        self.a1 = (d0 - d1 * k) / norm;
    }

    #[inline]
    fn run(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 - self.a1 * self.y1;
        self.x1 = x;
        self.y1 = crate::flush(y);
        y
    }
}

/// Fractional delay line (linear interpolation), up to ~2 ms.
struct Delay {
    buf: Vec<f32>,
    i: usize,
}

impl Delay {
    fn new(rate: f32) -> Self {
        Self { buf: vec![0.0; (rate * 0.002) as usize + 4], i: 0 }
    }

    #[inline]
    fn run(&mut self, x: f32, frames: f32) -> f32 {
        let len = self.buf.len();
        self.buf[self.i] = x;
        let d = frames.clamp(0.0, (len - 2) as f32);
        let whole = d.floor() as usize;
        let frac = d - whole as f32;
        let a = self.buf[(self.i + len - whole) % len];
        let b = self.buf[(self.i + len - whole - 1) % len];
        self.i = (self.i + 1) % len;
        a + (b - a) * frac
    }
}

pub struct Space {
    rate: f32,
    delays: [Delay; 2],
    shadows: [Shadow; 2],
    tilt: [Biquad; 2],
    tilt_db: f32,
    /// Current azimuth, radians (moves on its own in 8D).
    azimuth: f32,
    /// Smoothed per-ear delay (frames) and gain: no zipper noise as it moves.
    lag: [f32; 2],
    gain: [f32; 2],
    since_tune: usize,
}

impl Space {
    pub fn new(rate: f32) -> Self {
        let tilt = Biquad::highshelf(rate, 4_000.0, 0.0);
        Self { rate, delays: [Delay::new(rate), Delay::new(rate)], shadows: [Shadow::default(); 2], tilt: [tilt, tilt], tilt_db: 0.0, azimuth: 0.0, lag: [0.0; 2], gain: [1.0; 2], since_tune: usize::MAX }
    }

    /// Where it is now (degrees), for the UI's dot.
    pub fn azimuth_deg(&self) -> f32 {
        let d = self.azimuth.to_degrees() % 360.0;
        if d > 180.0 { d - 360.0 } else if d < -180.0 { d + 360.0 } else { d }
    }

    pub fn reset(&mut self) {
        *self = Self { azimuth: self.azimuth, ..Self::new(self.rate) };
    }

    /// One stereo frame through: folded to one source, placed. `s` = settings; azimuth follows them unless rotating.
    #[inline]
    pub fn run(&mut self, l: f32, r: f32, s: &crate::effects::Space) -> [f32; 2] {
        if s.rotate {
            self.azimuth += 2.0 * PI / (s.period_s.max(0.5) * self.rate);
            if self.azimuth > PI {
                self.azimuth -= 2.0 * PI;
            }
        } else {
            self.azimuth = s.azimuth.to_radians();
        }
        // Filters retuned every 64 frames: smooth enough, cheap.
        self.since_tune = self.since_tune.wrapping_add(1);
        if self.since_tune >= 64 {
            self.since_tune = 0;
            self.tune(s);
        }
        let x = 0.5 * (l + r);
        std::array::from_fn(|ear| {
            let delayed = self.delays[ear].run(x, self.lag[ear]);
            let shaded = self.shadows[ear].run(delayed);
            self.tilt[ear].run(shaded) * self.gain[ear]
        })
    }

    fn tune(&mut self, s: &crate::effects::Space) {
        let az = self.azimuth;
        // Ears at ±90°: angle between the source and each ear.
        let to_ear = |ear_az: f32| {
            let d = (az - ear_az).abs() % (2.0 * PI);
            if d > PI { 2.0 * PI - d } else { d }
        };
        let angles = [to_ear(-PI / 2.0), to_ear(PI / 2.0)];
        let lag = itd(az) * self.rate;
        // Far ear = the one with the larger angle.
        let far = if angles[0] > angles[1] { 0 } else { 1 };
        // Behind: a touch darker than ahead (pinna), elevation brighter above.
        let behind = if az.abs() > PI / 2.0 { -2.0 } else { 0.0 };
        let tilt = (s.elevation / 40.0 * 4.0 + behind).clamp(-6.0, 6.0);
        if (tilt - self.tilt_db).abs() > 0.05 {
            self.tilt_db = tilt;
            for t in &mut self.tilt {
                t.retune(Biquad::highshelf(self.rate, 4_000.0, tilt));
            }
        }
        let level = (1.0 / s.distance.max(0.25)).min(1.5);
        for (ear, angle) in angles.into_iter().enumerate() {
            self.shadows[ear].tune(self.rate, shadow_alpha(angle));
            let want = if ear == far { lag } else { 0.0 };
            self.lag[ear] += (want - self.lag[ear]) * 0.5;
            self.gain[ear] = level;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::effects::Space as Settings;

    fn render(az: f32) -> (f32, f32) {
        let mut s = Space::new(48_000.0);
        let set = Settings { on: true, azimuth: az, ..Settings::default() };
        let (mut el, mut er) = (0.0, 0.0);
        for i in 0..48_000 {
            let x = (i as f32 * 0.07).sin() * 0.5 + (i as f32 * 0.9).sin() * 0.3;
            let [l, r] = s.run(x, x, &set);
            if i > 4_800 {
                el += l * l;
                er += r * r;
            }
        }
        (el, er)
    }

    #[test]
    fn right_is_louder_on_the_right_and_ahead_is_even() {
        let (l, r) = render(90.0);
        assert!(r > l * 1.5, "{l} {r}");
        let (l, r) = render(-90.0);
        assert!(l > r * 1.5, "{l} {r}");
        let (l, r) = render(0.0);
        assert!((l / r - 1.0).abs() < 0.05, "{l} {r}");
        // Woodworth: about 0.66 ms at the side, none ahead.
        assert!((itd(PI / 2.0) * 1000.0 - 0.656).abs() < 0.01);
        assert_eq!(itd(0.0), 0.0);
    }

    #[test]
    fn eight_d_goes_round() {
        let mut s = Space::new(1_000.0);
        let set = Settings { on: true, rotate: true, period_s: 4.0, ..Settings::default() };
        for _ in 0..1_000 {
            s.run(0.0, 0.0, &set);
        }
        // A quarter turn in one second.
        assert!((s.azimuth_deg() - 90.0).abs() < 1.0, "{}", s.azimuth_deg());
    }
}
