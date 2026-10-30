//! Discord Rich Presence add-on: one thread owns the Discord connection. Newest update wins, sends spaced out
//! (Discord allows 5 per 20 s), retried while Discord is closed.
use music_connectors::discord::{self, Ipc, Pipe, Presence};
use serde::Serialize;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const GAP: Duration = Duration::from_secs(4);
const RETRY: Duration = Duration::from_secs(15);

pub enum Update {
    /// Show this track (None = connected, nothing shown).
    Set { client_id: String, presence: Option<Presence> },
    /// Add-on off: connection closed, Discord drops the activity.
    Off,
}

#[derive(Debug, Clone, Default, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "DiscordStatus")]
pub struct Status {
    pub connected: bool,
    pub error: Option<String>,
}

pub struct Discord {
    tx: Sender<Update>,
    status: Arc<Mutex<Status>>,
}

impl Discord {
    pub fn spawn() -> Self {
        let (tx, rx) = mpsc::channel();
        let status = Arc::new(Mutex::new(Status::default()));
        let s = status.clone();
        std::thread::Builder::new().name("discord".into()).spawn(move || run(rx, s)).expect("discord thread");
        Self { tx, status }
    }

    pub fn send(&self, u: Update) {
        let _ = self.tx.send(u);
    }

    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

fn run(rx: Receiver<Update>, status: Arc<Mutex<Status>>) {
    let mut conn: Option<(String, Ipc<Pipe>)> = None;
    let mut want: Option<Update> = None;
    let mut failed = false;
    let mut last = Instant::now() - GAP;
    loop {
        match rx.recv_timeout(if failed { RETRY } else { Duration::from_secs(3600) }) {
            Ok(u) => want = Some(u),
            Err(RecvTimeoutError::Timeout) if failed => {}
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => return,
        }
        // Spaced out; whatever came meanwhile replaces it.
        std::thread::sleep(GAP.saturating_sub(last.elapsed()));
        while let Ok(u) = rx.try_recv() {
            want = Some(u);
        }
        let result = match &want {
            Some(Update::Set { client_id, presence }) => {
                if conn.as_ref().is_some_and(|(id, _)| id != client_id) {
                    conn = None;
                }
                let ready = match conn.take() {
                    Some(c) => Ok(c),
                    None => discord::connect(client_id).map(|ipc| (client_id.clone(), ipc)),
                };
                ready.and_then(|(id, mut ipc)| {
                    let r = ipc.set_activity(std::process::id(), presence.as_ref().map(|p| discord::activity(p, now_ms())));
                    if r.is_ok() {
                        conn = Some((id, ipc));
                    }
                    r
                })
            }
            Some(Update::Off) | None => {
                conn = None;
                Ok(())
            }
        };
        last = Instant::now();
        let off = matches!(want, Some(Update::Off));
        failed = result.is_err() && !off;
        *status.lock().unwrap() = Status { connected: conn.is_some(), error: result.err().map(|e| e.to_string()) };
    }
}
