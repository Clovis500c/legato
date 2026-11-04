//! Same level for every local song (Settings › Playback › Volume levelling). Each file gets a gain to the level streaming
//! services play at: from its ReplayGain tags when a scanner wrote them (foobar2000, MusicBee, rsgain…), otherwise from
//! its loudness measured once (`music_dsp::loudness`, in the same decode as the silence scan, cached by the shell).
//! Applied by `live` before the live chain, so its limiter sees the result. A boost stops before the peak passes -1 dBFS.

use crate::shape::{self, Shape};
use crate::silence::{self, Trim};
use anyhow::Result;
use music_dsp::loudness::Integrated;
pub use music_dsp::loudness::Loudness;
use rodio::{Decoder, Source};
use serde::Deserialize;
use std::fs::File;
use std::path::Path;

/// Where songs land: -14 LUFS, what Spotify, YouTube and Tidal play at, so a local song sits with the streamed ones
/// around it (ReplayGain's own -18 would leave it 4 dB quieter).
pub const TARGET_LUFS: f32 = -14.0;
/// ReplayGain 2.0's reference: a tag's gain brings its song to -18 LUFS.
const REPLAYGAIN_LUFS: f32 = -18.0;
/// -1 dBFS: a boost stops before the peak passes it.
const CEILING: f32 = 0.891;
const MAX_BOOST_DB: f32 = 12.0;

/// Which gain plays: none, each song's own, or its album's (the album's songs keep their levels between them).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "Levelling")]
pub enum Level {
    #[default]
    Off,
    Track,
    Album,
}

/// A file's gains to `TARGET_LUFS` (dB), each with the peak it applies to (1.0 = full scale).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Gain {
    pub track_db: f32,
    pub track_peak: f32,
    pub album: Option<(f32, f32)>,
}

impl Gain {
    /// From a measure. None: silent throughout, nothing to level.
    pub fn measured(l: Loudness) -> Option<Self> {
        l.lufs.map(|lufs| Self { track_db: TARGET_LUFS - lufs, track_peak: l.peak, album: None })
    }

    /// From ReplayGain tags (gains to -18 LUFS). An unknown peak counts as full scale: no boost.
    pub fn tagged(track_db: f32, track_peak: Option<f32>, album: Option<(f32, Option<f32>)>) -> Self {
        let shift = TARGET_LUFS - REPLAYGAIN_LUFS;
        Self { track_db: track_db + shift, track_peak: track_peak.unwrap_or(1.0), album: album.map(|(db, peak)| (db + shift, peak.unwrap_or(1.0))) }
    }

    /// Multiplier for `level`. Album without an album gain (a measured file): the song's own.
    pub fn factor(&self, level: Level) -> f32 {
        let (db, peak) = match (level, self.album) {
            (Level::Off, _) => return 1.0,
            (Level::Album, Some(album)) => album,
            _ => (self.track_db, self.track_peak),
        };
        let f = 10f32.powf(db.min(MAX_BOOST_DB) / 20.0);
        // A boost stops at the ceiling, never turning into a cut: a hot master is only turned down by its own gain.
        if f > 1.0 && peak > 0.0 { f.min((CEILING / peak).max(1.0)) } else { f }
    }
}

/// One full decode of a local file: where its music is, how loud it is, and its shape for the seek bar.
pub fn analyse(path: &Path) -> Result<(Trim, Loudness, Vec<u8>)> {
    let src = Decoder::try_from(File::open(path)?)?;
    let (channels, rate) = (src.channels().get() as usize, src.sample_rate().get());
    let mut meter = Integrated::new(rate, channels);
    let mut shape = Shape::new(rate, channels);
    let trim = silence::scan(
        src.inspect(|&x| {
            meter.push(x);
            shape.push(x);
        }),
        channels,
        rate,
        false,
    );
    Ok((trim, meter.result(), shape.finish(shape::POINTS)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db(f: f32) -> f32 {
        20.0 * f.log10()
    }

    #[test]
    fn a_loud_master_is_turned_down_a_quiet_one_up_to_its_peak() {
        let loud = Gain::measured(Loudness { lufs: Some(-8.0), peak: 1.0 }).unwrap();
        assert!((db(loud.factor(Level::Track)) + 6.0).abs() < 0.01);
        // -20 LUFS with room above its peak: the full +6 dB.
        let quiet = Gain::measured(Loudness { lufs: Some(-20.0), peak: 0.25 }).unwrap();
        assert!((db(quiet.factor(Level::Track)) - 6.0).abs() < 0.01);
        // Peak at -3 dBFS: up 2 dB only, to -1 dBFS. Already at full scale: left as it is, never cut for it.
        let near = Gain::measured(Loudness { lufs: Some(-20.0), peak: 0.708 }).unwrap();
        assert!((db(near.factor(Level::Track)) - 2.0).abs() < 0.05, "{}", db(near.factor(Level::Track)));
        assert_eq!(Gain::measured(Loudness { lufs: Some(-20.0), peak: 1.0 }).unwrap().factor(Level::Track), 1.0);
        assert_eq!(quiet.factor(Level::Off), 1.0);
        assert_eq!(Gain::measured(Loudness { lufs: None, peak: 0.0 }), None);
        // Boosts stop at +12 dB.
        let faint = Gain::measured(Loudness { lufs: Some(-40.0), peak: 0.01 }).unwrap();
        assert!((db(faint.factor(Level::Track)) - 12.0).abs() < 0.01);
    }

    #[test]
    fn tags_are_moved_to_the_streaming_level_and_album_falls_back_on_track() {
        // A ReplayGain tag of -6 dB (to -18 LUFS) plays at -2 here (to -14).
        let g = Gain::tagged(-6.0, Some(1.0), Some((-4.0, Some(1.0))));
        assert!((db(g.factor(Level::Track)) + 2.0).abs() < 0.01);
        assert_eq!(g.factor(Level::Album), 1.0, "album -4 + 4 = 0 dB");
        let no_album = Gain::tagged(-6.0, Some(1.0), None);
        assert_eq!(no_album.factor(Level::Album), no_album.factor(Level::Track));
        // No peak written: no boost.
        assert_eq!(Gain::tagged(2.0, None, None).factor(Level::Track), 1.0);
    }
}
