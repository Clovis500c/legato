//! Visualizer frames (Visualizer v2): while the interface listens, a worker thread reads the engine's copy of the sound
//! (`music-dsp` tap), runs the FFT (`viz::Pump`) and pushes packed frames over a Tauri channel at 60 Hz. Nobody
//! listening: no thread, and the audio thread copies nothing. The maths and the frame layout are in `crates/dsp/src/viz.rs`.

use crate::AppState;
use music_player::viz::{FPS, Pump};
use music_player::Tap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering::Relaxed};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};
use tauri::State;
use tauri::ipc::{Channel, InvokeResponseBody};

/// The running worker's stop flag.
static RUNNING: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

/// The page that owns the stream: the id it claimed at load (`viz_page`). A `viz_start` still in flight from the page
/// before a reload carries the old id and is dropped: its channel is dead but still sends Ok, so the worker would never end.
static PAGE: Mutex<String> = Mutex::new(String::new());

/// Frames sent so far and workers alive: what `viz_stats` reports (the e2e walk checks the stream follows the view).
static SENT: AtomicU64 = AtomicU64::new(0);
static ALIVE: AtomicUsize = AtomicUsize::new(0);

/// Counts a worker as alive until it ends, however it ends.
struct Alive;
impl Alive {
    fn new() -> Self {
        ALIVE.fetch_add(1, Relaxed);
        Self
    }
}
impl Drop for Alive {
    fn drop(&mut self) {
        ALIVE.fetch_sub(1, Relaxed);
    }
}

/// Stops the worker, if any (it ends within a tick). Called on unsubscribe, a page reload and a send that fails.
pub fn stop() {
    if let Some(flag) = RUNNING.lock().unwrap_or_else(PoisonError::into_inner).take() {
        flag.store(true, Relaxed);
    }
}

/// The new page claims the stream: the old one's worker stops, its late starts are refused.
fn claim(page: &str) {
    *PAGE.lock().unwrap_or_else(PoisonError::into_inner) = page.to_string();
    stop();
}

/// Is this start from the page that owns the stream. No id (the e2e walk) = yes.
fn owns(page: Option<&str>) -> bool {
    page.is_none_or(|p| *PAGE.lock().unwrap_or_else(PoisonError::into_inner) == p)
}

fn start(tap: Arc<Tap>, frames: Channel<InvokeResponseBody>) {
    stop();
    let flag = Arc::new(AtomicBool::new(false));
    *RUNNING.lock().unwrap_or_else(PoisonError::into_inner) = Some(flag.clone());
    let alive = Alive::new();
    let worker = move || {
        let _alive = alive;
        let mut pump = Pump::new(tap.listen());
        let period = Duration::from_micros(1_000_000 / FPS as u64);
        let mut next = Instant::now();
        while !flag.load(Relaxed) {
            if let Some(bytes) = pump.step() {
                if frames.send(InvokeResponseBody::Raw(bytes)).is_err() {
                    break;
                }
                SENT.fetch_add(1, Relaxed);
            }
            // Nothing plays: look a third as often (a resume waits 50 ms at most).
            next += if pump.idle() { period * 3 } else { period };
            let now = Instant::now();
            if next > now {
                std::thread::sleep(next - now);
            } else {
                next = now;
            }
        }
    };
    // Cannot start: no frames, the page shows a still spectrum. Nothing else depends on it.
    let _ = std::thread::Builder::new().name("viz".into()).spawn(worker);
}

/// The visualizer opened: packed frames (`music_dsp::viz::Frame::pack`) go to `frames` until `viz_stop`, a new
/// `viz_start` or a reload.
#[tauri::command]
pub async fn viz_start(state: State<'_, AppState>, page: Option<String>, frames: Channel<InvokeResponseBody>) -> Result<(), String> {
    if owns(page.as_deref()) {
        start(state.player.tap(), frames);
    }
    Ok(())
}

/// A page just loaded: it owns the stream from now on (`page` = an id it made up), whatever the page before left running.
#[tauri::command]
pub async fn viz_page(page: String) -> Result<(), String> {
    claim(&page);
    Ok(())
}

/// Workers running and frames sent since the app started. Only a count: nothing of the sound.
#[tauri::command]
pub fn viz_stats() -> (usize, u64) {
    (ALIVE.load(Relaxed), SENT.load(Relaxed))
}

#[tauri::command]
pub async fn viz_stop() -> Result<(), String> {
    stop();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_late_start_from_the_page_before_a_reload_is_refused() {
        claim("old");
        assert!(owns(Some("old")));
        claim("new");
        assert!(!owns(Some("old")));
        assert!(owns(Some("new")));
        assert!(owns(None));
    }
}
