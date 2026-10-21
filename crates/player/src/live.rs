//! A rodio source played through the live processing chain (`music-dsp`): blocks of frames pulled from the decoder,
//! processed, handed out sample by sample. One per queued file; all share the player's `Control`.

use music_dsp::{Control, Processor};
use rodio::source::SeekError;
use rodio::{ChannelCount, SampleRate, Source};
use std::sync::Arc;
use std::time::Duration;

/// Frames per block: ~5 ms at 48 kHz, small enough that settings feel instant.
const BLOCK: usize = 256;

pub struct Live<S: Source> {
    inner: S,
    proc: Processor,
    control: Arc<Control>,
    buf: Vec<f32>,
    pos: usize,
    channels: ChannelCount,
    rate: SampleRate,
}

impl<S: Source> Live<S> {
    pub fn new(inner: S, control: Arc<Control>) -> Self {
        let (channels, rate) = (inner.channels(), inner.sample_rate());
        Self { proc: Processor::new(rate.get(), channels.get() as usize), inner, control, buf: Vec::with_capacity(BLOCK * 8), pos: 0, channels, rate }
    }

    fn refill(&mut self) -> bool {
        self.buf.clear();
        self.pos = 0;
        let want = BLOCK * self.proc.channels();
        while self.buf.len() < want {
            match self.inner.next() {
                Some(x) => self.buf.push(x),
                None => break,
            }
        }
        // Whole frames only; a ragged end (rare) goes out as is.
        let whole = self.buf.len() / self.proc.channels() * self.proc.channels();
        let (frames, _) = self.buf.split_at_mut(whole);
        self.proc.process(frames, &self.control);
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

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.inner.try_seek(pos)?;
        self.buf.clear();
        self.pos = 0;
        self.proc.reset();
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
        control.set(Settings { adaptive: true, target_lufs: -30.0 });
        let a: f32 = source(48_000 * 2 * 4).map(|x| x * x).sum();
        let b: f32 = Live::new(source(48_000 * 2 * 4), control).map(|x| x * x).sum();
        assert!(b < a * 0.8, "{b} vs {a}");
    }
}
