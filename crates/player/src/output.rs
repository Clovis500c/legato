//! Where the engine's sound goes: the default output device. The smoke test's build (feature `null-output`, src-tauri
//! `e2e`) has no device at all: a thread drains the mixer at the pace of a real one, so a song still decodes, goes through
//! the live chain and moves its position, on a CI runner without a sound card and silently on a dev PC. No other build
//! takes that path.

use anyhow::Result;
use rodio::mixer::{Mixer, mixer};
use rodio::{ChannelCount, DeviceSinkBuilder, MixerDeviceSink, SampleRate};
use std::num::NonZero;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

const CHANNELS: ChannelCount = NonZero::new(2).unwrap();
const RATE: SampleRate = NonZero::new(44_100).unwrap();
/// One round of the null output: 20 ms of audio.
const ROUND: Duration = Duration::from_millis(20);
const ROUND_SAMPLES: usize = 882 * 2;

/// The mixer the engine plays into.
pub enum Output {
    Device(MixerDeviceSink),
    Null(Null),
}

impl Output {
    /// The default output device; the silent one in the smoke test's build.
    pub fn open() -> Result<Self> {
        if cfg!(feature = "null-output") {
            return Ok(Self::Null(Null::open()));
        }
        Ok(Self::Device(DeviceSinkBuilder::open_default_sink()?))
    }

    pub fn mixer(&self) -> &Mixer {
        match self {
            Self::Device(device) => device.mixer(),
            Self::Null(null) => &null.mixer,
        }
    }
}

/// A mixer drained by a thread on the wall clock, 20 ms of samples every 20 ms, what a device's callback does. Dropping
/// it stops the thread.
pub struct Null {
    mixer: Mixer,
    stop: Arc<AtomicBool>,
}

impl Null {
    pub fn open() -> Self {
        let (mixer, mut source) = mixer(CHANNELS, RATE);
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        std::thread::spawn(move || {
            let start = Instant::now();
            let mut rounds = 0u32;
            while !flag.load(Ordering::Relaxed) {
                // Nothing mixed in yet answers None: silence, as for a device.
                for _ in 0..ROUND_SAMPLES {
                    let _ = source.next();
                }
                rounds += 1;
                // Due times from the start, not from now: a late round is made up, the pace does not drift.
                std::thread::sleep((start + ROUND * rounds).saturating_duration_since(Instant::now()));
            }
        });
        Self { mixer, stop }
    }
}

impl Drop for Null {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;

    /// Half a second of audio takes half a second to drain: a song's position follows the clock, not the CPU.
    #[test]
    fn null_output_drains_at_the_pace_of_a_device() {
        let out = Null::open();
        let player = rodio::Player::connect_new(&out.mixer);
        player.append(SamplesBuffer::new(CHANNELS, RATE, vec![0.0; 44_100]));
        let start = Instant::now();
        player.sleep_until_end();
        let took = start.elapsed();
        assert!(took >= Duration::from_millis(400), "drained too fast: {took:?}");
        assert!(took < Duration::from_secs(3), "drained too slowly: {took:?}");
    }

    #[test]
    fn dropping_the_null_output_stops_its_thread() {
        let out = Null::open();
        let stop = out.stop.clone();
        drop(out);
        assert!(stop.load(Ordering::Relaxed));
    }
}
