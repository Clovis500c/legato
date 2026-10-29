//! The Live Editor's effects after the speed / pitch stage, in order: bass and equalizer, distortion, compressor,
//! stereo width, echo, reverb, 3D / 8D, balance. Stereo in and out (mono is spread, more channels: the first two are processed).
//! Settings are read once per block; filters retune only when they change.

use crate::effects::{EQ_FREQS, EQ_Q, Effects};
use crate::reverb::{self, Reverb};
use crate::space::Space;
use crate::{Biquad, db_to_gain};

const BASS_HZ: f32 = 100.0;
/// Compressor timing, seconds.
const ATTACK_S: f32 = 0.005;
const RELEASE_S: f32 = 0.15;

/// Compressor macro: one amount → threshold (dB), ratio, makeup (dB). Shared with live.js.
pub fn compressor(amount: f32) -> (f32, f32, f32) {
    let a = amount.clamp(0.0, 1.0);
    let threshold = -6.0 - 24.0 * a;
    let ratio = 1.0 + 7.0 * a;
    // Half the gain lost on a full-scale peak comes back.
    let makeup = -threshold * (1.0 - 1.0 / ratio) * 0.5;
    (threshold, ratio, makeup)
}

/// Distortion macro: one amount → drive gain (up to +30 dB) and the scale keeping a -12 dBFS peak where it was
/// (so the level holds while the shape changes). Shared with live.js: y = scale · tanh(drive · x).
pub fn distortion(amount: f32) -> (f32, f32) {
    const REF: f32 = 0.25;
    let drive = db_to_gain(30.0 * amount.clamp(0.0, 1.0));
    (drive, REF / (drive * REF).tanh())
}

/// Per-channel filters for one setting of bass + EQ.
fn filters(rate: f32, e: &Effects) -> [Biquad; 11] {
    let last = EQ_FREQS.len() - 1;
    std::array::from_fn(|i| match i {
        0 => Biquad::lowshelf(rate, BASS_HZ, e.bass),
        1 => Biquad::lowshelf(rate, EQ_FREQS[0], e.eq[0]),
        _ if i - 1 == last => Biquad::highshelf(rate, EQ_FREQS[last], e.eq[last]),
        _ => Biquad::peaking(rate, EQ_FREQS[i - 1], EQ_Q, e.eq[i - 1]),
    })
}

pub struct Chain {
    rate: f32,
    eq: [[Biquad; 11]; 2],
    tuned: Option<(f32, [f32; 10])>,
    env: f32,
    att: f32,
    rel: f32,
    echo: Vec<[f32; 2]>,
    echo_i: usize,
    reverb: Reverb,
    /// The 3D room: its own reverb, so both can run.
    room: Reverb,
    space: Space,
}

impl Chain {
    pub fn new(rate: u32) -> Self {
        let r = rate as f32;
        let flat = filters(r, &Effects::default());
        Self {
            rate: r,
            eq: [flat, flat],
            tuned: None,
            env: 0.0,
            att: 1.0 - (-1.0 / (ATTACK_S * r)).exp(),
            rel: 1.0 - (-1.0 / (RELEASE_S * r)).exp(),
            echo: vec![[0.0; 2]; (r * 2.05) as usize],
            echo_i: 0,
            reverb: Reverb::new(r),
            room: Reverb::new(r),
            space: Space::new(r),
        }
    }

    /// After a seek or a new song: tails and filter states cleared.
    pub fn reset(&mut self) {
        self.eq.iter_mut().flatten().for_each(Biquad::reset);
        self.env = 0.0;
        self.echo.iter_mut().for_each(|f| *f = [0.0; 2]);
        self.reverb.reset();
        self.room.reset();
        self.space.reset();
    }

    /// 3D / 8D position now (degrees), for the editor's dot.
    pub fn azimuth(&self) -> f32 {
        self.space.azimuth_deg()
    }

    /// Interleaved frames of `channels`, in place.
    pub fn process(&mut self, block: &mut [f32], channels: usize, e: &Effects) {
        if channels == 0 || e.after_time_neutral() {
            return;
        }
        if self.tuned != Some((e.bass, e.eq)) {
            self.tuned = Some((e.bass, e.eq));
            let f = filters(self.rate, e);
            for side in &mut self.eq {
                for (b, n) in side.iter_mut().zip(f) {
                    b.retune(n);
                }
            }
        }
        let eq_on = e.bass != 0.0 || e.eq.iter().any(|g| *g != 0.0);
        let (threshold, ratio, makeup) = compressor(e.compress);
        let makeup = db_to_gain(makeup);
        let (drive, shape) = distortion(e.drive);
        let echo_len = ((e.echo.time_ms / 1000.0 * self.rate) as usize).clamp(1, self.echo.len() - 1);
        self.reverb.set_predelay(e.reverb.predelay_ms);
        let (fb, damp) = (reverb::feedback(e.reverb.size), reverb::damp(e.reverb.damping));
        let (dry, wet) = reverb::levels(e.reverb.mix, e.reverb.size);
        // Constant-power balance.
        let pan = (e.balance + 1.0) * std::f32::consts::FRAC_PI_4;
        let (bal_l, bal_r) = (pan.cos() * std::f32::consts::SQRT_2, pan.sin() * std::f32::consts::SQRT_2);

        for frame in block.chunks_exact_mut(channels) {
            let mut l = frame[0];
            let mut r = if channels > 1 { frame[1] } else { frame[0] };
            if eq_on {
                l = self.eq[0].iter_mut().fold(l, |x, b| b.run(x));
                r = self.eq[1].iter_mut().fold(r, |x, b| b.run(x));
            }
            if e.drive > 0.0 {
                l = shape * (drive * l).tanh();
                r = shape * (drive * r).tanh();
            }
            if e.compress > 0.0 {
                // Peak envelope, stereo-linked, soft knee of 6 dB.
                let peak = l.abs().max(r.abs());
                let k = if peak > self.env { self.att } else { self.rel };
                self.env = crate::flush(self.env + (peak - self.env) * k);
                let level = 20.0 * self.env.max(1e-6).log10();
                let over = level - threshold;
                let cut = if over <= -3.0 {
                    0.0
                } else if over < 3.0 {
                    (1.0 - 1.0 / ratio) * (over + 3.0).powi(2) / 12.0
                } else {
                    (1.0 - 1.0 / ratio) * over
                };
                let g = db_to_gain(-cut) * makeup;
                l *= g;
                r *= g;
            }
            if e.width != 1.0 {
                let mid = 0.5 * (l + r);
                let side = 0.5 * (l - r) * e.width;
                l = mid + side;
                r = mid - side;
            }
            if e.echo.mix > 0.0 {
                let len = self.echo.len();
                let back = self.echo[(self.echo_i + len - echo_len) % len];
                self.echo[self.echo_i] = [crate::flush(l + back[0] * e.echo.feedback), crate::flush(r + back[1] * e.echo.feedback)];
                self.echo_i = (self.echo_i + 1) % len;
                l += back[0] * e.echo.mix;
                r += back[1] * e.echo.mix;
            }
            if e.reverb.mix > 0.0 {
                let [wl, wr] = self.reverb.run(l, r, fb, damp);
                // Equal-ish power: the dry side dips as the wet one rises.
                l = l * dry + wl * wet;
                r = r * dry + wr * wet;
            }
            if e.space.on {
                let [sl, sr] = self.space.run(l, r, &e.space);
                if e.space.room > 0.0 {
                    let [wl, wr] = self.room.run(sl, sr, reverb::feedback(0.5), reverb::damp(0.6));
                    let room = e.space.room * 0.6 * e.space.distance.min(2.0);
                    l = sl + wl * room;
                    r = sr + wr * room;
                } else {
                    l = sl;
                    r = sr;
                }
            }
            if e.balance != 0.0 {
                l *= bal_l;
                r *= bal_r;
            }
            frame[0] = l;
            if channels > 1 {
                frame[1] = r;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::effects::{Echo, Reverb as ReverbSettings};

    fn tone(freq: f32, secs: f32) -> Vec<f32> {
        (0..(secs * 48_000.0) as usize).flat_map(|i| {
            let x = 0.3 * (2.0 * std::f32::consts::PI * freq * i as f32 / 48_000.0).sin();
            [x, x]
        }).collect()
    }

    fn rms(v: &[f32]) -> f32 {
        (v.iter().map(|x| x * x).sum::<f32>() / v.len() as f32).sqrt()
    }

    #[test]
    fn neutral_settings_change_nothing() {
        let mut c = Chain::new(48_000);
        let src = tone(440.0, 0.5);
        let mut out = src.clone();
        c.process(&mut out, 2, &Effects::default());
        assert_eq!(out, src);
    }

    #[test]
    fn bass_boost_lifts_lows_only() {
        let e = Effects { bass: 12.0, ..Effects::default() };
        let gain = |f: f32| {
            let mut c = Chain::new(48_000);
            let mut out = tone(f, 1.0);
            c.process(&mut out, 2, &e);
            rms(&out[48_000..]) / 0.3 * std::f32::consts::SQRT_2
        };
        assert!(gain(30.0) > 3.0, "{}", gain(30.0));
        assert!((gain(5_000.0) - 1.0).abs() < 0.05, "{}", gain(5_000.0));
    }

    #[test]
    fn distortion_squares_the_wave_and_keeps_the_level() {
        let mut c = Chain::new(48_000);
        let mut out = tone(440.0, 0.5);
        c.process(&mut out, 2, &Effects { drive: 1.0, ..Effects::default() });
        let peak = out.iter().fold(0.0f32, |m, x| m.max(x.abs()));
        // 0.3 peak in: about the -12 dBFS reference out, nearly square (sine: rms / peak = 0.71).
        assert!((0.24..0.27).contains(&peak), "{peak}");
        assert!(rms(&out) / peak > 0.9, "{}", rms(&out) / peak);
    }

    #[test]
    fn each_band_lifts_its_own_octave() {
        // +12 dB at 1 kHz: about ×4 there, an octave either side well under, far bands untouched.
        let mut eq = [0.0; 10];
        eq[5] = 12.0;
        let e = Effects { eq, ..Effects::default() };
        let gain = |f: f32| {
            let mut c = Chain::new(48_000);
            let mut out = tone(f, 1.0);
            c.process(&mut out, 2, &e);
            rms(&out[48_000..]) / 0.3 * std::f32::consts::SQRT_2
        };
        assert!((gain(1_000.0) - 3.98).abs() < 0.1, "{}", gain(1_000.0));
        assert!(gain(2_000.0) < 2.5 && gain(500.0) < 2.5, "{} {}", gain(2_000.0), gain(500.0));
        assert!((gain(60.0) - 1.0).abs() < 0.05 && (gain(12_000.0) - 1.0).abs() < 0.05, "{} {}", gain(60.0), gain(12_000.0));
    }

    #[test]
    fn mono_and_balance() {
        let mut c = Chain::new(48_000);
        let mut frame = [1.0, 0.0];
        c.process(&mut frame, 2, &Effects { width: 0.0, ..Effects::default() });
        assert_eq!(frame, [0.5, 0.5]);
        let mut frame = [0.5, 0.5];
        c.process(&mut frame, 2, &Effects { balance: 1.0, ..Effects::default() });
        assert!(frame[0].abs() < 1e-6 && (frame[1] - 0.5 * std::f32::consts::SQRT_2).abs() < 1e-5, "{frame:?}");
    }

    #[test]
    fn echo_repeats_after_its_time() {
        let mut c = Chain::new(48_000);
        let e = Effects { echo: Echo { mix: 0.5, time_ms: 100.0, feedback: 0.0 }, ..Effects::default() };
        let mut v = vec![0.0; 2 * 9_600];
        v[0] = 1.0;
        v[1] = 1.0;
        c.process(&mut v, 2, &e);
        assert_eq!(v[2 * 4_800], 0.5);
        assert_eq!(v[2 * 4_799], 0.0);
    }

    #[test]
    fn compressor_tames_peaks_and_reverb_adds_a_tail() {
        let loud = |amount: f32| {
            let mut c = Chain::new(48_000);
            let mut out = tone(1_000.0, 1.0).iter().map(|x| x * 3.0).collect::<Vec<_>>();
            c.process(&mut out, 2, &Effects { compress: amount, ..Effects::default() });
            rms(&out[48_000..])
        };
        assert!(loud(1.0) < loud(0.0) * 0.7);
        let mut c = Chain::new(48_000);
        let mut v = tone(500.0, 0.2);
        v.extend(vec![0.0; 48_000 * 2]);
        c.process(&mut v, 2, &Effects { reverb: ReverbSettings { mix: 0.5, ..ReverbSettings::default() }, ..Effects::default() });
        // Still ringing half a second after the tone stopped.
        assert!(rms(&v[2 * 34_000..2 * 38_000]) > 0.001);
    }

    #[test]
    fn reverb_and_echo_keep_the_level() {
        let mut seed = 1u32;
        let noise: Vec<f32> = (0..48_000 * 4).flat_map(|_| {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let x = (seed >> 8) as f32 / (1u32 << 24) as f32 * 0.4 - 0.2;
            [x, x]
        }).collect();
        let change = |e: Effects| {
            let mut v = noise.clone();
            Chain::new(48_000).process(&mut v, 2, &e);
            20.0 * (rms(&v[2 * 96_000..]) / rms(&noise[2 * 96_000..])).log10()
        };
        for mix in [0.2, 0.35, 0.5, 1.0] {
            for size in [0.0, 0.5, 0.85, 1.0] {
                let db = change(Effects { reverb: ReverbSettings { mix, size, ..ReverbSettings::default() }, ..Effects::default() });
                assert!(db.abs() < 1.0, "reverb mix {mix} size {size}: {db:+.1} dB");
            }
        }
        let db = change(Effects { echo: Echo { mix: 0.6, time_ms: 300.0, feedback: 0.6 }, ..Effects::default() });
        assert!(db < 2.5, "echo: {db:+.1} dB");
    }
}
