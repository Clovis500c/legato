//! A rough musical key of a local file (what a TKEY tag writes: "C", "Am", "F#m"), from the pitch classes that sound in
//! its first half minute: the energy at each semitone from C2 to B6 (Goertzel on short frames of the audio brought down
//! to about 11 kHz), folded into twelve, then matched against the Krumhansl-Schmuckler major and minor profiles in all
//! twelve rotations. A guess for songs whose tags carry none: noise, silence, a clip too short or a tie between keys
//! get no answer rather than a wrong one.

use anyhow::Result;
use rodio::{Decoder, Source};
use std::fs::File;
use std::path::Path;

/// Audio looked at (seconds), after the first few: an intro is often bare.
const SPAN: usize = 30;
const SKIP: usize = 5;
/// Less than this much audio says nothing about a key.
const MIN_SECS: usize = 8;
const FRAME: usize = 4096;
/// Working rate the audio is brought down to (by whole-number averaging).
const WORK: u32 = 11_025;
const NAMES: [&str; 12] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
/// Krumhansl-Kessler probe-tone profiles (1982), tonic first.
const MAJOR: [f32; 12] = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR: [f32; 12] = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
/// The best match must correlate this well, and beat the runner-up by this much.
const SURE: f32 = 0.55;
const MARGIN: f32 = 0.03;
/// Pitch classes this evenly sounded say no key (spread of the twelve over their mean).
const FLAT: f32 = 0.15;

fn correlation(a: &[f32; 12], b: &[f32; 12]) -> f32 {
    let (ma, mb) = (a.iter().sum::<f32>() / 12.0, b.iter().sum::<f32>() / 12.0);
    let (mut ab, mut aa, mut bb) = (0.0, 0.0, 0.0);
    for i in 0..12 {
        let (x, y) = (a[i] - ma, b[i] - mb);
        ab += x * y;
        aa += x * x;
        bb += y * y;
    }
    if aa <= 0.0 || bb <= 0.0 { 0.0 } else { ab / (aa * bb).sqrt() }
}

/// The energy at each pitch class of one mono frame (rate `rate`), added to `chroma`.
fn add_frame(frame: &[f32], rate: f32, chroma: &mut [f32; 12]) {
    for midi in 36..96 {
        let hz = 440.0 * 2f32.powf((midi as f32 - 69.0) / 12.0);
        let w = 2.0 * (2.0 * std::f32::consts::PI * hz / rate).cos();
        let (mut s1, mut s2) = (0.0f32, 0.0f32);
        for (i, &x) in frame.iter().enumerate() {
            // A Hann window: a pure tone does not leak into its neighbours.
            let h = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / frame.len() as f32).cos();
            let s = x * h + w * s1 - s2;
            s2 = s1;
            s1 = s;
        }
        chroma[midi % 12] += (s1 * s1 + s2 * s2 - w * s1 * s2).max(0.0).sqrt();
    }
}

/// The key of samples read `channels` at a time, as a tag writes it, or None when none stands out.
pub fn estimate(samples: impl Iterator<Item = f32>, channels: usize, rate: u32) -> Option<String> {
    let ch = channels.max(1);
    let down = (rate / WORK).max(1) as usize;
    let work = rate as f32 / down as f32;
    let skip = rate as usize * ch * SKIP;
    let take = rate as usize * ch * (SPAN + SKIP);
    // Mono, brought down by averaging `down` samples; a file shorter than SKIP + MIN_SECS reads from its start.
    let mut mono = Vec::new();
    let (mut acc, mut n) = (0.0f32, 0usize);
    let all: Vec<f32> = samples.take(take).collect();
    let from = if all.len() >= skip + rate as usize * ch * MIN_SECS { skip } else { 0 };
    for chunk in all[from..].chunks_exact(ch) {
        acc += chunk.iter().sum::<f32>() / ch as f32;
        n += 1;
        if n == down {
            mono.push(acc / n as f32);
            acc = 0.0;
            n = 0;
        }
    }
    if mono.len() < MIN_SECS * work as usize {
        return None;
    }
    let mut chroma = [0.0f32; 12];
    for frame in mono.as_chunks::<FRAME>().0 {
        add_frame(&frame[..], work, &mut chroma);
    }
    let mean = chroma.iter().sum::<f32>() / 12.0;
    let spread = (chroma.iter().map(|c| (c - mean) * (c - mean)).sum::<f32>() / 12.0).sqrt() / mean.max(1e-9);
    // Noise and silence are flat across the twelve (noise read 0.04 here, chords 0.9, real music in between).
    if spread < FLAT {
        return None;
    }
    let mut scored: Vec<(f32, usize, bool)> = Vec::with_capacity(24);
    for tonic in 0..12 {
        for (profile, major) in [(&MAJOR, true), (&MINOR, false)] {
            let mut rotated = [0.0; 12];
            for (i, v) in rotated.iter_mut().enumerate() {
                *v = profile[(i + 12 - tonic) % 12];
            }
            scored.push((correlation(&chroma, &rotated), tonic, major));
        }
    }
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    let (best, runner) = (scored[0], scored[1]);
    if best.0 < SURE || best.0 - runner.0 < MARGIN {
        return None;
    }
    Some(format!("{}{}", NAMES[best.1], if best.2 { "" } else { "m" }))
}

/// The key of a file on disk (its first seconds are decoded).
pub fn detect(path: &Path) -> Result<Option<String>> {
    let src = Decoder::try_from(File::open(path)?)?;
    let (channels, rate) = (src.channels().get() as usize, src.sample_rate().get());
    Ok(estimate(src, channels, rate))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Notes (semitones above C4) sounding together for `secs`, each with a few partials, one chord every second.
    fn music(chords: &[&[i32]], secs: usize, rate: u32) -> Vec<f32> {
        (0..secs * rate as usize)
            .map(|i| {
                let t = i as f32 / rate as f32;
                let chord = chords[(t as usize) % chords.len()];
                chord.iter().map(|&n| (1..=3).map(|h| (2.0 * std::f32::consts::PI * 261.63 * 2f32.powf(n as f32 / 12.0) * h as f32 * t).sin() / h as f32).sum::<f32>()).sum::<f32>() * 0.1
            })
            .collect()
    }

    #[test]
    fn a_progression_in_a_key_reads_as_that_key() {
        // C major: C, F, G, C chords (triads), then A minor: Am, Dm, E, Am.
        let c: [&[i32]; 4] = [&[0, 4, 7], &[5, 9, 12], &[7, 11, 14], &[0, 4, 7]];
        let a: [&[i32]; 4] = [&[9, 12, 16], &[2, 5, 9], &[4, 8, 11], &[9, 12, 16]];
        assert_eq!(estimate(music(&c, 24, 22_050).into_iter(), 1, 22_050).as_deref(), Some("C"));
        assert_eq!(estimate(music(&a, 24, 22_050).into_iter(), 1, 22_050).as_deref(), Some("Am"));
    }

    #[test]
    fn stereo_reads_like_mono() {
        let c: [&[i32]; 4] = [&[0, 4, 7], &[5, 9, 12], &[7, 11, 14], &[0, 4, 7]];
        let mono = music(&c, 20, 22_050);
        let stereo = mono.iter().flat_map(|&x| [x, x]);
        assert_eq!(estimate(stereo, 2, 22_050), estimate(mono.into_iter(), 1, 22_050));
    }

    #[test]
    fn silence_noise_and_a_short_clip_give_no_answer() {
        assert_eq!(estimate(std::iter::repeat_n(0.0, 22_050 * 20), 1, 22_050), None);
        let mut seed = 99u32;
        let noise: Vec<f32> = (0..22_050 * 20)
            .map(|_| {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (seed >> 16) as f32 / 65_536.0 - 0.5
            })
            .collect();
        assert_eq!(estimate(noise.into_iter(), 1, 22_050), None);
        let c: [&[i32]; 1] = [&[0, 4, 7]];
        assert_eq!(estimate(music(&c, 3, 22_050).into_iter(), 1, 22_050), None);
    }
}
