//! Local file playback, and server songs over HTTP (`http.rs`). Engine thread owns audio device (cpal stream not Send everywhere).

pub mod export;
pub mod http;
pub mod level;
mod live;
pub mod mic;
mod output;
mod queue;
pub mod shape;
pub mod silence;

pub use level::{Gain, Level};
pub use music_dsp::{Effects, Levels, Live as LiveSettings, tap::Tap, viz};
pub use output::devices as output_devices;
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
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// A levelling gain for the playing song is still taken this far in (a measure just done), or this soon after the
/// setting moved; later it waits for the next play: no level change mid-song nobody asked for.
const LEVEL_EARLY_MS: u64 = 3_000;
const LEVEL_MOVED: Duration = Duration::from_secs(5);

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
    /// Volume levelling (Settings › Playback): which gain plays, from the next block (gliding).
    Level { mode: Level },
    /// Rust-side only: files' levelling gains (tags or a measure), used when they play.
    #[serde(skip)]
    Gains { list: Vec<(PathBuf, Gain)> },
    Toggle,
    Seek { ms: u64 },
    Next,
    Prev,
    Volume { value: f32 },
    /// Keep current file, drop the rest (shuffle turned on mid-run). Current plays on, no gap.
    Truncate,
    Stop,
    /// Rust-side only: who opens server songs (`http::PREFIX` paths), with their auth.
    #[serde(skip)]
    #[ts(skip)]
    Remote { fetch: http::Remote },
    /// Rust-side only: Windows' default output changed. What plays moves to it, same place, paused or not.
    #[serde(skip)]
    Reopen,
    /// The output device by name (None: the system's default); what plays moves to it as for `Reopen`.
    SetDevice { name: Option<String> },
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

    /// A copy of what plays, for the visualizer (`music_dsp::viz`); empty until someone listens.
    pub fn tap(&self) -> Arc<music_dsp::tap::Tap> {
        self.control.tap().clone()
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
    /// The output device the user picked (None: the system's default).
    device_name: Option<String>,
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
    level: Level,
    /// When the levelling setting last moved.
    level_moved: Option<Instant>,
    /// Levelling gains per file (set by the shell before a song plays).
    gains: HashMap<PathBuf, Gain>,
    /// Levelling multiplier per loaded item (same order as `stops`), read by its source block by block.
    levels: VecDeque<Arc<AtomicU32>>,
    /// Opens server songs; none until the shell sets it.
    remote: Option<http::Remote>,
    /// A server song's failure mid-play (the decoder only sees its end), for the status.
    remote_failed: Arc<Mutex<Option<String>>>,
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
            Command::Remote { fetch } => self.remote = Some(fetch),
            Command::Trims { list } => {
                if self.trims.len() > 500 {
                    self.trims.clear();
                }
                // Arrived after its song began (a slow scan): a seek past the silence, if still inside it.
                let late = self.queue.current().and_then(|c| list.iter().find(|(p, t)| p == c && t.start_ms > 0 && self.trims.get(c).is_none_or(|old| old.start_ms == 0)).map(|(_, t)| t.start_ms));
                self.trims.extend(list);
                if let (Some(ms), Some(p)) = (late.filter(|_| self.skip_silence), &self.player)
                    && self.control.position_ms() + 200 < ms
                {
                    let _ = p.try_seek(Duration::from_millis(ms));
                }
            }
            Command::Level { mode } => {
                self.level = mode;
                self.level_moved = Some(Instant::now());
                self.relevel();
            }
            Command::Gains { list } => {
                if self.gains.len() > 500 {
                    self.gains.clear();
                }
                self.gains.extend(list);
                self.relevel();
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
                self.levels.truncate(self.stops.len());
            }
            Command::SetDevice { name } => {
                self.device_name = name;
                return self.handle(Command::Reopen);
            }
            Command::Reopen => {
                let Some(old) = self.device.take() else { return Ok(()) };
                // Nothing playing (stopped, queue over): the next play opens the new default.
                if self.player.is_none() || self.queue.current().is_none() {
                    return Ok(());
                }
                let at = self.control.position_ms();
                let paused = self.player.as_ref().is_some_and(|p| p.is_paused());
                // Old player and stream gone first: one stream at a time.
                self.player = None;
                let null = matches!(old, Output::Null(_));
                drop(old);
                self.device = Some(if null { Output::Null(output::Null::open()) } else { Output::open(self.device_name.as_deref())? });
                // Same file again: nothing counts as loaded in the new player.
                self.queue.jump(0);
                self.restart()?;
                if let Some(p) = &self.player {
                    if paused {
                        p.pause();
                    }
                    let _ = p.try_seek(Duration::from_millis(at));
                }
            }
            Command::Stop => {
                self.control.quiet();
                self.player = None;
                self.memory = None;
                self.queue = Queue::default();
                self.durations.clear();
                self.stops.clear();
                self.levels.clear();
            }
        }
        Ok(())
    }

    /// Multiplier for `path` now (1 without a known gain).
    fn factor(&self, path: &std::path::Path) -> f32 {
        self.gains.get(path).map_or(1.0, |g| g.factor(self.level))
    }

    /// Loaded files take their gain now: the next ones always, the playing one only early on or right after the setting
    /// moved.
    fn relevel(&self) {
        let early = self.control.position_ms() < LEVEL_EARLY_MS || self.level_moved.is_some_and(|t| t.elapsed() < LEVEL_MOVED);
        for (i, (path, level)) in self.queue.loaded().iter().zip(&self.levels).enumerate() {
            if i > 0 || early {
                level.store(self.factor(path).to_bits(), Ordering::Relaxed);
            }
        }
    }

    /// Fresh rodio player at queue position. Dropping old one stops it.
    fn restart(&mut self) -> Result<()> {
        if self.device.is_none() {
            self.device = Some(Output::open(self.device_name.as_deref())?);
        }
        let p = rodio::Player::connect_new(self.device.as_ref().unwrap().mixer());
        p.set_volume(self.volume);
        self.control.set_position_ms(0);
        self.player = Some(p);
        self.durations.clear();
        self.stops.clear();
        self.levels.clear();
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
        let append = |p: &rodio::Player, src: Box<dyn Source + Send>, stop: Arc<AtomicBool>, level: Arc<AtomicU32>| -> Option<u64> {
            let ms = src.total_duration().map(|d| d.as_millis() as u64);
            // Through the live chain. Checked from first sample on: a source dropped before it starts never plays.
            p.append(live::Live::new(src, control.clone()).levelled(level).stoppable().periodic_access(Duration::from_millis(20), move |s| {
                if stop.load(Ordering::Relaxed) {
                    s.stop()
                }
            }));
            ms
        };
        // A server that can't be reached (or refuses): its words, and no other song of it tried in this batch.
        let mut down: Option<String> = None;
        for path in self.queue.to_load() {
            let stop = Arc::new(AtomicBool::new(false));
            let flag = stop.clone();
            let level = Arc::new(AtomicU32::new(self.factor(&path).to_bits()));
            let gain = level.clone();
            let remote = http::is_remote(&path);
            let added = match &self.memory {
                Some((label, bytes)) if *label == path => Decoder::try_from(Cursor::new(bytes.clone())).map(|d| append(p, Box::new(d), flag, gain)).map_err(anyhow::Error::from),
                _ if remote && down.is_some() => Err(anyhow::anyhow!("{}", down.clone().unwrap_or_default())),
                _ if remote => self.open_remote(&path).map(|d| append(p, d, flag, gain)),
                _ => File::open(&path).map_err(anyhow::Error::from).and_then(|f| Ok(append(p, Box::new(Decoder::try_from(f)?), flag, gain))),
            };
            self.stops.push_back(stop);
            self.levels.push_back(level);
            match added {
                Ok(ms) => self.durations.push_back(ms),
                Err(e) => {
                    self.durations.push_back(None);
                    if remote && down.is_none() && e.downcast_ref::<std::io::Error>().is_some_and(http::unreachable) {
                        down = Some(format!("{e:#}"));
                    }
                    // A server's words alone (no key in front): `shared/errors.ts` knows them.
                    self.error = Some(if remote { format!("{e:#}") } else { format!("{}: {e:#}", path.display()) });
                }
            }
        }
        // Server off or refusing: the songs after would each fail the same way (a connect timeout each, the queue run
        // through). The run ends here; the interface stops on it, and Play tries again.
        if down.is_some() {
            self.queue.end_loaded();
        }
    }

    /// A server song's decoder: its bytes over HTTP, length and type from the first answer. A format the engine can't
    /// read (Opus, WMA…): asked again as the server's MP3.
    fn open_remote(&self, path: &std::path::Path) -> Result<Box<dyn Source + Send>> {
        let Some(http::Remote(fetch)) = &self.remote else { return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "Your music server isn't signed in").into()) };
        let key = path.to_str().and_then(|p| p.strip_prefix(http::PREFIX)).unwrap_or_default();
        // A radio station: endless, so no length and no seeking, and no second try as the server's MP3.
        if key.starts_with(http::RADIO) {
            let (stream, info) = http::Stream::open_live(fetch.clone(), key, self.remote_failed.clone())?;
            let mut b = Decoder::builder().with_data(stream);
            if let Some(mime) = &info.mime {
                b = b.with_mime_type(mime);
            }
            return Ok(Box::new(b.build().map_err(|e| anyhow::anyhow!("This radio station sends a format Legato can't play ({e})"))?));
        }
        let open = |transcode: bool| -> Result<Decoder<http::Stream>> {
            let (stream, info) = http::Stream::open(fetch.clone(), key, transcode, self.remote_failed.clone())?;
            let mut b = Decoder::builder().with_data(stream).with_seekable(true);
            if let Some(len) = info.len {
                b = b.with_byte_len(len);
            }
            if let Some(mime) = &info.mime {
                b = b.with_mime_type(mime);
            }
            b.build().map_err(|e| anyhow::anyhow!("Your music server sent a format Legato can't play ({e})"))
        };
        let decoder = match open(false) {
            Err(e) if e.to_string().contains("format Legato can't play") => open(true)?,
            d => d?,
        };
        Ok(Box::new(decoder))
    }

    fn tick(&mut self) {
        if let Some(e) = self.remote_failed.lock().unwrap().take() {
            self.error = Some(e);
        }
        let Some(p) = &self.player else { return };
        let done = self.queue.sync(p.len());
        self.durations.drain(..done);
        self.stops.drain(..done);
        self.levels.drain(..done);
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
    fn a_scan_that_arrives_late_still_skips_the_silence() {
        let path = wav("late", 5, 3, 0);
        let mut e = Engine { volume: 1.0, ..Default::default() };
        e.device = Some(Output::Null(Null::open()));
        e.handle(Command::SkipSilence { on: true }).unwrap();
        e.handle(Command::Play { paths: vec![path.clone()], start: 0 }).unwrap();
        e.handle(Command::Trims { list: vec![(path.clone(), silence::measure(&path).unwrap())] }).unwrap();
        std::thread::sleep(Duration::from_millis(400));
        e.tick();
        let on = e.status().position_ms;
        assert!((4_900..6_000).contains(&on), "{on}");
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
    fn a_new_default_output_takes_the_song_where_it_was_paused_or_not() {
        let path = wav("reopen", 0, 8, 0);
        let mut e = Engine { volume: 1.0, ..Default::default() };
        e.device = Some(Output::Null(Null::open()));
        e.handle(Command::Play { paths: vec![path.clone()], start: 0 }).unwrap();
        e.handle(Command::Seek { ms: 3_000 }).unwrap();
        e.handle(Command::Toggle).unwrap();
        let before = e.status().position_ms;
        e.handle(Command::Reopen).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        e.tick();
        let st = e.status();
        assert!(st.paused && st.path.as_ref() == Some(&path), "{st:?}");
        // The pause lands within a block of samples.
        assert!(before >= 3_000 && (before..before + 100).contains(&st.position_ms), "{before} {}", st.position_ms);
        // Playing: plays on from there.
        e.handle(Command::Toggle).unwrap();
        e.handle(Command::Reopen).unwrap();
        std::thread::sleep(Duration::from_millis(200));
        e.tick();
        let st = e.status();
        assert!(!st.paused && (3_000..4_000).contains(&st.position_ms), "{st:?}");
        // Stopped: nothing to move, the next play opens the new default.
        e.handle(Command::Stop).unwrap();
        e.handle(Command::Reopen).unwrap();
        assert!(e.device.is_none() && e.player.is_none());
        // A device picked while stopped is remembered for the next play; None goes back to the default.
        e.handle(Command::SetDevice { name: Some("Speakers".into()) }).unwrap();
        assert_eq!(e.device_name.as_deref(), Some("Speakers"));
        e.handle(Command::SetDevice { name: None }).unwrap();
        assert!(e.device_name.is_none());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_song_plays_at_its_levelling_gain_and_a_late_one_waits_for_the_next_play() {
        let (a, b) = (wav("level-a", 0, 8, 0), wav("level-b", 0, 2, 0));
        let mut e = Engine { volume: 1.0, ..Default::default() };
        e.device = Some(Output::Null(Null::open()));
        let half = Gain { track_db: -6.0206, track_peak: 1.0, album: None };
        e.handle(Command::Level { mode: Level::Track }).unwrap();
        e.handle(Command::Gains { list: vec![(a.clone(), half)] }).unwrap();
        e.handle(Command::Play { paths: vec![a.clone(), b.clone()], start: 0 }).unwrap();
        let now = |e: &Engine, i: usize| f32::from_bits(e.levels[i].load(Ordering::Relaxed));
        assert!((now(&e, 0) - 0.5).abs() < 1e-3 && now(&e, 1) == 1.0);
        // 4 s in, the setting moved long ago: a new gain for the playing song waits; the next song takes its own.
        e.level_moved = None;
        e.handle(Command::Seek { ms: 4_000 }).unwrap();
        e.handle(Command::Gains { list: vec![(a.clone(), Gain { track_db: -12.0, ..half }), (b.clone(), half)] }).unwrap();
        assert!((now(&e, 0) - 0.5).abs() < 1e-3 && (now(&e, 1) - 0.5).abs() < 1e-3);
        // The setting turned off: at once, the playing song too.
        e.handle(Command::Level { mode: Level::Off }).unwrap();
        assert_eq!((now(&e, 0), now(&e, 1)), (1.0, 1.0));
        e.handle(Command::Stop).unwrap();
        let _ = (std::fs::remove_file(a), std::fs::remove_file(b));
    }

    #[test]
    fn a_server_song_plays_seeks_and_hands_over_to_the_next_without_a_gap() {
        let file = wav("http", 0, 6, 0);
        let srv = http::tests::serve(std::fs::read(&file).unwrap(), true, None);
        let mut e = Engine { volume: 1.0, ..Default::default() };
        e.device = Some(Output::Null(Null::open()));
        // Not signed in yet: a clear error, nothing plays.
        let (a, b) = (PathBuf::from("server:s1:a"), PathBuf::from("server:s1:b"));
        e.handle(Command::Play { paths: vec![a.clone()], start: 0 }).unwrap();
        assert_eq!(e.error.take().as_deref(), Some("Your music server isn't signed in"));
        e.handle(Command::Remote { fetch: http::Remote(Arc::new(http::tests::Plain(srv.port))) }).unwrap();
        e.handle(Command::Play { paths: vec![a.clone(), b.clone()], start: 0 }).unwrap();
        assert!(e.error.is_none(), "{:?}", e.error);
        assert_eq!(e.durations.front().copied().flatten(), Some(6_000));
        e.handle(Command::Seek { ms: 4_000 }).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        e.tick();
        let st = e.status();
        assert!(st.path.as_ref() == Some(&a) && (4_000..5_000).contains(&st.position_ms), "{st:?}");
        // The next server song was loaded behind it: on at the end, same player (gapless).
        std::thread::sleep(Duration::from_millis(2_300));
        e.tick();
        assert_eq!(e.status().path.as_ref(), Some(&b));
        assert!(srv.requests.load(std::sync::atomic::Ordering::SeqCst) >= 2);
        e.handle(Command::Stop).unwrap();
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn a_server_that_doesnt_answer_ends_the_run_at_once() {
        // Off: every request fails as `servers.rs` words it. Counted.
        struct Off(std::sync::atomic::AtomicUsize);
        impl http::Fetch for Off {
            fn get(&self, _: &str, _: u64, _: bool) -> std::io::Result<http::Reply> {
                self.0.fetch_add(1, Ordering::SeqCst);
                Err(std::io::Error::new(std::io::ErrorKind::NotConnected, "Your music server doesn't answer: check that it's on and its address is right"))
            }
        }
        let off = Arc::new(Off(Default::default()));
        let mut e = Engine { volume: 1.0, ..Default::default() };
        e.device = Some(Output::Null(Null::open()));
        e.handle(Command::Remote { fetch: http::Remote(off.clone()) }).unwrap();
        let paths: Vec<PathBuf> = (0..50).map(|i| PathBuf::from(format!("server:s1:{i}"))).collect();
        e.handle(Command::Play { paths, start: 0 }).unwrap();
        assert!(e.error.take().is_some_and(|s| s.starts_with("Your music server doesn't answer")));
        for _ in 0..5 {
            e.tick();
        }
        // One request, not one per song: the run is over, said once.
        assert_eq!(off.0.load(Ordering::SeqCst), 1);
        assert!(e.status().ended);
        assert!(e.error.is_none());
        // A song the server lacks is that song's alone: the next one is tried.
        struct Lacks(std::sync::atomic::AtomicUsize);
        impl http::Fetch for Lacks {
            fn get(&self, _: &str, _: u64, _: bool) -> std::io::Result<http::Reply> {
                self.0.fetch_add(1, Ordering::SeqCst);
                Err(std::io::Error::new(std::io::ErrorKind::NotFound, "Your music server doesn't have this item"))
            }
        }
        let lacks = Arc::new(Lacks(Default::default()));
        e.handle(Command::Remote { fetch: http::Remote(lacks.clone()) }).unwrap();
        e.handle(Command::Play { paths: vec![PathBuf::from("server:s1:a"), PathBuf::from("server:s1:b"), PathBuf::from("server:s1:c")], start: 0 }).unwrap();
        e.tick();
        e.tick();
        assert_eq!(lacks.0.load(Ordering::SeqCst), 3);
        e.handle(Command::Stop).unwrap();
    }

    #[test]
    fn a_format_the_engine_cant_read_is_asked_again_as_the_servers_own_conversion() {
        struct Two(Vec<u8>, Mutex<Vec<bool>>);
        impl http::Fetch for Two {
            fn get(&self, _: &str, from: u64, transcode: bool) -> std::io::Result<http::Reply> {
                self.1.lock().unwrap().push(transcode);
                let file = if transcode { self.0.clone() } else { vec![0x42; 4_000] };
                let total = file.len();
                let body = file[from as usize..].to_vec();
                Ok(http::Reply { status: 206, content_length: Some(body.len() as u64), content_range: Some(format!("bytes {from}-{}/{total}", total - 1)), content_type: None, body: Box::new(Cursor::new(body)) })
            }
        }
        let file = wav("transcode", 0, 2, 0);
        let fetch = Arc::new(Two(std::fs::read(&file).unwrap(), Mutex::default()));
        let mut e = Engine { volume: 1.0, ..Default::default() };
        e.device = Some(Output::Null(Null::open()));
        e.handle(Command::Remote { fetch: http::Remote(fetch.clone()) }).unwrap();
        e.handle(Command::Play { paths: vec![PathBuf::from("server:s1:odd")], start: 0 }).unwrap();
        assert!(e.error.is_none(), "{:?}", e.error);
        assert_eq!(e.durations.front().copied().flatten(), Some(2_000));
        assert_eq!(fetch.1.lock().unwrap()[..2], [false, true]);
        e.handle(Command::Stop).unwrap();
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn a_radio_station_plays_as_an_endless_stream_without_a_second_try() {
        struct Station(Vec<u8>, Mutex<Vec<(String, u64, bool)>>);
        impl http::Fetch for Station {
            fn get(&self, key: &str, from: u64, transcode: bool) -> std::io::Result<http::Reply> {
                self.1.lock().unwrap().push((key.into(), from, transcode));
                Ok(http::Reply { status: 200, content_length: None, content_range: None, content_type: Some("audio/wav".into()), body: Box::new(Cursor::new(self.0.clone())) })
            }
        }
        let file = wav("radio", 0, 2, 0);
        let fetch = Arc::new(Station(std::fs::read(&file).unwrap(), Mutex::default()));
        let mut e = Engine { volume: 1.0, ..Default::default() };
        e.device = Some(Output::Null(Null::open()));
        e.handle(Command::Remote { fetch: http::Remote(fetch.clone()) }).unwrap();
        e.handle(Command::Play { paths: vec![PathBuf::from("server:radio:https://radio.example/live")], start: 0 }).unwrap();
        assert!(e.error.is_none(), "{:?}", e.error);
        let asked = fetch.1.lock().unwrap();
        assert_eq!(asked[0], ("radio:https://radio.example/live".to_string(), 0, false));
        assert!(asked.iter().all(|a| !a.2), "never asked as the server's MP3");
        drop(asked);
        e.handle(Command::Stop).unwrap();
        let _ = std::fs::remove_file(file);
    }

    /// Silent AAC-LC frames in ADTS (what most AAC radio streams send): 44.1 kHz mono, one empty channel element each.
    fn adts_silence(frames: usize) -> Vec<u8> {
        let frame = [0xFF, 0xF1, 0x50, 0x40, 0x01, 0x7F, 0xFC, 0x00, 0x00, 0x00, 0x07];
        frame.iter().copied().cycle().take(frame.len() * frames).collect()
    }

    #[test]
    fn an_aac_station_in_adts_plays() {
        struct Station(Vec<u8>);
        impl http::Fetch for Station {
            fn get(&self, _: &str, _: u64, _: bool) -> std::io::Result<http::Reply> {
                Ok(http::Reply { status: 200, content_length: None, content_range: None, content_type: Some("audio/aacp".into()), body: Box::new(Cursor::new(self.0.clone())) })
            }
        }
        let mut e = Engine { volume: 1.0, ..Default::default() };
        e.device = Some(Output::Null(Null::open()));
        e.handle(Command::Remote { fetch: http::Remote(Arc::new(Station(adts_silence(200)))) }).unwrap();
        e.handle(Command::Play { paths: vec![PathBuf::from("server:radio:https://radio.example/aac")], start: 0 }).unwrap();
        assert!(e.error.is_none(), "{:?}", e.error);
        e.handle(Command::Stop).unwrap();
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
