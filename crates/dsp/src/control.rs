//! What the UI sets and reads, shared with the audio thread: settings go in behind a version number (the audio thread
//! looks with try_lock, never waits), levels come out the same way.

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};

/// Live processing settings.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, rename = "LiveSettings")]
pub struct Live {
    /// Adaptive Sound: every song brought to the same loudness, then the volume knob on top.
    pub adaptive: bool,
    /// Loudness songs are brought to, LUFS (streaming services use about -14).
    pub target_lufs: f32,
    /// The app fades the song out now: Adaptive Sound holds its gain (the fade is the app's).
    pub ending: bool,
    /// The visualizer wants the bands (`Levels::bands`; -120 when off, the filters skipped).
    pub bands: bool,
}

impl Default for Live {
    fn default() -> Self {
        Self { adaptive: false, target_lufs: -14.0, ending: false, bands: false }
    }
}

impl Live {
    /// Trust boundary: values from the UI kept in range.
    pub fn clamped(self) -> Self {
        Self { target_lufs: if self.target_lufs.is_finite() { self.target_lufs.clamp(-30.0, -6.0) } else { -14.0 }, ..self }
    }
}

/// What plays now, as heard.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "PlayerLevels")]
pub struct Levels {
    /// Loudness over the last 50 ms (beats: the moving cover), LUFS.
    pub fast: f32,
    /// Over the last 400 ms, LUFS.
    pub momentary: f32,
    /// Over the last 3 s (Adaptive Sound), LUFS.
    pub short: f32,
    /// Sample peak, 0..1 (falls about 20 dB a second).
    pub peak: f32,
    /// Gain Adaptive Sound applies, dB (0 when off).
    pub gain: f32,
    /// Visualizer: dB per band (`spectrum::center`).
    #[ts(as = "Vec<f32>")]
    pub bands: [f32; crate::spectrum::BANDS],
}

#[derive(Debug, Default)]
pub struct Control {
    live: Mutex<Live>,
    version: AtomicU64,
    levels: Mutex<Levels>,
    /// Live Editor settings, same handover as `live`.
    effects: Mutex<crate::Effects>,
    effects_version: AtomicU64,
    /// Where the playing song is, ms of the song itself (not of what played: speed changes count).
    position_ms: AtomicU64,
    /// A copy of what plays for the visualizer's FFT (`viz`), filled only while someone listens.
    tap: Arc<crate::tap::Tap>,
}

impl Control {
    pub fn set(&self, live: Live) {
        *self.live.lock().unwrap() = live.clamped();
        self.version.fetch_add(1, Ordering::Release);
    }

    pub fn get(&self) -> Live {
        *self.live.lock().unwrap()
    }

    pub fn levels(&self) -> Levels {
        *self.levels.lock().unwrap()
    }

    /// Audio thread: settings newer than `seen`, if they can be read without waiting.
    pub(crate) fn newer(&self, seen: u64) -> Option<(u64, Live)> {
        let v = self.version.load(Ordering::Acquire);
        if v == seen {
            return None;
        }
        self.live.try_lock().ok().map(|l| (v, *l))
    }

    /// Audio thread: levels out, skipped if the UI is reading right now.
    pub(crate) fn report(&self, levels: Levels) {
        if let Ok(mut l) = self.levels.try_lock() {
            *l = levels;
        }
    }

    /// Live Editor settings for what plays (and what follows, until changed).
    pub fn set_effects(&self, effects: crate::Effects) {
        *self.effects.lock().unwrap() = effects.clamped();
        self.effects_version.fetch_add(1, Ordering::Release);
    }

    pub fn effects(&self) -> crate::Effects {
        *self.effects.lock().unwrap()
    }

    /// Audio thread: effects newer than `seen`, if readable without waiting.
    pub fn newer_effects(&self, seen: u64) -> Option<(u64, crate::Effects)> {
        let v = self.effects_version.load(Ordering::Acquire);
        if v == seen {
            return None;
        }
        self.effects.try_lock().ok().map(|e| (v, *e))
    }

    /// The sound as played, copied for the visualizer.
    pub fn tap(&self) -> &Arc<crate::tap::Tap> {
        &self.tap
    }

    pub fn set_position_ms(&self, ms: u64) {
        self.position_ms.store(ms, Ordering::Relaxed);
    }

    pub fn position_ms(&self) -> u64 {
        self.position_ms.load(Ordering::Relaxed)
    }

    /// Nothing plays: the meters fall to rest.
    pub fn quiet(&self) {
        *self.levels.lock().unwrap() = Levels { fast: -120.0, momentary: -120.0, short: -120.0, peak: 0.0, gain: 0.0, bands: [-120.0; crate::spectrum::BANDS] };
    }

    /// Audio thread: Adaptive Sound's gain at the end of the last song (the next one starts there), if readable now.
    pub(crate) fn last_gain(&self) -> Option<f32> {
        self.levels.try_lock().ok().map(|l| l.gain)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_reach_the_audio_side_once() {
        let c = Control::default();
        assert!(c.newer(0).is_none());
        c.set(Live { adaptive: true, target_lufs: -50.0, ..Live::default() });
        let (v, live) = c.newer(0).unwrap();
        assert!(live.adaptive);
        assert_eq!(live.target_lufs, -30.0);
        assert!(c.newer(v).is_none());
        assert_eq!(Live { target_lufs: f32::NAN, ..Live::default() }.clamped().target_lufs, -14.0);
    }
}
