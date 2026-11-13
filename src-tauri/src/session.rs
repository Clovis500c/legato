//! The OS media session (Windows: SMTC, `GlobalSystemMediaTransportControlsSessionManager`): which song the apps
//! playing on this PC say they play. Metadata only, no audio; read when the user presses Listen on "This PC" with the
//! setting on. Other platforms: nothing (the Detector goes on to the next layer).

use music_core::session::Session;

#[cfg(windows)]
pub fn read() -> Vec<Session> {
    use windows::Media::Control::{GlobalSystemMediaTransportControlsSessionManager as Manager, GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status};
    use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize};
    let go = || -> windows::core::Result<Vec<Session>> {
        // A worker thread has no COM yet; "already started in another mode" is fine.
        let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
        let manager = Manager::RequestAsync()?.join()?;
        let mut out = Vec::new();
        for s in manager.GetSessions()? {
            let one = || -> windows::core::Result<Session> {
                let props = s.TryGetMediaPropertiesAsync()?.join()?;
                Ok(Session {
                    app: s.SourceAppUserModelId()?.to_string(),
                    playing: s.GetPlaybackInfo()?.PlaybackStatus()? == Status::Playing,
                    title: props.Title()?.to_string(),
                    artist: props.Artist()?.to_string(),
                    album: props.AlbumTitle()?.to_string(),
                })
            };
            if let Ok(one) = one() {
                out.push(one);
            }
        }
        Ok(out)
    };
    go().unwrap_or_default()
}

#[cfg(not(windows))]
pub fn read() -> Vec<Session> {
    Vec::new()
}
