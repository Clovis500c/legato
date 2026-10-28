//! A rodio source played through the live processing chain (`music-dsp`): frames pulled from the decoder, through the
//! Live Editor's speed / tempo / pitch stage and effects, then Adaptive Sound and the limiter, handed out sample by
//! sample. One per queued file; all share the player's `Control`, which also gets the song position (song time:
//! with a speed change, rodio's own count of samples played would be wrong).

use music_dsp::{Chain, Control, Effects, Processor, TimeStage};
use rodio::source::SeekError;
use rodio::{ChannelCount, SampleRate, Source};
use std::sync::Arc;
use std::time::Duration;

/// Frames per block: ~5 ms at 48 kHz, small enough that settings feel instant.
const BLOCK: usize = 256;
/// Frames read from the decoder at a time when the time stage wants more.
const FEED: usize = 1024;

pub struct Live<S: Source> {
    inner: S,
    proc: Processor,
    chain: Chain,
    stage: TimeStage,
    effects: Effects,
    effects_seen: u64,
    control: Arc<Control>,
    buf: Vec<f32>,
    feed: Vec<f32>,
    pos: usize,
    /// Decoder frames read so far (song time).
    read: u64,
    channels: ChannelCount,
    rate: SampleRate,
}

impl<S: Source> Live<S> {
    pub fn new(inner: S, control: Arc<Control>) -> Self {
        let (channels, rate) = (inner.channels(), inner.sample_rate());
        let ch = channels.get() as usize;
        Self {
            proc: Processor::new(rate.get(), ch),
            chain: Chain::new(rate.get()),
            stage: TimeStage::new(rate.get(), ch),
            effects: control.effects(),
            effects_seen: 0,
            inner,
            control,
            buf: Vec::with_capacity(BLOCK * 8),
            feed: Vec::with_capacity(FEED * 8),
            pos: 0,
            read: 0,
            channels,
            rate,
        }
    }

    /// Up to `frames` frames from the decoder into `out`; fewer = it ended.
    fn read(&mut self, frames: usize, out: &mut Vec<f32>) -> usize {
        let want = frames * self.proc.channels();
        let start = out.len();
        while out.len() - start < want {
            match self.inner.next() {
                Some(x) => out.push(x),
                None => break,
            }
        }
        let got = (out.len() - start) / self.proc.channels();
        self.read += got as u64;
        got
    }

    fn refill(&mut self) -> bool {
        if let Some((v, e)) = self.control.newer_effects(self.effects_seen) {
            self.effects_seen = v;
            self.proc.set_edited(!e.neutral());
            self.effects = e;
        }
        let ch = self.proc.channels();
        let mut buf = std::mem::take(&mut self.buf);
        buf.clear();
        self.pos = 0;
        let (time, pitch) = self.effects.rates();
        if self.stage.idle() && (time, pitch) == (1.0, 1.0) {
            self.read(BLOCK, &mut buf);
        } else {
            let mut feed = std::mem::take(&mut self.feed);
            let mut made = 0;
            while made < BLOCK {
                made += self.stage.pull(&mut buf, BLOCK - made, time, pitch);
                if made >= BLOCK || !self.stage.hungry() {
                    break;
                }
                feed.clear();
                if self.read(FEED, &mut feed) == 0 {
                    self.stage.finish();
                } else {
                    self.stage.push(&feed);
                }
            }
            self.feed = feed;
        }
        // Whole frames only; a ragged end (rare) goes out as is.
        let whole = buf.len() / ch * ch;
        let (frames, _) = buf.split_at_mut(whole);
        self.chain.process(frames, ch, &self.effects);
        self.proc.process(frames, &self.control);
        self.buf = buf;
        let heard = (self.read as f64 - self.stage.latency()).max(0.0);
        self.control.set_position_ms((heard * 1000.0 / self.rate.get() as f64) as u64);
        !self.buf.is_empty()
    }
}

impl<S: Source> Iterator for Live<S> {
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<f32> {
        if self.pos == self.buf.len() && !self.refill() {
            return None;
        }
        let x = self.buf[self.pos];
        self.pos += 1;
        Some(x)
    }
}

impl<S: Source> Source for Live<S> {
    fn current_span_len(&self) -> Option<usize> {
        // Decoders keep one format per file: the whole rest is one span.
        None
    }

    fn channels(&self) -> ChannelCount {
        self.channels
    }

    fn sample_rate(&self) -> SampleRate {
        self.rate
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    /// `pos` is song time.
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.inner.try_seek(pos)?;
        self.buf.clear();
        self.pos = 0;
        self.read = (pos.as_secs_f64() * self.rate.get() as f64) as u64;
        self.stage = TimeStage::new(self.rate.get(), self.proc.channels());
        self.chain.reset();
        self.proc.reset();
        self.control.set_position_ms(pos.as_millis() as u64);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use music_dsp::Live as Settings;
    use rodio::buffer::SamplesBuffer;
    use std::num::NonZero;

    fn source(n: usize) -> SamplesBuffer {
        let data: Vec<f32> = (0..n).map(|i| ((i / 2) as f32 * 0.01).sin() * 0.5).collect();
        SamplesBuffer::new(NonZero::new(2).unwrap(), NonZero::new(48_000).unwrap(), data)
    }

    #[test]
    fn passes_every_sample_through_untouched_when_off() {
        let control = Arc::new(Control::default());
        let a: Vec<f32> = source(10_001 * 2).collect();
        let b: Vec<f32> = Live::new(source(10_001 * 2), control.clone()).collect();
        assert_eq!(a, b);
        assert!(control.levels().peak > 0.4);
    }

    #[test]
    fn adaptive_sound_changes_the_level() {
        let control = Arc::new(Control::default());
        control.set(Settings { adaptive: true, target_lufs: -30.0, ..Settings::default() });
        let a: f32 = source(48_000 * 2 * 4).map(|x| x * x).sum();
        let b: f32 = Live::new(source(48_000 * 2 * 4), control).map(|x| x * x).sum();
        assert!(b < a * 0.8, "{b} vs {a}");
    }

    #[test]
    fn slowed_plays_longer_and_reports_song_time() {
        let control = Arc::new(Control::default());
        control.set_effects(Effects { speed: 0.8, ..Effects::default() });
        let out: Vec<f32> = Live::new(source(48_000 * 2), control.clone()).collect();
        let ratio = out.len() as f32 / (48_000 * 2) as f32;
        assert!((ratio - 1.25).abs() < 0.02, "{ratio}");
        // All of one second of song played: position near 1000 ms, not 1250.
        assert!((control.position_ms() as i64 - 1_000).abs() < 30, "{}", control.position_ms());
    }
}
