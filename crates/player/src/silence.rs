//! Silence at the start and the end of a local file, measured when a song is about to play (never at scan time).
//! Threshold -60 dBFS, RMS over 20 ms windows (dither and hiss below it are silence). The engine skips the start; the end goes to the
//! front end as the song's early end (`ends.ts`, as for YouTube).

use anyhow::Result;
use rodio::{Decoder, Source};
use std::fs::File;
use std::path::Path;

/// -60 dBFS as an RMS amplitude.
pub const THRESHOLD: f32 = 0.001;
const WINDOW_MS: u64 = 20;
/// Music starts a little before the first loud window (a soft attack); a tail stays after the last.
const LEAD_MS: u64 = 50;
const TAIL_MS: u64 = 200;
/// Less than this at the start or the end is left alone: not worth a seek, and album gaps are meant.
pub const MIN_START_MS: u64 = 300;
pub const MIN_END_MS: u64 = 1_500;
/// The quick start scan decodes this much at most: a longer silence (or a file quiet throughout) plays untrimmed.
const LEAD_SCAN_MS: u64 = 30_000;

/// Where the music is in a file. start_ms = 0 and end_ms None = nothing to cut.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Trim {
    pub start_ms: u64,
    pub end_ms: Option<u64>,
    pub total_ms: u64,
}

/// First and last loud window in `samples` (interleaved). `first_only` stops at the first loud one.
pub fn scan(samples: impl Iterator<Item = f32>, channels: usize, rate: u32, first_only: bool) -> Trim {
    let per_window = ((rate as u64 * WINDOW_MS / 1000) as usize * channels.max(1)).max(1);
    let (mut sum, mut n, mut windows) = (0f64, 0usize, 0u64);
    let (mut first, mut last) = (None::<u64>, 0u64);
    let mut total = 0u64;
    for s in samples {
        total += 1;
        sum += (s * s) as f64;
        n += 1;
        if n == per_window {
            if (sum / n as f64).sqrt() >= THRESHOLD as f64 {
                first.get_or_insert(windows);
                last = windows;
                if first_only {
                    break;
                }
            }
            windows += 1;
            sum = 0.0;
            n = 0;
        }
    }
    let total_ms = total / channels.max(1) as u64 * 1000 / rate.max(1) as u64;
    let Some(first) = first else { return Trim { start_ms: 0, end_ms: None, total_ms } };
    let start = (first * WINDOW_MS).saturating_sub(LEAD_MS);
    let end = (last + 1) * WINDOW_MS + TAIL_MS;
    Trim { start_ms: if start >= MIN_START_MS { start } else { 0 }, end_ms: (!first_only && total_ms >= end + MIN_END_MS).then_some(end), total_ms }
}

fn decode(path: &Path, first_only: bool) -> Result<Trim> {
    let src = Decoder::try_from(File::open(path)?)?;
    let (channels, rate) = (src.channels().get() as usize, src.sample_rate().get());
    if first_only {
        let cap = (rate as u64 * LEAD_SCAN_MS / 1000) as usize * channels;
        return Ok(scan(src.take(cap), channels, rate, true));
    }
    Ok(scan(src, channels, rate, false))
}

/// Start only: stops at the first loud window, so it costs what the silence lasts (30 s at most). end_ms and total_ms are not set.
pub fn leading(path: &Path) -> Result<Trim> {
    decode(path, true)
}

/// The whole file decoded once: start and end.
pub fn measure(path: &Path) -> Result<Trim> {
    decode(path, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 8_000;

    /// Mono: `lead` s of silence, `music` s of a tone (about -6 dBFS), `tail` s of silence.
    fn song(lead: f32, music: f32, tail: f32) -> Vec<f32> {
        let n = |s: f32| (s * RATE as f32) as usize;
        let mut v = vec![0.0; n(lead)];
        v.extend((0..n(music)).map(|i| 0.5 * (i as f32 * 0.3).sin()));
        v.extend(vec![0.0; n(tail)]);
        v
    }

    #[test]
    fn finds_the_music_between_two_silences() {
        let t = scan(song(5.0, 3.0, 4.0).into_iter(), 1, RATE, false);
        assert_eq!(t.start_ms, 4_950);
        assert_eq!(t.end_ms, Some(8_200));
        assert_eq!(t.total_ms, 12_000);
    }

    #[test]
    fn short_silences_are_left_alone() {
        let t = scan(song(0.2, 3.0, 1.0).into_iter(), 1, RATE, false);
        assert_eq!((t.start_ms, t.end_ms), (0, None));
    }

    #[test]
    fn quiet_noise_below_minus_60_is_silence() {
        let mut v: Vec<f32> = (0..RATE * 2).map(|i| 0.0004 * (i as f32).sin()).collect();
        v.extend(song(0.0, 1.0, 0.0));
        assert_eq!(scan(v.into_iter(), 1, RATE, true).start_ms, 1_950);
    }

    #[test]
    fn all_silent_or_empty_has_nothing_to_cut() {
        assert_eq!(scan(vec![0.0; 80_000].into_iter(), 1, RATE, false).start_ms, 0);
        assert_eq!(scan(std::iter::empty(), 2, RATE, false).end_ms, None);
    }

    #[test]
    fn stereo_windows_count_both_channels() {
        let mono = song(2.0, 1.0, 0.0);
        let st: Vec<f32> = mono.iter().flat_map(|s| [*s, *s]).collect();
        assert_eq!(scan(st.into_iter(), 2, RATE, true).start_ms, 1_950);
    }
}
