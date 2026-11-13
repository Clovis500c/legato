//! A rough tempo (beats per minute) of a local file, from its first minute and a half: an onset curve (rises of the
//! loudness, 200 a second), then the beat period that repeats the most, with a pull toward 120 against double and half
//! readings. Only a guess for songs whose tags carry none (Settings › Playback › Estimate tempo): a song that is not
//! rhythmic, or too short, gets no answer rather than a wrong one.

use anyhow::Result;
use rodio::{Decoder, Source};
use std::fs::File;
use std::path::Path;

/// Onset curve resolution.
const RATE: usize = 200;
/// Decoded audio at most (seconds): bounds the work whatever the file's length.
const SPAN: usize = 90;
/// Less than this much audio says nothing about a beat.
const MIN_SECS: usize = 12;
const LOW: u32 = 60;
const HIGH: u32 = 180;

/// The tempo of mono-or-not samples read `channels` at a time, or None when no beat stands out.
pub fn estimate(samples: impl Iterator<Item = f32>, channels: usize, rate: u32) -> Option<u32> {
    let hop = (rate as usize / RATE).max(1) * channels.max(1);
    let mut curve = Vec::new();
    let (mut sum, mut n) = (0.0f32, 0usize);
    for x in samples.take(rate as usize * channels.max(1) * SPAN) {
        sum += x * x;
        n += 1;
        if n == hop {
            // Compressed, so a loud passage doesn't hide a soft beat.
            curve.push((1.0 + 100.0 * (sum / n as f32).sqrt()).ln());
            sum = 0.0;
            n = 0;
        }
    }
    if curve.len() < MIN_SECS * RATE {
        return None;
    }
    // Rises only, centred.
    let mut onset: Vec<f32> = curve.windows(2).map(|w| (w[1] - w[0]).max(0.0)).collect();
    let mean = onset.iter().sum::<f32>() / onset.len() as f32;
    onset.iter_mut().for_each(|x| *x -= mean);
    let zero: f32 = onset.iter().map(|x| x * x).sum();
    if zero < 1e-3 {
        return None;
    }
    let acf = |lag: f32| {
        let (i, f) = (lag as usize, lag.fract());
        let at = |l: usize| onset[l..].iter().zip(&onset).map(|(a, b)| a * b).sum::<f32>() / zero;
        if i + 1 >= onset.len() { 0.0 } else { at(i) * (1.0 - f) + at(i + 1) * f }
    };
    let lag_of = |bpm: u32| 60.0 * RATE as f32 / bpm as f32;
    let (mut best, mut best_score, mut best_raw) = (0, f32::MIN, 0.0);
    for bpm in LOW..=HIGH {
        let raw = acf(lag_of(bpm));
        // The beat shows again a bar's worth of beats later: a real tempo repeats at twice its period too.
        let score = (raw + 0.5 * acf(2.0 * lag_of(bpm))) * (-0.5 * ((bpm as f32 / 120.0).ln() / 0.6).powi(2)).exp();
        if score > best_score {
            (best, best_score, best_raw) = (bpm, score, raw);
        }
    }
    (best_raw > 0.08).then_some(best)
}

/// The tempo of a file on disk (its first 90 seconds are decoded).
pub fn detect(path: &Path) -> Result<Option<u32>> {
    let src = Decoder::try_from(File::open(path)?)?;
    let (channels, rate) = (src.channels().get() as usize, src.sample_rate().get());
    Ok(estimate(src, channels, rate))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A click on each beat: a short decaying 1 kHz burst.
    fn clicks(bpm: f32, secs: usize, rate: u32) -> Vec<f32> {
        let period = (60.0 / bpm * rate as f32) as usize;
        (0..secs * rate as usize)
            .map(|i| {
                let t = i % period;
                if t < 2_000 { (t as f32 * 0.28).sin() * (-(t as f32) / 400.0).exp() * 0.8 } else { 0.0 }
            })
            .collect()
    }

    #[test]
    fn finds_a_click_track_within_a_beat_or_so() {
        for bpm in [75.0, 90.0, 120.0, 140.0, 170.0] {
            let got = estimate(clicks(bpm, 30, 22_050).into_iter(), 1, 22_050).expect("a beat");
            assert!((got as f32 - bpm).abs() <= 2.0, "{bpm} read as {got}");
        }
    }

    #[test]
    fn stereo_reads_like_mono() {
        let mono = clicks(100.0, 30, 22_050);
        let stereo = mono.iter().flat_map(|&x| [x, x]);
        assert_eq!(estimate(stereo, 2, 22_050), estimate(mono.into_iter(), 1, 22_050));
    }

    #[test]
    fn silence_steady_noise_and_a_short_clip_give_no_answer() {
        assert_eq!(estimate(std::iter::repeat_n(0.0, 22_050 * 30), 1, 22_050), None);
        let mut seed = 12_345u32;
        let noise = (0..22_050 * 30).map(move |_| {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (seed >> 16) as f32 / 65_536.0 - 0.5
        });
        assert_eq!(estimate(noise, 1, 22_050), None);
        assert_eq!(estimate(clicks(120.0, 5, 22_050).into_iter(), 1, 22_050), None);
    }
}
