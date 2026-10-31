//! Local file playback. Engine thread owns audio device (cpal stream not Send everywhere).

pub mod export;
mod live;
pub mod mic;
mod output;
mod queue;
pub mod silence;

pub use music_dsp::{Effects, Levels, Live as LiveSettings};
pub use queue::Queue;
pub use silence::Trim;

use anyhow::Result;
use output::Output;
use rodio::{Decoder, Source};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Deserialize, ts_rs::TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export, rename = "PlayerCommand")]
pub enum Command {
    Play { paths: Vec<PathBuf>, start: usize },
    /// Rust-side only (preview bytes). `label` stands in for path in status.
    #[serde(skip)]
    PlayMemory { label: PathBuf, bytes: Arc<[u8]> },
    /// Skip the silence at the start of local songs (Settings › Playback), and report where the music ends.
    SkipSilence { on: bool },
    /// Rust-side only: measured silence of files (cache or fresh), used when they play.
    #[serde(skip)]
    Trims { list: Vec<(PathBuf, Trim)> },
    Toggle,
    Seek { ms: u64 },
    Next,
    Prev,
    Volume { value: f32 },
    /// Keep current file, drop the rest (shuffle turned on mid-run). Current plays on, no gap.
    Truncate,
    Stop,
}

#[derive(Debug, Clone, Default, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "PlayerStatus")]
pub struct Status {
    pub path: Option<PathBuf>,
    pub position_ms: u64,
    pub duration_ms: Option<u64>,
    pub paused: bool,
    /// Next files in queue (max 50).
    pub upcoming: Vec<PathBuf>,
    /// Last error, cleared once read.
    pub error: Option<String>,
    /// Queue ran out on its own (not stopped): caller moves on.
    pub ended: bool,
    /// Skip silence on and the playing file's music ends here (ms), well before the file does: its early end.
    pub trim_end_ms: Option<u64>,
}

/// Handle to engine thread. Thread exits when handle dropped.
pub struct Player {
    tx: Sender<Command>,
    status: Arc<Mutex<Status>>,
    /// Live processing settings in, levels out (shared with every playing source).
    control: Arc<music_dsp::Control>,
}

impl Player {
    pub fn spawn() -> Self {
        let (tx, rx) = mpsc::channel();
        let status = Arc::new(Mutex::new(Status::default()));
        let shared = status.clone();
        let control = Arc::new(music_dsp::Control::default());
        let live = control.clone();
        std::thread::spawn(move || {
            let mut e = Engine { volume: 1.0, control: live, ..Default::default() };
            loop {
                // Timeout = tick: detect track ends, preload next.
                match rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(cmd) => {
                        if let Err(err) = e.handle(cmd) {
                            e.error = Some(format!("{err:#}"));
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => return,
                }
                e.tick();
                let mut st = shared.lock().unwrap();
                let unread = st.error.take();
                *st = e.status();
                st.error = e.error.take().or(unread);
            }
        });
        Self { tx, status, control }
    }

    /// Live processing (Adaptive Sound…): applies to what plays now and next.
    pub fn set_live(&self, live: LiveSettings) {
        self.control.set(live);
    }

    /// Live Editor settings: apply to what plays now and next, from the next block.
    pub fn set_effects(&self, effects: Effects) {
        self.control.set_effects(effects);
    }

    /// What plays now, as heard (meters, cover animation).
    pub fn levels(&self) -> Levels {
        self.control.levels()
    }

    pub fn send(&self, cmd: Command) {
        let _ = self.tx.send(cmd);
    }

    pub fn status(&self) -> Status {
        let mut st = self.status.lock().unwrap();
        let out = st.clone();
        st.error = None;
        out
    }
}

#[derive(Default)]
struct Engine {
    /// Opened on first play: no audio device needed until then.
    device: Option<Output>,
    player: Option<rodio::Player>,
    queue: Queue,
    /// Durations of loaded items, same order as queue's loaded window.
    durations: VecDeque<Option<u64>>,
    /// Stop flag per loaded item (same order): set = source ends at once, sink moves past it.
    stops: VecDeque<Arc<AtomicBool>>,
    volume: f32,
    error: Option<String>,
    /// In-memory item (preview), matched by label in queue.
    memory: Option<(PathBuf, Arc<[u8]>)>,
    control: Arc<music_dsp::Control>,
    skip_silence: bool,
    /// Silence measured per file (set by the shell before a song plays).
    trims: HashMap<PathBuf, Trim>,
}

impl Engine {
    fn handle(&mut self, cmd: Command) -> Result<()> {
        match cmd {
            Command::Play { paths, start } => {
                self.memory = None;
                self.queue = Queue::new(paths, start);
                self.restart()?;
            }
            Command::PlayMemory { label, bytes } => {
                self.memory = Some((label.clone(), bytes));
                self.queue = Queue::new(vec![label], 0);
                self.restart()?;
            }
            Command::SkipSilence { on } => self.skip_silence = on,
            Command::Trims { list } => {
                if self.trims.len() > 500 {
                    self.trims.clear();
                }
                self.trims.extend(list);
            }
            Command::Toggle => {
                if let Some(p) = &self.player {
                    if p.is_paused() { p.play() } else { p.pause() }
                }
            }
            Command::Seek { ms } => {
                if let Some(p) = &self.player {
                    p.try_seek(Duration::from_millis(ms))?;
                }
            }
            Command::Next => {
                if self.queue.jump(1) {
                    self.restart()?;
                }
            }
            Command::Prev => {
                if self.queue.jump(-1) {
                    self.restart()?;
                }
            }
            Command::Volume { value } => {
                self.volume = value.clamp(0.0, 1.0);
                if let Some(p) = &self.player {
                    p.set_volume(self.volume);
                }
            }
            Command::Truncate => {
                let n = self.queue.truncate().min(self.stops.len());
                for stop in self.stops.drain(self.stops.len() - n..) {
                    stop.store(true, Ordering::Relaxed);
                }
                self.durations.truncate(self.stops.len());
            }
            Command::Stop => {
                self.control.quiet();
                self.player = None;
                self.memory = None;
                self.queue = Queue::default();
                self.durations.clear();
                self.stops.clear();
            }
        }
        Ok(())
    }

    /// Fresh rodio player at queue position. Dropping old one stops it.
    fn restart(&mut self) -> Result<()> {
        if self.device.is_none() {
            self.device = Some(Output::open()?);
        }
        let p = rodio::Player::connect_new(self.device.as_ref().unwrap().mixer());
        p.set_volume(self.volume);
        self.control.set_position_ms(0);
        self.player = Some(p);
        self.durations.clear();
        self.stops.clear();
        self.fill();
        self.skip_start();
        Ok(())
    }

    /// Current file starts on its music: a seek past the silence measured before (if skipping is on).
    fn skip_start(&mut self) {
        let (Some(p), Some(path)) = (&self.player, self.queue.current()) else { return };
        if let Some(t) = self.trims.get(path).filter(|t| self.skip_silence && t.start_ms > 0) {
            let _ = p.try_seek(Duration::from_millis(t.start_ms));
        }
    }

    /// Append what queue wants loaded. Bad file = nothing appended, queue skips it on sync.
    fn fill(&mut self) {
        let Some(p) = &self.player else { return };
        let control = self.control.clone();
        let append = |p: &rodio::Player, src: Box<dyn Source + Send>, stop: Arc<AtomicBool>| -> Option<u64> {
            let ms = src.total_duration().map(|d| d.as_millis() as u64);
            // Through the live chain. Checked from first sample on: a source dropped before it starts never plays.
            p.append(live::Live::new(src, control.clone()).stoppable().periodic_access(Duration::from_millis(20), move |s| {
                if stop.load(Ordering::Relaxed) {
                    s.stop()
                }
            }));
            ms
        };
        for path in self.queue.to_load() {
            let stop = Arc::new(AtomicBool::new(false));
            let flag = stop.clone();
            let added = match &self.memory {
                Some((label, bytes)) if *label == path => Decoder::try_from(Cursor::new(bytes.clone())).map(|d| append(p, Box::new(d), flag)).map_err(anyhow::Error::from),
                _ => File::open(&path).map_err(anyhow::Error::from).and_then(|f| Ok(append(p, Box::new(Decoder::try_from(f)?), flag))),
            };
            self.stops.push_back(stop);
            match added {
                Ok(ms) => self.durations.push_back(ms),
                Err(e) => {
                    self.durations.push_back(None);
                    self.error = Some(format!("{}: {e:#}", path.display()));
                }
            }
        }
    }

    fn tick(&mut self) {
        let Some(p) = &self.player else { return };
        let done = self.queue.sync(p.len());
        self.durations.drain(..done);
        self.stops.drain(..done);
        self.fill();
        // Gapless hand-over to the next file: it starts on its music too.
        if done > 0 {
            self.skip_start();
        }
    }

    fn status(&self) -> Status {
        let path = self.player.as_ref().and(self.queue.current().cloned());
        Status {
            // Song time from the live chain: rodio counts samples played, wrong once the speed changes.
            position_ms: if self.player.is_some() { self.control.position_ms() } else { 0 },
            duration_ms: path.as_ref().and(self.durations.front().copied().flatten()),
            paused: self.player.as_ref().is_none_or(|p| p.is_paused()),
            upcoming: if path.is_some() { self.queue.upcoming().iter().take(50).cloned().collect() } else { Vec::new() },
            ended: self.player.is_some() && path.is_none(),
            trim_end_ms: path.as_ref().filter(|_| self.skip_silence).and_then(|p| self.trims.get(p)).and_then(|t| t.end_ms),
            path,
            error: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use output::Null;

    /// 8 kHz mono 16-bit WAV: `lead` s of silence, `music` s of a tone, `tail` s of silence.
    fn wav(name: &str, lead: u32, music: u32, tail: u32) -> PathBuf {
        let rate = 8_000u32;
        let samples: Vec<i16> = (0..(lead + music + tail) * rate).map(|i| if i < lead * rate || i >= (lead + music) * rate { 0 } else { ((i as f32 * 0.3).sin() * 16_000.0) as i16 }).collect();
        let mut b = Vec::new();
        b.extend(b"RIFF");
        b.extend((36 + samples.len() as u32 * 2).to_le_bytes());
        b.extend(b"WAVEfmt ");
        b.extend(16u32.to_le_bytes());
        b.extend([1, 0, 1, 0]);
        b.extend(rate.to_le_bytes());
        b.extend((rate * 2).to_le_bytes());
        b.extend([2, 0, 16, 0]);
        b.extend(b"data");
        b.extend((samples.len() as u32 * 2).to_le_bytes());
        samples.iter().for_each(|s| b.extend(s.to_le_bytes()));
        let path = std::env::temp_dir().join(format!("legato-silence-{}-{name}.wav", std::process::id()));
        std::fs::write(&path, b).unwrap();
        path
    }

    /// An engine on the silent output: plays for `wait` ms of wall time, then says where it is.
    fn played(path: &std::path::Path, skip: bool, wait: u64) -> Status {
        let mut e = Engine { volume: 1.0, ..Default::default() };
        e.device = Some(Output::Null(Null::open()));
        e.handle(Command::SkipSilence { on: skip }).unwrap();
        e.handle(Command::Trims { list: vec![(path.to_path_buf(), silence::measure(path).unwrap())] }).unwrap();
        e.handle(Command::Play { paths: vec![path.to_path_buf()], start: 0 }).unwrap();
        std::thread::sleep(Duration::from_millis(wait));
        e.tick();
        e.status()
    }

    #[test]
    fn a_file_with_5_s_of_silence_starts_on_the_music() {
        let path = wav("lead", 5, 3, 0);
        let on = played(&path, true, 400);
        assert!(on.position_ms >= 4_900 && on.position_ms < 6_000, "{}", on.position_ms);
        // Off (the default): from the first second, silence and all.
        let off = played(&path, false, 400);
        assert!(off.position_ms < 1_500, "{}", off.position_ms);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_file_with_music_from_the_start_is_not_cut() {
        let path = wav("none", 0, 3, 0);
        let on = played(&path, true, 300);
        assert!(on.position_ms < 1_000 && on.trim_end_ms.is_none(), "{on:?}");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn the_status_gives_the_early_end_only_when_skipping() {
        let path = wav("end", 0, 3, 4);
        let on = played(&path, true, 100);
        assert_eq!(on.trim_end_ms, Some(3_200), "{on:?}");
        assert_eq!(played(&path, false, 100).trim_end_ms, None);
        let _ = std::fs::remove_file(path);
    }
}
