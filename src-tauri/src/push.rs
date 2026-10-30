//! Changes sent to a service (likes, adds and removals on YouTube Music) don't hold the interface up: the library
//! changes at once, the request follows here, one after the other in the order made (a like then an unlike reach
//! YouTube in that order). A refusal undoes the change here and comes back as a `push-failed` event (a notice).

use serde::Serialize;
use std::future::Future;
use std::pin::Pin;
use std::sync::OnceLock;
use std::sync::mpsc::{Sender, channel};
use tauri::Emitter;

type Job = Pin<Box<dyn Future<Output = ()> + Send>>;
static QUEUE: OnceLock<Sender<Job>> = OnceLock::new();

/// Runs `job` after the ones queued before it, off the interface's path.
pub fn later(job: impl Future<Output = ()> + Send + 'static) {
    let tx = QUEUE.get_or_init(|| {
        let (tx, rx) = channel::<Job>();
        std::thread::Builder::new()
            .name("push".into())
            .spawn(move || {
                for job in rx {
                    tauri::async_runtime::block_on(job);
                }
            })
            .expect("push thread");
        tx
    });
    let _ = tx.send(Box::pin(job));
}

#[derive(Debug, Clone, Copy, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "PushKind")]
pub enum Kind {
    Add,
    /// Kept in your own Liked Music instead (liked at the next sync).
    Like,
    /// Another account's like: taken back out here.
    LikeLost,
    Remove,
    Unlike,
}

/// What the interface says when a change didn't reach the service.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "PushFailed")]
pub struct Failed {
    pub kind: Kind,
    pub playlist: String,
    pub songs: usize,
    pub reason: String,
}

pub fn failed(app: &tauri::AppHandle, f: Failed) {
    let _ = app.emit("push-failed", f);
}

#[cfg(test)]
mod tests {
    use super::later;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    #[test]
    fn jobs_run_in_the_order_made() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        for i in 0..5u64 {
            let seen = seen.clone();
            // The first ones are the slowest: order still holds.
            later(async move {
                tokio::time::sleep(Duration::from_millis(20 - 4 * i)).await;
                seen.lock().unwrap().push(i);
            });
        }
        let (tx, rx) = std::sync::mpsc::channel();
        later(async move {
            let _ = tx.send(());
        });
        rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(*seen.lock().unwrap(), vec![0, 1, 2, 3, 4]);
    }
}
