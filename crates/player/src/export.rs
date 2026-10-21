//! Live Editor export: a local file rendered through the same chain as playback (speed / tempo / pitch, effects,
//! limiter) into a new WAV, 16-bit with TPDF dither. The original is only read; the copy is written next to its final
//! name first and renamed when complete. Local files only: streams (YouTube, Spotify, Apple Music) never come here.

use crate::live::Live;
use music_dsp::{Control, Effects};
use rodio::{Decoder, Source};
use std::fs::{self, File};
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Debug, PartialEq, Eq)]
pub enum ExportError {
    /// Output would be the original, or isn't a .wav.
    BadTarget,
    /// Input can't be read as audio.
    Unreadable,
    /// Over 4 GB (the WAV limit).
    TooLong,
    Canceled,
    Io(String),
}

impl std::fmt::Display for ExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadTarget => f.write_str("the copy must be a new .wav file"),
            Self::Unreadable => f.write_str("this file can't be read"),
            Self::TooLong => f.write_str("too long for a WAV file (over 4 GB)"),
            Self::Canceled => f.write_str("canceled"),
            Self::Io(e) => f.write_str(e),
        }
    }
}

impl From<std::io::Error> for ExportError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

/// Same file, even through another spelling (case, `..`, links). A target that doesn't exist yet can't be the input.
fn same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Renders `input` with `effects` into `output` (.wav). `progress` gets 0..1 (None: length unknown). `cancel` stops it
/// and removes the partial file.
pub fn export(input: &Path, output: &Path, effects: Effects, cancel: &AtomicBool, mut progress: impl FnMut(Option<f32>)) -> Result<(), ExportError> {
    let wav = output.extension().is_some_and(|e| e.eq_ignore_ascii_case("wav"));
    if !wav || same_file(input, output) {
        return Err(ExportError::BadTarget);
    }
    let decoder = File::open(input).ok().and_then(|f| Decoder::try_from(f).ok()).ok_or(ExportError::Unreadable)?;
    let total_ms = decoder.total_duration().map(|d| d.as_millis() as u64).filter(|ms| *ms > 0);
    let (channels, rate) = (decoder.channels().get(), decoder.sample_rate().get());
    let control = Arc::new(Control::default());
    control.set_effects(effects);
    let live = Live::new(decoder, control.clone());
    let part = PathBuf::from(format!("{}.part", output.display()));
    let written = write(live, &part, channels, rate, cancel, || progress(total_ms.map(|t| (control.position_ms() as f32 / t as f32).min(1.0))));
    if let Err(e) = written {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    fs::rename(&part, output).inspect_err(|_| {
        let _ = fs::remove_file(&part);
    })?;
    progress(Some(1.0));
    Ok(())
}

fn write(samples: impl Iterator<Item = f32>, path: &Path, channels: u16, rate: u32, cancel: &AtomicBool, mut tick: impl FnMut()) -> Result<(), ExportError> {
    let mut out = BufWriter::new(File::create(path)?);
    header(&mut out, channels, rate, 0)?;
    let mut bytes: u64 = 0;
    let mut dither = Dither(0x9E37_79B9);
    for (i, x) in samples.enumerate() {
        out.write_all(&dither.quantize(x).to_le_bytes())?;
        bytes += 2;
        if i % 65_536 == 0 {
            if cancel.load(Ordering::Relaxed) {
                return Err(ExportError::Canceled);
            }
            if bytes > u32::MAX as u64 - 36 {
                return Err(ExportError::TooLong);
            }
            tick();
        }
    }
    // Odd byte count can't happen (2 per sample): no pad byte.
    let mut file = out.into_inner().map_err(|e| ExportError::Io(e.to_string()))?;
    file.seek(SeekFrom::Start(0))?;
    header(&mut file, channels, rate, bytes as u32)?;
    file.sync_all()?;
    Ok(())
}

/// RIFF / WAVE header, PCM 16-bit, `data` bytes long.
fn header(w: &mut impl Write, channels: u16, rate: u32, data: u32) -> std::io::Result<()> {
    let align = channels * 2;
    w.write_all(b"RIFF")?;
    w.write_all(&(36 + data).to_le_bytes())?;
    w.write_all(b"WAVEfmt ")?;
    w.write_all(&16u32.to_le_bytes())?;
    w.write_all(&1u16.to_le_bytes())?;
    w.write_all(&channels.to_le_bytes())?;
    w.write_all(&rate.to_le_bytes())?;
    w.write_all(&(rate * align as u32).to_le_bytes())?;
    w.write_all(&align.to_le_bytes())?;
    w.write_all(&16u16.to_le_bytes())?;
    w.write_all(b"data")?;
    w.write_all(&data.to_le_bytes())
}

/// TPDF dither (two uniform noises, ±1 LSB) before rounding to 16 bits: quiet tails fade into noise, not distortion.
struct Dither(u32);

impl Dither {
    fn uniform(&mut self) -> f32 {
        // xorshift32
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0 as f32 / u32::MAX as f32
    }

    fn quantize(&mut self, x: f32) -> i16 {
        let noise = self.uniform() - self.uniform();
        (x * 32_767.0 + noise).round().clamp(-32_768.0, 32_767.0) as i16
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 1 s of 440 Hz stereo at 44.1 kHz, as a WAV file.
    fn source(dir: &Path) -> PathBuf {
        let path = dir.join("in.wav");
        let mut f = File::create(&path).unwrap();
        let n = 44_100u32;
        header(&mut f, 2, 44_100, n * 4).unwrap();
        for i in 0..n {
            let x = ((2.0 * std::f32::consts::PI * 440.0 * i as f32 / 44_100.0).sin() * 16_000.0) as i16;
            f.write_all(&x.to_le_bytes()).unwrap();
            f.write_all(&x.to_le_bytes()).unwrap();
        }
        path
    }

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("music-export-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn data_len(path: &Path) -> u32 {
        let b = fs::read(path).unwrap();
        assert_eq!(&b[..4], b"RIFF");
        assert_eq!(&b[8..16], b"WAVEfmt ");
        let len = u32::from_le_bytes(b[40..44].try_into().unwrap());
        assert_eq!(b.len() as u32, 44 + len);
        len
    }

    #[test]
    fn slowed_copy_is_longer_and_the_original_untouched() {
        let d = dir("slowed");
        let input = source(&d);
        let before = fs::read(&input).unwrap();
        let out = d.join("out.wav");
        let mut last = None;
        export(&input, &out, Effects { speed: 0.8, ..Effects::default() }, &AtomicBool::new(false), |p| last = p).unwrap();
        assert_eq!(fs::read(&input).unwrap(), before);
        assert_eq!(last, Some(1.0));
        // 1 s at 0.8 → 1.25 s.
        let secs = data_len(&out) as f32 / (44_100.0 * 4.0);
        assert!((secs - 1.25).abs() < 0.05, "{secs}");
        assert!(!d.join("out.wav.part").exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn never_overwrites_the_original_nor_writes_other_formats() {
        let d = dir("target");
        let input = source(&d);
        let fx = Effects::default();
        let no = AtomicBool::new(false);
        assert_eq!(export(&input, &input, fx, &no, |_| {}), Err(ExportError::BadTarget));
        assert_eq!(export(&input, &d.join(".").join("in.wav"), fx, &no, |_| {}), Err(ExportError::BadTarget));
        assert_eq!(export(&input, &d.join("out.mp3"), fx, &no, |_| {}), Err(ExportError::BadTarget));
        assert_eq!(export(&d.join("missing.flac"), &d.join("out.wav"), fx, &no, |_| {}), Err(ExportError::Unreadable));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn cancel_leaves_nothing() {
        let d = dir("cancel");
        let input = source(&d);
        let out = d.join("out.wav");
        assert_eq!(export(&input, &out, Effects::default(), &AtomicBool::new(true), |_| {}), Err(ExportError::Canceled));
        assert!(!out.exists() && !d.join("out.wav.part").exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn dither_stays_within_one_step() {
        let mut d = Dither(1);
        for _ in 0..10_000 {
            assert!(d.quantize(0.0).abs() <= 1);
        }
        assert_eq!(d.quantize(2.0), 32_767);
    }
}
