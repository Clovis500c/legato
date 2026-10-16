//! Windows media panel and media keys (SystemMediaTransportControls of the main window).
//! Buttons → `media-key` event to the UI ("play", "pause", "next", "previous", "stop"); seek bar → `media-seek` (ms).
//! UI → `media_update`: what's playing, shown in the volume flyout / lock screen.

use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub playing: bool,
    pub position_ms: u64,
    /// None = unknown yet: no seek bar.
    pub duration_ms: Option<u64>,
}

/// ms → WinRT TimeSpan ticks (100 ns).
pub fn ticks(ms: u64) -> i64 {
    i64::try_from(ms).unwrap_or(i64::MAX / 10_000).saturating_mul(10_000)
}

/// WinRT ticks → ms, negative clamped to 0.
pub fn millis(ticks: i64) -> u64 {
    (ticks.max(0) / 10_000) as u64
}

#[cfg(windows)]
pub use imp::Media;

#[cfg(windows)]
mod imp {
    use super::{NowPlaying, millis, ticks};
    use tauri::{Emitter, Manager};
    use windows::Foundation::{TimeSpan, TypedEventHandler};
    use windows::Media::{MediaPlaybackStatus, MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs, SystemMediaTransportControls, SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs, SystemMediaTransportControlsTimelineProperties};
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream, RandomAccessStreamReference};
    use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;
    use windows::core::{HSTRING, Result, factory};

    pub struct Media {
        smtc: SystemMediaTransportControls,
    }

    impl Media {
        /// Main thread, once the window exists.
        pub fn install(window: &tauri::WebviewWindow) -> anyhow::Result<Self> {
            let hwnd = window.hwnd()?;
            let interop = factory::<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>()?;
            let smtc: SystemMediaTransportControls = unsafe { interop.GetForWindow(hwnd)? };
            smtc.SetIsPlayEnabled(true)?;
            smtc.SetIsPauseEnabled(true)?;
            smtc.SetIsNextEnabled(true)?;
            smtc.SetIsPreviousEnabled(true)?;
            smtc.SetIsStopEnabled(true)?;
            // Hidden until something plays.
            smtc.SetIsEnabled(false)?;
            let app = window.app_handle().clone();
            smtc.ButtonPressed(&TypedEventHandler::<SystemMediaTransportControls, SystemMediaTransportControlsButtonPressedEventArgs>::new(move |_, args| {
                let key = match args.ok()?.Button()? {
                    SystemMediaTransportControlsButton::Play => "play",
                    SystemMediaTransportControlsButton::Pause => "pause",
                    SystemMediaTransportControlsButton::Next => "next",
                    SystemMediaTransportControlsButton::Previous => "previous",
                    SystemMediaTransportControlsButton::Stop => "stop",
                    _ => return Ok(()),
                };
                let _ = app.emit_to("main", "media-key", key);
                Ok(())
            }))?;
            let app = window.app_handle().clone();
            smtc.PlaybackPositionChangeRequested(&TypedEventHandler::<SystemMediaTransportControls, PlaybackPositionChangeRequestedEventArgs>::new(move |_, args| {
                let at = args.ok()?.RequestedPlaybackPosition()?;
                let _ = app.emit_to("main", "media-seek", millis(at.Duration));
                Ok(())
            }))?;
            Ok(Self { smtc })
        }

        /// None = nothing playing: panel hidden. `art` = cover bytes (None keeps panel without one).
        pub fn update(&self, now: Option<&NowPlaying>, art: Option<&[u8]>) -> Result<()> {
            let Some(now) = now else {
                self.smtc.SetPlaybackStatus(MediaPlaybackStatus::Closed)?;
                return self.smtc.SetIsEnabled(false);
            };
            self.smtc.SetIsEnabled(true)?;
            let du = self.smtc.DisplayUpdater()?;
            du.ClearAll()?;
            du.SetType(MediaPlaybackType::Music)?;
            let music = du.MusicProperties()?;
            music.SetTitle(&HSTRING::from(&now.title))?;
            music.SetArtist(&HSTRING::from(&now.artist))?;
            if let Some(album) = &now.album {
                music.SetAlbumTitle(&HSTRING::from(album))?;
            }
            if let Some(bytes) = art {
                du.SetThumbnail(&thumbnail(bytes)?)?;
            }
            du.Update()?;
            self.set_state(now)
        }

        /// Play state and timeline (Windows moves the bar on its own while playing).
        pub fn set_state(&self, now: &NowPlaying) -> Result<()> {
            self.smtc.SetPlaybackStatus(if now.playing { MediaPlaybackStatus::Playing } else { MediaPlaybackStatus::Paused })?;
            let end = now.duration_ms.unwrap_or(0);
            let t = SystemMediaTransportControlsTimelineProperties::new()?;
            t.SetStartTime(TimeSpan::default())?;
            t.SetMinSeekTime(TimeSpan::default())?;
            t.SetEndTime(TimeSpan { Duration: ticks(end) })?;
            t.SetMaxSeekTime(TimeSpan { Duration: ticks(end) })?;
            t.SetPosition(TimeSpan { Duration: ticks(now.position_ms.min(end)) })?;
            self.smtc.UpdateTimelineProperties(&t)
        }
    }

    /// Image bytes → in-memory stream (no temp file, no URL fetched by Windows).
    fn thumbnail(bytes: &[u8]) -> Result<RandomAccessStreamReference> {
        let stream = InMemoryRandomAccessStream::new()?;
        let w = DataWriter::CreateDataWriter(&stream)?;
        w.WriteBytes(bytes)?;
        w.StoreAsync()?.join()?;
        w.FlushAsync()?.join()?;
        w.DetachStream()?;
        stream.Seek(0)?;
        RandomAccessStreamReference::CreateFromStream(&stream)
    }
}

/// Off Windows: no media panel yet.
#[cfg(not(windows))]
pub struct Media;

#[cfg(not(windows))]
impl Media {
    pub fn install(_: &tauri::WebviewWindow) -> anyhow::Result<Self> {
        Ok(Self)
    }
    pub fn update(&self, _: Option<&NowPlaying>, _: Option<&[u8]>) -> anyhow::Result<()> {
        Ok(())
    }
    pub fn set_state(&self, _: &NowPlaying) -> anyhow::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timespan_conversions() {
        assert_eq!(ticks(1), 10_000);
        assert_eq!(ticks(90_000), 900_000_000);
        assert_eq!(millis(ticks(123_456)), 123_456);
        assert_eq!(millis(-5), 0);
        // Huge values saturate instead of wrapping.
        assert!(ticks(u64::MAX) > 0);
    }
}
