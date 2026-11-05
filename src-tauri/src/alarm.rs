//! The alarm (Settings › Playback › Alarm): the interface sets the next ring (`set_alarm`) and a thread here keeps the
//! time, so it rings from the tray too, where the page may be asleep. A ring wakes the page and sends "alarm"; the page
//! plays and sets the next one. A PC asleep at the time doesn't wake for it: over 10 minutes late, skipped
//! ("alarm-missed": the page sets the next one).

use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Over this late (the PC was asleep), not rung.
const LATE_MS: i64 = 10 * 60_000;

#[derive(Debug, PartialEq)]
pub enum Due {
    Wait,
    Ring,
    Skip,
}

/// What a ring set for `at` does at `now` (unix ms).
pub fn due(now: i64, at: i64) -> Due {
    if now < at {
        Due::Wait
    } else if now - at <= LATE_MS {
        Due::Ring
    } else {
        Due::Skip
    }
}

/// The next ring (unix ms).
static AT: Mutex<Option<i64>> = Mutex::new(None);

/// The next ring (unix ms), or none.
#[tauri::command]
pub fn set_alarm(at: Option<i64>) {
    *AT.lock().unwrap() = at;
}

/// Looks every 10 s, at the wall clock (a PC that slept jumps).
pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(10));
            let now = music_core::library::now_ms();
            let event = {
                let mut at = AT.lock().unwrap();
                match at.map(|t| due(now, t)) {
                    None | Some(Due::Wait) => None,
                    Some(Due::Ring) => at.take().map(|_| "alarm"),
                    Some(Due::Skip) => at.take().map(|_| "alarm-missed"),
                }
            };
            match event {
                Some("alarm") => {
                    crate::background::wake(&app);
                    let _ = app.emit_to("main", "alarm", ());
                }
                Some(missed) => {
                    crate::diag::info("alarm", "not rung: the PC was asleep at its time", "");
                    let _ = app.emit_to("main", missed, ());
                }
                None => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rings_on_time_not_long_after() {
        assert_eq!(due(999, 1_000), Due::Wait);
        assert_eq!(due(1_000, 1_000), Due::Ring);
        assert_eq!(due(1_000 + LATE_MS, 1_000), Due::Ring);
        assert_eq!(due(1_001 + LATE_MS, 1_000), Due::Skip);
    }
}
