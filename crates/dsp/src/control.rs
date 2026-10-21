//! What the UI sets and reads, shared with the audio thread: settings go in behind a version number (the audio thread
//! looks with try_lock, never waits), levels come out the same way.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

/// Live processing settings.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Live {
    /// Adaptive Sound: every song brought to the same loudness, then the volume knob on top.
    pub adaptive: bool,
    /// Loudness songs are brought to, LUFS (streaming services use about -14).
    pub target_lufs: f32,
}

impl Default for Live {
    fn default() -> Self {
        Self { adaptive: false, target_lufs: -14.0 }
    }
}

impl Live {
    /// Trust boundary: values from the UI kept in range.
    pub fn clamped(self) -> Self {
        Self { target_lufs: if self.target_lufs.is_finite() { self.target_lufs.clamp(-30.0, -6.0) } else { -14.0 }, ..self }
    }
}

/// What plays now, as heard.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
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
}

#[derive(Debug, Default)]
pub struct Control {
    live: Mutex<Live>,
    version: AtomicU64,
    levels: Mutex<Levels>,
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

    /// Nothing plays: the meters fall to rest.
    pub fn quiet(&self) {
        *self.levels.lock().unwrap() = Levels { fast: -120.0, momentary: -120.0, short: -120.0, peak: 0.0, gain: 0.0 };
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
        c.set(Live { adaptive: true, target_lufs: -50.0 });
        let (v, live) = c.newer(0).unwrap();
        assert!(live.adaptive);
        assert_eq!(live.target_lufs, -30.0);
        assert!(c.newer(v).is_none());
        assert_eq!(Live { target_lufs: f32::NAN, ..Live::default() }.clamped().target_lufs, -14.0);
    }
}
