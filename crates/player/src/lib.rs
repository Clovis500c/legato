//! Local file playback. Engine thread owns audio device (cpal stream not Send everywhere).

mod queue;

pub use queue::Queue;

use anyhow::Result;
use rodio::{Decoder, DeviceSinkBuilder, MixerDeviceSink, Source};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::File;
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    Play { paths: Vec<PathBuf>, start: usize },
    Toggle,
    Seek { ms: u64 },
    Next,
    Prev,
    Volume { value: f32 },
    Stop,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub path: Option<PathBuf>,
    pub position_ms: u64,
    pub duration_ms: Option<u64>,
    pub paused: bool,
    /// Next files in queue (max 50).
    pub upcoming: Vec<PathBuf>,
    /// Last error, cleared once read.
    pub error: Option<String>,
}

/// Handle to engine thread. Thread exits when handle dropped.
pub struct Player {
    tx: Sender<Command>,
    status: Arc<Mutex<Status>>,
}

impl Player {
    pub fn spawn() -> Self {
        let (tx, rx) = mpsc::channel();
        let status = Arc::new(Mutex::new(Status::default()));
        let shared = status.clone();
        std::thread::spawn(move || {
            let mut e = Engine { volume: 1.0, ..Default::default() };
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
        Self { tx, status }
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
    device: Option<MixerDeviceSink>,
    player: Option<rodio::Player>,
    queue: Queue,
    /// Durations of loaded items, same order as queue's loaded window.
    durations: VecDeque<Option<u64>>,
    volume: f32,
    error: Option<String>,
}

impl Engine {
    fn handle(&mut self, cmd: Command) -> Result<()> {
        match cmd {
            Command::Play { paths, start } => {
                self.queue = Queue::new(paths, start);
                self.restart()?;
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
            Command::Stop => {
                self.player = None;
                self.queue = Queue::default();
                self.durations.clear();
            }
        }
        Ok(())
    }

    /// Fresh rodio player at queue position. Dropping old one stops it.
    fn restart(&mut self) -> Result<()> {
        if self.device.is_none() {
            self.device = Some(DeviceSinkBuilder::open_default_sink()?);
        }
        let p = rodio::Player::connect_new(self.device.as_ref().unwrap().mixer());
        p.set_volume(self.volume);
        self.player = Some(p);
        self.durations.clear();
        self.fill();
        Ok(())
    }

    /// Append what queue wants loaded. Bad file = nothing appended, queue skips it on sync.
    fn fill(&mut self) {
        let Some(p) = &self.player else { return };
        for path in self.queue.to_load() {
            match File::open(&path).map_err(anyhow::Error::from).and_then(|f| Ok(Decoder::try_from(f)?)) {
                Ok(src) => {
                    self.durations.push_back(src.total_duration().map(|d| d.as_millis() as u64));
                    p.append(src);
                }
                Err(e) => {
                    self.durations.push_back(None);
                    self.error = Some(format!("{} : {e:#}", path.display()));
                }
            }
        }
    }

    fn tick(&mut self) {
        let Some(p) = &self.player else { return };
        let done = self.queue.sync(p.len());
        self.durations.drain(..done);
        self.fill();
    }

    fn status(&self) -> Status {
        let path = self.player.as_ref().and(self.queue.current().cloned());
        Status {
            position_ms: self.player.as_ref().map_or(0, |p| p.get_pos().as_millis() as u64),
            duration_ms: path.as_ref().and(self.durations.front().copied().flatten()),
            paused: self.player.as_ref().is_none_or(|p| p.is_paused()),
            upcoming: if path.is_some() { self.queue.upcoming().iter().take(50).cloned().collect() } else { Vec::new() },
            path,
            error: None,
        }
    }
}
