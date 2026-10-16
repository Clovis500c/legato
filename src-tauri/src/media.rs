//! Windows media panel and media keys (SystemMediaTransportControls of the main window).
//! Buttons → `media-key` event to the UI ("play", "pause", "next", "previous", "stop").
//! UI → `media_update`: what's playing, shown in the volume flyout / lock screen.

use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub playing: bool,
}

#[cfg(windows)]
pub use imp::Media;

#[cfg(windows)]
mod imp {
    use super::NowPlaying;
    use tauri::{Emitter, Manager};
    use windows::Foundation::TypedEventHandler;
    use windows::Media::{MediaPlaybackStatus, MediaPlaybackType, SystemMediaTransportControls, SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs};
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
            self.set_playing(now.playing)
        }

        pub fn set_playing(&self, playing: bool) -> Result<()> {
            self.smtc.SetPlaybackStatus(if playing { MediaPlaybackStatus::Playing } else { MediaPlaybackStatus::Paused })
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
    pub fn set_playing(&self, _: bool) -> anyhow::Result<()> {
        Ok(())
    }
}
