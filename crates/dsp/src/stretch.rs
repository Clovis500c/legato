//! Speed, tempo and pitch, streaming. Two steps: WSOLA changes the tempo and keeps the pitch (overlapping Hann
//! windows, each placed where it matches the last one best: no phasing), then a cubic resampler changes both (speed,
//! slowed / nightcore). Pitch alone = WSOLA by 1/p then resampling by p. Ideas from Audacity's and SoundTouch's time
//! stretchers; written from scratch.
//!
//! Feed decoded frames with `push`, take processed ones with `pull`. Rates may change between pulls.

use std::collections::VecDeque;

/// Interleaved frames waiting in a buffer, with the absolute index of the first one.
struct Frames {
    data: VecDeque<f32>,
    channels: usize,
    start: u64,
}

impl Frames {
    fn len(&self) -> u64 {
        (self.data.len() / self.channels) as u64
    }

    fn end(&self) -> u64 {
        self.start + self.len()
    }

    /// Sample at absolute frame `i`, channel `c` (0 outside).
    #[inline]
    fn at(&self, i: i64, c: usize) -> f32 {
        if i < self.start as i64 || i >= self.end() as i64 {
            return 0.0;
        }
        self.data[(i as u64 - self.start) as usize * self.channels + c]
    }

    /// Mono fold of frame `i`.
    #[inline]
    fn mono(&self, i: i64) -> f32 {
        (0..self.channels).map(|c| self.at(i, c)).sum()
    }

    fn drop_before(&mut self, frame: u64) {
        if frame > self.start {
            let n = ((frame - self.start).min(self.len()) as usize) * self.channels;
            self.data.drain(..n);
            self.start += (n / self.channels) as u64;
        }
    }
}

struct Wsola {
    n: usize,
    hop: usize,
    search: i64,
    window: Vec<f32>,
    input: Frames,
    /// Where the next window is meant to start (input frames).
    nominal: f64,
    /// Start of the last window placed.
    prev: Option<i64>,
    /// Overlap-add buffer, `n` frames.
    ola: Vec<f32>,
    ended: bool,
    /// Input end reached and the tail written out.
    done: bool,
}

impl Wsola {
    fn new(rate: u32, channels: usize) -> Self {
        // About 40 ms windows, a power of two.
        let n = ((rate as f32 * 0.04) as usize).next_power_of_two().clamp(256, 4096);
        let window = (0..n).map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / n as f32).cos()).collect();
        Self { n, hop: n / 2, search: (n / 4) as i64, window, input: Frames { data: VecDeque::new(), channels, start: 0 }, nominal: 0.0, prev: None, ola: vec![0.0; n * channels], ended: false, done: false }
    }

    /// Best start near `around` to follow on from `target` (normalized cross-correlation, coarse then fine).
    fn best(&self, around: i64, target: i64) -> i64 {
        let lo = (around - self.search).max(self.input.start as i64);
        let hi = around + self.search;
        let overlap = self.hop as i64;
        let score = |k: i64, step: i64| {
            let (mut dot, mut energy) = (0.0f32, 1e-9f32);
            let mut j = 0;
            while j < overlap {
                let a = self.input.mono(k + j);
                dot += a * self.input.mono(target + j);
                energy += a * a;
                j += step;
            }
            dot / energy.sqrt()
        };
        let mut best = (around.max(lo), f32::MIN);
        let mut k = lo;
        while k <= hi {
            let s = score(k, 8);
            if s > best.1 {
                best = (k, s);
            }
            k += 4;
        }
        let coarse = best.0;
        let mut fine = (coarse, f32::MIN);
        for k in (coarse - 4).max(lo)..=(coarse + 4).min(hi) {
            let s = score(k, 2);
            if s > fine.1 {
                fine = (k, s);
            }
        }
        fine.0
    }

    /// One window placed, `hop` frames out. None: needs more input.
    fn step(&mut self, tempo: f64, out: &mut VecDeque<f32>) -> bool {
        if self.done {
            return false;
        }
        let ch = self.input.channels;
        let around = self.nominal.round() as i64;
        let target = self.prev.map(|p| p + self.hop as i64);
        let reach = around + self.search + self.n as i64;
        if !self.ended && (self.input.end() as i64) < reach.max(target.unwrap_or(0) + self.n as i64) {
            return false;
        }
        if self.ended && around >= self.input.end() as i64 + self.hop as i64 {
            // Tail: what's left in the overlap buffer.
            out.extend(self.ola.drain(..self.hop * ch));
            self.done = true;
            return true;
        }
        let k = match target {
            Some(t) => self.best(around, t),
            None => around,
        };
        for i in 0..self.n {
            let w = self.window[i];
            for c in 0..ch {
                self.ola[i * ch + c] += self.input.at(k + i as i64, c) * w;
            }
        }
        out.extend(self.ola.drain(..self.hop * ch));
        self.ola.extend(std::iter::repeat_n(0.0, self.hop * ch));
        self.prev = Some(k);
        self.nominal += self.hop as f64 * tempo;
        let keep = (self.nominal.round() as i64 - self.search).min(k + self.hop as i64).max(0) as u64;
        self.input.drop_before(keep);
        true
    }

    /// Input frames not yet turned into output (for the playing position).
    fn behind(&self) -> f64 {
        (self.input.end() as f64 - self.nominal).max(0.0)
    }
}

struct Resampler {
    buf: Frames,
    /// Read position, fractional frames from `buf.start`.
    pos: f64,
}

impl Resampler {
    fn new(channels: usize) -> Self {
        // One silent frame before the first: the cubic needs a point behind.
        Self { buf: Frames { data: std::iter::repeat_n(0.0, channels).collect(), channels, start: 0 }, pos: 1.0 }
    }

    /// Frames out at `ratio` (2 = twice as fast and an octave up) while input lasts.
    fn run(&mut self, ratio: f64, out: &mut Vec<f32>, want: usize, ended: bool) -> usize {
        let ch = self.buf.channels;
        let mut made = 0;
        while made < want {
            let i = self.pos.floor() as i64;
            let have = self.buf.len() as i64;
            if i + 2 >= have && !ended {
                break;
            }
            if i >= have {
                break;
            }
            let t = (self.pos - i as f64) as f32;
            let s = self.buf.start as i64;
            for c in 0..ch {
                let p = |k: i64| self.buf.at(s + i + k, c);
                let (p0, p1, p2, p3) = (p(-1), p(0), p(1), p(2));
                // Catmull-Rom.
                let y = p1 + 0.5 * t * (p2 - p0 + t * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + t * (3.0 * (p1 - p2) + p3 - p0)));
                out.push(y);
            }
            made += 1;
            self.pos += ratio;
            let drop = (self.pos.floor() as i64 - 1).max(0);
            if drop > 0 {
                self.buf.drop_before(self.buf.start + drop as u64);
                self.pos -= drop as f64;
            }
        }
        made
    }

    fn behind(&self) -> f64 {
        (self.buf.len() as f64 - self.pos).max(0.0)
    }
}

/// Speed / tempo / pitch for one stream. Stays engaged once rates moved off 1 (no jump when they come back).
pub struct TimeStage {
    channels: usize,
    wsola: Wsola,
    resampler: Resampler,
    middle: VecDeque<f32>,
    stretching: bool,
    resampling: bool,
    /// Last tempo factor of the WSOLA step, for the position estimate.
    tempo: f64,
}

impl TimeStage {
    pub fn new(rate: u32, channels: usize) -> Self {
        let ch = channels.max(1);
        Self { channels: ch, wsola: Wsola::new(rate, ch), resampler: Resampler::new(ch), middle: VecDeque::new(), stretching: false, resampling: false, tempo: 1.0 }
    }

    /// Nothing engaged yet: the caller may pass samples straight through.
    pub fn idle(&self) -> bool {
        !self.stretching && !self.resampling
    }

    pub fn push(&mut self, frames: &[f32]) {
        self.wsola.input.data.extend(frames);
    }

    pub fn finish(&mut self) {
        self.wsola.ended = true;
    }

    /// Wants input: what's buffered can't make `want` more frames.
    pub fn hungry(&self) -> bool {
        !self.wsola.ended
    }

    /// Up to `want` frames into `out` at (time, pitch) rates (`Effects::rates`). Returns frames made; fewer than
    /// asked = push more (or the stream is over).
    pub fn pull(&mut self, out: &mut Vec<f32>, want: usize, time: f32, pitch: f32) -> usize {
        let ch = self.channels;
        let (time, pitch) = (time.clamp(0.25, 4.0) as f64, pitch.clamp(0.25, 4.0) as f64);
        let tempo = time / pitch;
        self.stretching |= (tempo - 1.0).abs() > 1e-6;
        self.resampling |= (pitch - 1.0).abs() > 1e-6;
        self.tempo = tempo;
        let mut made = 0;
        loop {
            // Middle (after WSOLA) → resampler / out.
            if self.resampling {
                let take = self.middle.len() / ch * ch;
                self.resampler.buf.data.extend(self.middle.drain(..take));
                let ended = self.wsola.done || (!self.stretching && self.wsola.ended && self.wsola.input.len() == 0);
                made += self.resampler.run(pitch, out, want - made, ended);
            } else {
                let n = ((want - made) * ch).min(self.middle.len() / ch * ch);
                out.extend(self.middle.drain(..n));
                made += n / ch;
            }
            if made >= want {
                return made;
            }
            // Refill the middle.
            if self.stretching {
                if !self.wsola.step(tempo, &mut self.middle) {
                    return made;
                }
            } else {
                let n = self.wsola.input.data.len() / ch * ch;
                if n == 0 {
                    if self.wsola.ended {
                        self.wsola.done = true;
                        if self.resampling {
                            let before = made;
                            made += self.resampler.run(pitch, out, want - made, true);
                            if made == before {
                                return made;
                            }
                            continue;
                        }
                    }
                    return made;
                }
                self.middle.extend(self.wsola.input.data.drain(..n));
                self.wsola.input.start += (n / ch) as u64;
                self.wsola.nominal = self.wsola.input.start as f64;
            }
        }
    }

    /// Source frames read but not heard yet (decoder position minus this = what plays).
    pub fn latency(&self) -> f64 {
        let ch = self.channels as f64;
        let middle = self.middle.len() as f64 / ch;
        let stretched = if self.stretching { self.wsola.behind() } else { self.wsola.input.len() as f64 };
        stretched + (middle + self.resampler.behind()) * self.tempo
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;

    fn sine(freq: f32, secs: f32) -> Vec<f32> {
        (0..(secs * RATE as f32) as usize).flat_map(|i| {
            let x = 0.5 * (2.0 * std::f32::consts::PI * freq * i as f32 / RATE as f32).sin();
            [x, x]
        }).collect()
    }

    /// Whole stream through at fixed rates.
    fn run(src: &[f32], time: f32, pitch: f32) -> Vec<f32> {
        let mut s = TimeStage::new(RATE, 2);
        let mut out = Vec::new();
        let mut fed = 0;
        loop {
            let made = s.pull(&mut out, 512, time, pitch);
            if made < 512 {
                if fed < src.len() {
                    let end = (fed + 2048).min(src.len());
                    s.push(&src[fed..end]);
                    fed = end;
                    if fed == src.len() {
                        s.finish();
                    }
                } else if made == 0 {
                    break;
                }
            }
        }
        out
    }

    /// Frequency from upward zero crossings of the left channel (middle half, away from the edges).
    fn freq(v: &[f32]) -> f32 {
        let left: Vec<f32> = v.iter().step_by(2).copied().collect();
        let (a, b) = (left.len() / 4, left.len() * 3 / 4);
        let ups = left[a..b].windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
        ups as f32 / ((b - a) as f32 / RATE as f32)
    }

    #[test]
    fn tempo_changes_length_not_pitch() {
        let src = sine(440.0, 2.0);
        let slow = run(&src, 0.5, 1.0);
        let ratio = slow.len() as f32 / src.len() as f32;
        assert!((ratio - 2.0).abs() < 0.05, "{ratio}");
        assert!((freq(&slow) - 440.0).abs() < 6.0, "{}", freq(&slow));
    }

    #[test]
    fn speed_changes_both() {
        let src = sine(440.0, 2.0);
        let fast = run(&src, 1.25, 1.25);
        let ratio = fast.len() as f32 / src.len() as f32;
        assert!((ratio - 0.8).abs() < 0.02, "{ratio}");
        assert!((freq(&fast) - 550.0).abs() < 6.0, "{}", freq(&fast));
    }

    #[test]
    fn pitch_alone_keeps_the_length() {
        let src = sine(440.0, 2.0);
        let up = run(&src, 1.0, 2f32.powf(4.0 / 12.0));
        let ratio = up.len() as f32 / src.len() as f32;
        assert!((ratio - 1.0).abs() < 0.05, "{ratio}");
        assert!((freq(&up) - 554.4).abs() < 8.0, "{}", freq(&up));
    }

    #[test]
    fn untouched_rates_pass_samples_through() {
        let src = sine(440.0, 0.5);
        assert_eq!(run(&src, 1.0, 1.0), src);
    }
}
