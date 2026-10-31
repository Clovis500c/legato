//! Voice search: Windows' own speech recognition (WinRT `SpeechRecognizer`), one phrase. WebView2 has no Web Speech
//! backend. Needs Windows' "Online speech recognition" (Settings › Privacy & security › Speech): the voice goes to
//! Microsoft's service through Windows, never to us; the app keeps nothing. Words so far come as "speech" events.

// Windows only; the parsing and drawing below are tested on every system (CI), where nothing else calls them.
#![cfg_attr(not(windows), allow(dead_code))]

use serde::Serialize;

/// Why no text came back. The UI words it and links to the Windows setting that fixes it, when one does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "VoiceMiss")]
pub enum Miss {
    /// Online speech recognition off in Windows.
    SpeechOff,
    /// Microphone access off for desktop apps.
    MicBlocked,
    NoMic,
    Silence,
    Unclear,
    Offline,
    /// Windows' speech language can't do this.
    Language,
    Canceled,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Heard {
    Text { text: String },
    Miss { miss: Miss },
}

/// HRESULT of a failed call → reason.
pub fn miss_of_error(code: i32) -> Miss {
    match code as u32 {
        // SPERR_SPEECH_PRIVACY_POLICY_NOT_ACCEPTED
        0x8004_5509 => Miss::SpeechOff,
        // E_ACCESSDENIED: Windows' microphone switch.
        0x8007_0005 => Miss::MicBlocked,
        // E_ABORT, ERROR_CANCELLED: stopped by us.
        0x8000_4004 | 0x8007_04C7 => Miss::Canceled,
        _ => Miss::Failed,
    }
}

/// `SpeechRecognitionResultStatus` → reason; None = success.
pub fn miss_of_status(status: i32) -> Option<Miss> {
    Some(match status {
        0 => return None,
        1 => Miss::Language,
        4 => Miss::Unclear,
        5 => Miss::Canceled,
        7 => Miss::Silence,
        9 => Miss::Offline,
        10 => Miss::NoMic,
        _ => Miss::Failed,
    })
}

/// Final text, trimmed of the recognizer's trailing period ("Daft Punk." → "Daft Punk").
pub fn clean(text: &str) -> String {
    text.trim().trim_end_matches(['.', '。', '?', '!']).trim().to_string()
}

#[cfg(windows)]
mod imp {
    use super::{Heard, Miss, clean, miss_of_error, miss_of_status};
    use std::sync::Mutex;
    use tauri::{AppHandle, Emitter};
    use windows::Foundation::{TimeSpan, TypedEventHandler};
    use windows::Media::SpeechRecognition::{
        ISpeechRecognitionConstraint, SpeechRecognitionConfidence, SpeechRecognitionHypothesisGeneratedEventArgs, SpeechRecognitionScenario, SpeechRecognitionTopicConstraint, SpeechRecognizer,
    };
    use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize};
    use windows::core::{HSTRING, Interface, Result};

    const SECOND: i64 = 10_000_000;

    /// Stops the phrase being heard, if any.
    static STOP: Mutex<Option<Box<dyn Fn() + Send>>> = Mutex::new(None);

    pub fn stop() {
        if let Some(f) = STOP.lock().unwrap().take() {
            f();
        }
    }

    /// Blocks until a phrase is heard (or not). Call off the main thread.
    pub fn listen(app: &AppHandle) -> Heard {
        stop();
        let heard = run(app).unwrap_or_else(|e| Heard::Miss { miss: miss_of_error(e.code().0) });
        STOP.lock().unwrap().take();
        heard
    }

    fn run(app: &AppHandle) -> Result<Heard> {
        // WinRT on this worker thread; already set up = fine.
        let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
        let rec = SpeechRecognizer::new()?;
        let t = rec.Timeouts()?;
        t.SetInitialSilenceTimeout(TimeSpan { Duration: 6 * SECOND })?;
        t.SetEndSilenceTimeout(TimeSpan { Duration: SECOND })?;
        t.SetBabbleTimeout(TimeSpan { Duration: 4 * SECOND })?;
        let topic = SpeechRecognitionTopicConstraint::Create(SpeechRecognitionScenario::WebSearch, &HSTRING::from("music"))?;
        rec.Constraints()?.Append(&topic.cast::<ISpeechRecognitionConstraint>()?)?;
        if let Some(miss) = miss_of_status(rec.CompileConstraintsAsync()?.join()?.Status()?.0) {
            return Ok(Heard::Miss { miss });
        }
        let to = app.clone();
        let token = rec.HypothesisGenerated(&TypedEventHandler::<SpeechRecognizer, SpeechRecognitionHypothesisGeneratedEventArgs>::new(move |_, args| {
            let _ = to.emit_to("main", "speech", args.ok()?.Hypothesis()?.Text()?.to_string());
            Ok(())
        }))?;
        let op = rec.RecognizeAsync()?;
        let cancel = op.clone();
        *STOP.lock().unwrap() = Some(Box::new(move || {
            let _ = cancel.Cancel();
        }));
        let result = op.join();
        let _ = rec.RemoveHypothesisGenerated(token);
        let _ = rec.Close();
        let result = result?;
        if let Some(miss) = miss_of_status(result.Status()?.0) {
            return Ok(Heard::Miss { miss });
        }
        let text = clean(&result.Text()?.to_string());
        Ok(if text.is_empty() || result.Confidence()? == SpeechRecognitionConfidence::Rejected { Heard::Miss { miss: Miss::Unclear } } else { Heard::Text { text } })
    }
}

#[cfg(windows)]
pub use imp::{listen, stop};

#[cfg(not(windows))]
pub fn listen(_: &tauri::AppHandle) -> Heard {
    Heard::Miss { miss: Miss::Failed }
}

#[cfg(not(windows))]
pub fn stop() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_errors_become_reasons() {
        assert_eq!(miss_of_error(0x8004_5509u32 as i32), Miss::SpeechOff);
        assert_eq!(miss_of_error(0x8007_0005u32 as i32), Miss::MicBlocked);
        assert_eq!(miss_of_error(0x8007_04C7u32 as i32), Miss::Canceled);
        assert_eq!(miss_of_error(0x8000_4005u32 as i32), Miss::Failed);
        assert_eq!(miss_of_status(0), None);
        assert_eq!(miss_of_status(7), Some(Miss::Silence));
        assert_eq!(miss_of_status(10), Some(Miss::NoMic));
        assert_eq!(miss_of_status(42), Some(Miss::Failed));
    }

    #[test]
    fn phrases_lose_the_final_period() {
        assert_eq!(clean(" Daft Punk. "), "Daft Punk");
        assert_eq!(clean("what is love?"), "what is love");
        assert_eq!(clean("AC/DC"), "AC/DC");
        assert_eq!(serde_json::to_string(&Heard::Miss { miss: Miss::SpeechOff }).unwrap(), r#"{"kind":"miss","miss":"speechOff"}"#);
    }
}
