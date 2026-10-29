//! Live Editor settings: what a song goes through, as numbers only (saved per song in SQLite, never audio). The same
//! settings drive the native chain (`chain.rs`, `stretch.rs`) and the YouTube player's (crates/shield live.js).

use serde::{Deserialize, Deserializer, Serialize};

/// Equalizer bands, an octave apart: low shelf, eight peaks, high shelf.
pub const EQ_FREQS: [f32; 10] = [32.0, 64.0, 125.0, 250.0, 500.0, 1_000.0, 2_000.0, 4_000.0, 8_000.0, 16_000.0];
/// Peak width for octave spacing.
pub const EQ_Q: f32 = 1.41;
/// Bands before 2026-10-29 (5 gains in older saved edits).
const OLD_EQ: [f32; 5] = [60.0, 250.0, 1_000.0, 4_000.0, 12_000.0];

/// Saved gains onto the 10 bands. 5 = an older edit: its curve read at the new bands (straight lines over log
/// frequency, flat past the ends). Same in effects.ts and live.js.
pub fn eq_from(gains: &[f32]) -> [f32; 10] {
    if gains.len() != OLD_EQ.len() {
        return std::array::from_fn(|i| gains.get(i).copied().unwrap_or(0.0));
    }
    EQ_FREQS.map(|f| match OLD_EQ.iter().position(|o| *o > f) {
        Some(0) => gains[0],
        None => gains[4],
        Some(i) => {
            let t = (f / OLD_EQ[i - 1]).log2() / (OLD_EQ[i] / OLD_EQ[i - 1]).log2();
            gains[i - 1] + t * (gains[i] - gains[i - 1])
        }
    })
}

fn eq_de<'de, D: Deserializer<'de>>(d: D) -> Result<[f32; 10], D::Error> {
    Ok(eq_from(&Vec::<f32>::deserialize(d)?))
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Reverb {
    /// Wet share, 0..1 (0 = off).
    pub mix: f32,
    /// Room size, 0..1.
    pub size: f32,
    /// High frequencies dying faster, 0..1.
    pub damping: f32,
    /// Before the first reflection, ms (0..100).
    pub predelay_ms: f32,
}

impl Default for Reverb {
    fn default() -> Self {
        Self { mix: 0.0, size: 0.7, damping: 0.4, predelay_ms: 20.0 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Echo {
    /// Wet share, 0..1 (0 = off).
    pub mix: f32,
    /// Between repeats, ms (50..1000).
    pub time_ms: f32,
    /// Each repeat's share of the last, 0..0.85.
    pub feedback: f32,
}

impl Default for Echo {
    fn default() -> Self {
        Self { mix: 0.0, time_ms: 300.0, feedback: 0.3 }
    }
}

/// 3D / 8D: the song as one sound placed around the listener's head (binaural, for headphones).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Space {
    pub on: bool,
    /// Degrees, 0 = ahead, 90 = right, -90 = left, ±180 = behind.
    pub azimuth: f32,
    /// Degrees, -40 (below) .. 40 (above).
    pub elevation: f32,
    /// 0.5 (close) .. 3 (far).
    pub distance: f32,
    /// 8D: goes round the head.
    pub rotate: bool,
    /// Seconds per turn, 2..30.
    pub period_s: f32,
    /// Room around the sound, 0..1.
    pub room: f32,
}

impl Default for Space {
    fn default() -> Self {
        Self { on: false, azimuth: 0.0, elevation: 0.0, distance: 1.0, rotate: false, period_s: 8.0, room: 0.2 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Effects {
    /// Off = bypassed (A/B), settings kept.
    pub on: bool,
    /// Speed with pitch (slowed, nightcore), 0.5..1.5.
    pub speed: f32,
    /// Speed, pitch kept, 0.5..1.5.
    pub tempo: f32,
    /// Pitch in semitones, speed kept, -12..12.
    pub pitch: f32,
    /// Bass boost, dB 0..24.
    pub bass: f32,
    /// dB per band (`EQ_FREQS`), -24..24.
    #[serde(deserialize_with = "eq_de")]
    pub eq: [f32; 10],
    pub reverb: Reverb,
    pub echo: Echo,
    pub space: Space,
    /// Compressor amount, 0..1 (0 = off).
    pub compress: f32,
    /// Stereo width, 0 (mono) .. 3.
    pub width: f32,
    /// -1 (left) .. 1 (right).
    pub balance: f32,
}

impl Default for Effects {
    fn default() -> Self {
        Self { on: true, speed: 1.0, tempo: 1.0, pitch: 0.0, bass: 0.0, eq: [0.0; 10], reverb: Reverb::default(), echo: Echo::default(), space: Space::default(), compress: 0.0, width: 1.0, balance: 0.0 }
    }
}

fn fit(v: f32, lo: f32, hi: f32, def: f32) -> f32 {
    if v.is_finite() { v.clamp(lo, hi) } else { def }
}

impl Effects {
    /// Trust boundary: values from the UI or a saved edit kept in range.
    pub fn clamped(self) -> Self {
        let d = Self::default();
        Self {
            on: self.on,
            speed: fit(self.speed, 0.25, 2.5, 1.0),
            tempo: fit(self.tempo, 0.25, 2.5, 1.0),
            pitch: fit(self.pitch, -24.0, 24.0, 0.0),
            bass: fit(self.bass, 0.0, 24.0, 0.0),
            eq: self.eq.map(|g| fit(g, -24.0, 24.0, 0.0)),
            reverb: Reverb {
                mix: fit(self.reverb.mix, 0.0, 1.0, 0.0),
                size: fit(self.reverb.size, 0.0, 1.0, d.reverb.size),
                damping: fit(self.reverb.damping, 0.0, 1.0, d.reverb.damping),
                predelay_ms: fit(self.reverb.predelay_ms, 0.0, 250.0, d.reverb.predelay_ms),
            },
            echo: Echo { mix: fit(self.echo.mix, 0.0, 1.0, 0.0), time_ms: fit(self.echo.time_ms, 20.0, 2_000.0, d.echo.time_ms), feedback: fit(self.echo.feedback, 0.0, 0.95, d.echo.feedback) },
            space: Space {
                on: self.space.on,
                azimuth: fit(self.space.azimuth, -180.0, 180.0, 0.0),
                elevation: fit(self.space.elevation, -90.0, 90.0, 0.0),
                distance: fit(self.space.distance, 0.25, 10.0, 1.0),
                rotate: self.space.rotate,
                period_s: fit(self.space.period_s, 1.0, 60.0, d.space.period_s),
                room: fit(self.space.room, 0.0, 1.0, d.space.room),
            },
            compress: fit(self.compress, 0.0, 1.0, 0.0),
            width: fit(self.width, 0.0, 3.0, 1.0),
            balance: fit(self.balance, -1.0, 1.0, 0.0),
        }
    }

    /// Timeline speed and pitch ratio it adds up to: (time, pitch). (1, 1) = untouched.
    pub fn rates(&self) -> (f32, f32) {
        if !self.on {
            return (1.0, 1.0);
        }
        // ×0.25 to ×4 each: what the stretcher takes (live.js and effects.ts alike).
        ((self.speed * self.tempo).clamp(0.25, 4.0), (self.speed * 2f32.powf(self.pitch / 12.0)).clamp(0.25, 4.0))
    }

    /// Nothing changes the sound (or bypassed): samples go through untouched.
    pub fn neutral(&self) -> bool {
        !self.on || (self.rates() == (1.0, 1.0) && self.after_time_neutral())
    }

    /// The effects after the speed / pitch stage change nothing.
    pub fn after_time_neutral(&self) -> bool {
        !self.on
            || (self.bass == 0.0
                && self.eq.iter().all(|g| *g == 0.0)
                && self.reverb.mix == 0.0
                && self.echo.mix == 0.0
                && !self.space.on
                && self.compress == 0.0
                && self.width == 1.0
                && self.balance == 0.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_neutral_and_values_are_kept_in_range() {
        assert!(Effects::default().neutral());
        let e = Effects { speed: 9.0, pitch: f32::NAN, eq: [99.0, -99.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], echo: Echo { feedback: 2.0, ..Echo::default() }, ..Effects::default() }.clamped();
        assert_eq!((e.speed, e.pitch, e.eq[0], e.eq[1], e.echo.feedback), (2.5, 0.0, 24.0, -24.0, 0.95));
        assert!(!e.neutral());
        assert!(Effects { on: false, ..e }.neutral());
    }

    #[test]
    fn speed_tempo_and_pitch_add_up() {
        let slowed = Effects { speed: 0.8, ..Effects::default() };
        assert_eq!(slowed.rates(), (0.8, 0.8));
        let tempo = Effects { tempo: 1.25, ..Effects::default() };
        assert_eq!(tempo.rates(), (1.25, 1.0));
        let (t, p) = Effects { pitch: 12.0, ..Effects::default() }.rates();
        assert_eq!(t, 1.0);
        assert!((p - 2.0).abs() < 1e-6);
        // Saved edits from the UI: missing fields take defaults.
        let e: Effects = serde_json::from_str(r#"{"speed":0.85,"reverb":{"mix":0.3}}"#).unwrap();
        assert_eq!((e.speed, e.reverb.mix, e.reverb.size, e.on), (0.85, 0.3, 0.7, true));
    }

    #[test]
    fn older_five_band_edits_keep_their_curve() {
        let e: Effects = serde_json::from_str(r#"{"eq":[6,0,-6,0,12]}"#).unwrap();
        // 32 and 64 Hz: under the old 60 Hz shelf, flat; 250 / 1k / 4k: the old bands themselves; 16k: past the end.
        assert_eq!((e.eq[0], e.eq[3], e.eq[5], e.eq[7], e.eq[9]), (6.0, 0.0, -6.0, 0.0, 12.0));
        assert!((e.eq[1] - 5.73).abs() < 0.05, "{}", e.eq[1]);
        assert!((e.eq[4] + 3.0).abs() < 1e-4 && (e.eq[8] - 7.57).abs() < 0.05, "{:?}", e.eq);
        let ten: Effects = serde_json::from_str(r#"{"eq":[1,2,3,4,5,6,7,8,9,10]}"#).unwrap();
        assert_eq!(ten.eq[9], 10.0);
    }
}
