//! Live audio processing, pure Rust (no audio device, no Tauri): what the native engine (`music-player`) runs on local
//! files and previews. The YouTube frame runs the same chain with the browser's own audio nodes
//! (`crates/shield/src/live.js`); both take the same settings and report the same levels.
//!
//! Interleaved f32 frames in, processed in place. Settings change from any thread without blocking the audio thread
//! (`Control`); levels come back the same way.

mod biquad;
pub mod chain;
mod control;
pub mod effects;
mod meter;
mod processor;
pub mod reverb;
pub mod space;
pub mod stretch;

pub use biquad::Biquad;
pub use chain::Chain;
pub use effects::Effects;
pub use stretch::TimeStage;
pub use control::{Control, Levels, Live};
pub use meter::Meter;
pub use processor::Processor;

/// dB → linear gain.
pub fn db_to_gain(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

/// Linear gain → dB (floor at -120).
pub fn gain_to_db(g: f32) -> f32 {
    if g <= 1e-6 { -120.0 } else { 20.0 * g.log10() }
}
