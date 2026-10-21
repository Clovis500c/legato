//! Sound for the Music Detector: a few seconds from the default microphone, or from what this PC plays (WASAPI
//! loopback of the default output; the app pauses its own playback meanwhile, so its streams are never taken), mixed
//! to mono, kept in memory only (never written to disk), then a WAV for the recognition service.

use rodio::cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rodio::cpal::{self, ErrorKind, FromSample, SampleFormat, SizedSample};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Where the Music Detector listens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Input {
    Mic,
    /// What this PC plays (all apps, through the default output).
    Pc,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MicError {
    NoMic,
    /// No speakers / output device to listen to.
    NoOutput,
    /// Windows' microphone privacy switch keeps desktop apps out.
    Blocked,
    /// Another app holds it exclusively.
    Busy,
    Failed,
}

impl std::fmt::Display for MicError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::NoMic => "no microphone",
            Self::NoOutput => "no sound output",
            Self::Blocked => "microphone blocked by Windows",
            Self::Busy => "microphone busy",
            Self::Failed => "microphone failed",
        })
    }
}

impl std::error::Error for MicError {}

fn mic_error(e: cpal::Error) -> MicError {
    match e.kind() {
        ErrorKind::PermissionDenied => MicError::Blocked,
        ErrorKind::DeviceNotAvailable => MicError::NoMic,
        ErrorKind::DeviceBusy => MicError::Busy,
        _ => MicError::Failed,
    }
}

/// Mono, -1..1.
pub struct Clip {
    pub rate: u32,
    pub samples: Vec<f32>,
}

/// Below this RMS (about -50 dBFS) there's nothing to recognize: a muted mic, a quiet room, nothing playing.
const QUIET_RMS: f32 = 0.003;
/// Peak the clip is brought to before sending (about -1 dBFS), at most +40 dB.
const PEAK: f32 = 0.89;
const MAX_GAIN: f32 = 100.0;

impl Clip {
    pub fn rms(&self) -> f32 {
        if self.samples.is_empty() {
            return 0.0;
        }
        (self.samples.iter().map(|x| x * x).sum::<f32>() / self.samples.len() as f32).sqrt()
    }

    /// Too quiet to recognize anything: muted or far mic, nothing playing (loopback sends nothing then).
    pub fn silent(&self) -> bool {
        self.rms() < QUIET_RMS
    }

    /// Level brought up to a full clip: fingerprints of quiet recordings fail (AudD error 300).
    fn gain(&self) -> f32 {
        let peak = self.samples.iter().fold(0f32, |m, x| m.max(x.abs()));
        if peak <= 0.0 { 1.0 } else { (PEAK / peak).clamp(1.0, MAX_GAIN) }
    }

    /// 16-bit PCM WAV, level raised (never lowered).
    pub fn wav(&self) -> Vec<u8> {
        let g = self.gain();
        let data = (self.samples.len() * 2) as u32;
        let mut out = Vec::with_capacity(44 + data as usize);
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes()); // PCM
        out.extend_from_slice(&1u16.to_le_bytes()); // mono
        out.extend_from_slice(&self.rate.to_le_bytes());
        out.extend_from_slice(&(self.rate * 2).to_le_bytes()); // bytes / s
        out.extend_from_slice(&2u16.to_le_bytes()); // block align
        out.extend_from_slice(&16u16.to_le_bytes()); // bits
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data.to_le_bytes());
        for x in &self.samples {
            out.extend_from_slice(&((((x * g).clamp(-1.0, 1.0)) * 32767.0).round() as i16).to_le_bytes());
        }
        out
    }
}

type Shared = Arc<Mutex<Vec<f32>>>;

fn build<T>(device: &cpal::Device, config: cpal::StreamConfig, buf: Shared, broken: Arc<AtomicBool>) -> Result<cpal::Stream, MicError>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let channels = config.channels.max(1) as usize;
    device
        .build_input_stream::<T, _, _>(
            config,
            move |data: &[T], _| {
                if let Ok(mut b) = buf.lock() {
                    b.extend(data.chunks(channels).map(|frame| frame.iter().map(|&x| x.to_sample::<f32>()).sum::<f32>() / channels as f32));
                }
            },
            // Xrun (a late buffer, cpal 0.18 says so at almost every start) and a followed route change: the clip
            // goes on. Anything else ends it.
            move |e: cpal::Error| {
                if !matches!(e.kind(), ErrorKind::Xrun | ErrorKind::DeviceChanged) {
                    broken.store(true, Ordering::Relaxed);
                }
            },
            None,
        )
        .map_err(mic_error)
}

/// Records up to `secs` from `input`. `tick(seconds so far, level 0..1)` about 10 times a second; `stop` set = done now,
/// with what was heard.
pub fn record(input: Input, secs: f32, stop: &AtomicBool, mut tick: impl FnMut(f32, f32)) -> Result<Clip, MicError> {
    let host = cpal::default_host();
    // An output device opened for input = WASAPI loopback (cpal): what the PC plays.
    let (device, supported) = match input {
        Input::Mic => {
            let d = host.default_input_device().ok_or(MicError::NoMic)?;
            let c = d.default_input_config().map_err(mic_error)?;
            (d, c)
        }
        Input::Pc => {
            let d = host.default_output_device().ok_or(MicError::NoOutput)?;
            let c = d.default_output_config().map_err(mic_error)?;
            (d, c)
        }
    };
    let rate = supported.sample_rate();
    let config = supported.config();
    let buf: Shared = Arc::new(Mutex::new(Vec::with_capacity((secs as usize + 1) * rate as usize)));
    let broken = Arc::new(AtomicBool::new(false));
    let (b, k) = (buf.clone(), broken.clone());
    let stream = match supported.sample_format() {
        SampleFormat::F32 => build::<f32>(&device, config, b, k),
        SampleFormat::I16 => build::<i16>(&device, config, b, k),
        SampleFormat::U16 => build::<u16>(&device, config, b, k),
        SampleFormat::I32 => build::<i32>(&device, config, b, k),
        _ => Err(MicError::Failed),
    }?;
    stream.play().map_err(mic_error)?;
    let start = Instant::now();
    let tenth = rate as usize / 10;
    loop {
        std::thread::sleep(Duration::from_millis(100));
        let t = start.elapsed().as_secs_f32();
        let level = {
            let b = buf.lock().unwrap();
            b[b.len().saturating_sub(tenth)..].iter().fold(0f32, |m, x| m.max(x.abs()))
        };
        tick(t.min(secs), level.min(1.0));
        if broken.load(Ordering::Relaxed) {
            return Err(MicError::Failed);
        }
        if t >= secs || stop.load(Ordering::Relaxed) {
            break;
        }
    }
    drop(stream);
    let samples = std::mem::take(&mut *buf.lock().unwrap());
    Ok(Clip { rate, samples })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_header_and_samples() {
        let clip = Clip { rate: 48_000, samples: vec![0.0, 1.0, -1.0, 2.0] };
        let w = clip.wav();
        assert_eq!(w.len(), 44 + 8);
        assert_eq!(&w[..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(w[4..8].try_into().unwrap()), 36 + 8);
        assert_eq!(&w[8..16], b"WAVEfmt ");
        assert_eq!(u32::from_le_bytes(w[24..28].try_into().unwrap()), 48_000);
        assert_eq!(u32::from_le_bytes(w[28..32].try_into().unwrap()), 96_000);
        assert_eq!(&w[36..40], b"data");
        let s: Vec<i16> = w[44..].chunks(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
        // Out of range clamps.
        assert_eq!(s, vec![0, 32767, -32767, 32767]);
    }

    #[test]
    fn silence_and_room_noise_are_told_apart() {
        assert!(Clip { rate: 8_000, samples: vec![0.0; 800] }.silent());
        assert!(Clip { rate: 8_000, samples: vec![] }.silent());
        // Faint hiss: -60 dBFS.
        assert!(Clip { rate: 8_000, samples: (0..800).map(|i| if i % 2 == 0 { 0.001 } else { -0.001 }).collect() }.silent());
        assert!(!Clip { rate: 8_000, samples: (0..800).map(|i| (i as f32 * 0.3).sin() * 0.05).collect() }.silent());
    }

    #[test]
    fn quiet_clips_are_raised_never_lowered() {
        let quiet = Clip { rate: 8_000, samples: vec![0.0, 0.1, -0.05] };
        let s: Vec<i16> = quiet.wav()[44..].chunks(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
        assert_eq!(s, vec![0, 29163, -14581]);
        // Loud stays as it is.
        let loud = Clip { rate: 8_000, samples: vec![0.95, -0.5] };
        let s: Vec<i16> = loud.wav()[44..].chunks(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
        assert_eq!(s, vec![31129, -16384]);
    }
}
