//! The chain one source plays through: meter, Adaptive Sound gain, peak limiter. Blocks of interleaved frames.
//!
//! Adaptive Sound (an automatic gain control): the gain heads for `target - short-term loudness`, clamped to
//! -12..+9 dB, moving slowly (a few seconds) so the music breathes instead of pumping, frozen in silence and quiet
//! passages (a fade-out is not brought up). A peak limiter right after keeps a boosted song from clipping.

use crate::control::{Control, Levels, Live};
use crate::{Meter, db_to_gain};

const MAX_CUT_DB: f32 = -12.0;
const MAX_BOOST_DB: f32 = 9.0;
/// Gain time constant, seconds; quicker while a song (or a seek) is new, so it settles in its first seconds.
const GLIDE_S: f32 = 2.5;
const GLIDE_START_S: f32 = 0.6;
const START_S: f32 = 3.0;
/// Below this short-term loudness the gain holds (silence, fade-outs, intros).
const HOLD_BELOW_LUFS: f32 = -45.0;
const CEILING: f32 = 0.97;
/// Limiter release, seconds.
const RELEASE_S: f32 = 0.12;
/// Levels sent this often, seconds.
const REPORT_S: f32 = 0.02;

#[derive(Debug, Clone)]
pub struct Processor {
    channels: usize,
    meter: Meter,
    live: Live,
    seen: u64,
    /// Adaptive gain now, dB.
    gain_db: f32,
    glide: f32,
    glide_start: f32,
    /// Nothing processed yet: the gain starts where the last song's ended.
    fresh: bool,
    /// Limiter gain now, 0..1.
    limit: f32,
    release: f32,
    since_report: usize,
    report_every: usize,
}

impl Processor {
    pub fn new(rate: u32, channels: usize) -> Self {
        let r = rate as f32;
        Self {
            channels: channels.max(1),
            meter: Meter::new(r, channels.max(1)),
            live: Live::default(),
            seen: 0,
            gain_db: 0.0,
            glide: 1.0 - (-1.0 / (GLIDE_S * r)).exp(),
            glide_start: 1.0 - (-1.0 / (GLIDE_START_S * r)).exp(),
            fresh: true,
            limit: 1.0,
            release: 1.0 - (-1.0 / (RELEASE_S * r)).exp(),
            since_report: 0,
            report_every: (REPORT_S * r) as usize,
        }
    }

    pub fn channels(&self) -> usize {
        self.channels
    }

    /// Where the gain wants to go now.
    fn wanted_db(&self) -> f32 {
        if !self.live.adaptive {
            return 0.0;
        }
        // Silence or a quiet passage right now (momentary): hold, the 3 s average still remembers the music.
        if self.meter.momentary_lufs() < HOLD_BELOW_LUFS {
            return self.gain_db;
        }
        (self.live.target_lufs - self.meter.short_lufs()).clamp(MAX_CUT_DB, MAX_BOOST_DB)
    }

    /// Processes `block` (whole interleaved frames) in place.
    pub fn process(&mut self, block: &mut [f32], control: &Control) {
        if let Some((v, live)) = control.newer(self.seen) {
            self.seen = v;
            self.live = live;
        }
        if std::mem::take(&mut self.fresh) && self.live.adaptive {
            self.gain_db = control.last_gain().unwrap_or(0.0).clamp(MAX_CUT_DB, MAX_BOOST_DB);
        }
        for frame in block.chunks_exact_mut(self.channels) {
            self.meter.frame(frame);
            let glide = if self.meter.heard_s() < START_S { self.glide_start } else { self.glide };
            self.gain_db += (self.wanted_db() - self.gain_db) * glide;
            let g = db_to_gain(self.gain_db);
            let peak = frame.iter().fold(0f32, |m, x| m.max((x * g).abs()));
            // Limiter, only while boosting (a cut can't clip; untouched otherwise): down at once, back up slowly.
            let need = if g > 1.0 && peak > CEILING { CEILING / peak } else { 1.0 };
            self.limit = if need < self.limit { need } else { self.limit + (1.0 - self.limit) * self.release };
            let total = g * self.limit;
            frame.iter_mut().for_each(|x| *x *= total);
            self.since_report += 1;
            if self.since_report >= self.report_every {
                self.since_report = 0;
                control.report(Levels { fast: self.meter.fast_lufs(), momentary: self.meter.momentary_lufs(), short: self.meter.short_lufs(), peak: self.meter.peak(), gain: self.gain_db });
            }
        }
    }

    /// After a seek: loudness measured again from there (the gain keeps its place).
    pub fn reset(&mut self) {
        self.meter.reset();
        self.limit = 1.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gain_to_db;

    fn tone(amp: f32, secs: f32, rate: u32) -> Vec<f32> {
        (0..(secs * rate as f32) as usize).flat_map(|i| {
            let x = amp * (2.0 * std::f32::consts::PI * 1_000.0 * i as f32 / rate as f32).sin();
            [x, x]
        }).collect()
    }

    fn rms(v: &[f32]) -> f32 {
        (v.iter().map(|x| x * x).sum::<f32>() / v.len() as f32).sqrt()
    }

    #[test]
    fn off_leaves_the_sound_alone() {
        let c = Control::default();
        let mut p = Processor::new(48_000, 2);
        // Full scale: the limiter stays out of it too.
        let src = tone(1.0, 1.0, 48_000);
        let mut out = src.clone();
        p.process(&mut out, &c);
        assert_eq!(out, src);
        assert!(c.levels().momentary > -10.0);
    }

    #[test]
    fn quiet_and_loud_songs_end_up_alike() {
        let c = Control::default();
        c.set(Live { adaptive: true, target_lufs: -14.0 });
        let level = |amp: f32| {
            let mut p = Processor::new(48_000, 2);
            let mut out = tone(amp, 20.0, 48_000);
            p.process(&mut out, &c);
            gain_to_db(rms(&out[out.len() - 48_000..]))
        };
        let (quiet, loud) = (level(0.05), level(0.6));
        // 21.6 dB apart at the source; about 3.5 once adapted (the boost stops at +9 dB).
        assert!((loud - quiet).abs() < 4.0, "loud {loud} quiet {quiet}");
        assert!(level(0.6) <= gain_to_db(CEILING));
    }

    #[test]
    fn never_clips_while_boosting() {
        let c = Control::default();
        c.set(Live { adaptive: true, target_lufs: -6.0 });
        let mut p = Processor::new(48_000, 2);
        let mut out = tone(0.9, 10.0, 48_000);
        p.process(&mut out, &c);
        assert!(out.iter().all(|x| x.abs() <= 1.0));
    }

    #[test]
    fn settles_within_the_first_seconds_and_carries_on() {
        let c = Control::default();
        c.set(Live { adaptive: true, target_lufs: -14.0 });
        let mut p = Processor::new(48_000, 2);
        let mut quiet = tone(0.05, 2.0, 48_000);
        p.process(&mut quiet, &c);
        // About -26 LUFS: wants the full +9 dB, nearly there after 2 s.
        assert!(p.gain_db > 7.5, "{}", p.gain_db);
        // Next song: starts from there, not from 0.
        let mut next = Processor::new(48_000, 2);
        let mut first = tone(0.05, 0.01, 48_000);
        next.process(&mut first, &c);
        assert!(next.gain_db > 7.5, "{}", next.gain_db);
    }

    #[test]
    fn silence_holds_the_gain() {
        let c = Control::default();
        c.set(Live { adaptive: true, target_lufs: -14.0 });
        let mut p = Processor::new(48_000, 2);
        let mut quiet = tone(0.1, 10.0, 48_000);
        p.process(&mut quiet, &c);
        let before = p.gain_db;
        let mut silence = vec![0.0; 48_000 * 2 * 5];
        p.process(&mut silence, &c);
        assert!((p.gain_db - before).abs() < 1.5, "{} → {}", before, p.gain_db);
    }
}
