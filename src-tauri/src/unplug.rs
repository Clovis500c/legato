//! Headphones unplugged, Bluetooth headset off or out of range: Windows moves the sound to the speakers. Its endpoint
//! notifications (IMMNotificationClient) say when the default output leaves; the interface pauses (setting
//! `pauseOnUnplug`). A new default, picked or taking over, gets the native player's song (`Command::Reopen`); WebView2
//! follows on its own. Calls: Windows' communications ducking (IAudioVolumeDuckNotification on the default output)
//! says when a call starts and ends; the interface may pause, then play on (setting `pauseOnCall`).
// Limit: headphones and speakers on one endpoint (Realtek jack retasking) change no endpoint: no event, no pause.

use std::time::{Duration, Instant};

/// Windows may move the default before it says the old one left: a device that was the default this recently counts.
const GRACE: Duration = Duration::from_secs(2);

/// What Windows' callbacks said.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug)]
enum Change {
    /// Device left: unplugged, turned off, disabled, removed.
    Gone(String),
    /// Device active again.
    Back(String),
    /// New default output (None: no output left).
    Default(Option<String>),
    /// A call (communications stream) started or ended.
    Call(bool),
}

/// What a change means for the app.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Default, PartialEq)]
struct Heard {
    /// The output playing is lost: pause.
    lost: bool,
    /// Another device is the default now: the native player moves to it.
    moved: bool,
    /// A call started (true) or ended (false).
    call: Option<bool>,
}

/// When the output playing is lost or replaced, when a call starts or ends. Pure: fed the changes in order.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Default)]
struct Watch {
    now: Option<String>,
    /// Default before, and when it stopped being it.
    before: Option<(String, Instant)>,
    /// Device already told lost: once, until it comes back.
    told: Option<String>,
    in_call: bool,
}

#[cfg_attr(not(windows), allow(dead_code))]
impl Watch {
    fn hear(&mut self, change: Change, at: Instant) -> Heard {
        match change {
            Change::Default(id) => {
                let moved = id.is_some() && id != self.now;
                if let Some(old) = self.now.take().filter(|old| Some(old) != id.as_ref()) {
                    self.before = Some((old, at));
                }
                self.now = id;
                Heard { moved, ..Heard::default() }
            }
            Change::Back(id) => {
                if self.told.as_ref() == Some(&id) {
                    self.told = None;
                }
                Heard::default()
            }
            Change::Gone(id) => {
                let was = self.before.as_ref().is_some_and(|(old, t)| *old == id && at.duration_since(*t) < GRACE);
                if !(self.now.as_ref() == Some(&id) || was) || self.told.as_ref() == Some(&id) {
                    return Heard::default();
                }
                self.told = Some(id);
                Heard { lost: true, ..Heard::default() }
            }
            // Windows says it per stream and per device: told once a change.
            Change::Call(on) if on != self.in_call => {
                self.in_call = on;
                Heard { call: Some(on), ..Heard::default() }
            }
            Change::Call(_) => Heard::default(),
        }
    }
}

#[cfg(windows)]
pub use imp::spawn;

#[cfg(windows)]
mod imp {
    use super::{Change, Watch};
    use std::sync::mpsc::{channel, Sender};
    use std::time::Instant;
    use tauri::{AppHandle, Emitter, Manager};
    use windows::core::{implement, Result, PCWSTR};
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Media::Audio::{eConsole, eRender, EDataFlow, ERole, IAudioSessionManager2, IAudioVolumeDuckNotification, IAudioVolumeDuckNotification_Impl, IMMDeviceEnumerator, IMMNotificationClient, IMMNotificationClient_Impl, MMDeviceEnumerator, DEVICE_STATE, DEVICE_STATE_ACTIVE};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED};

    /// Windows' callbacks must not block: they only pass the change on.
    #[implement(IMMNotificationClient)]
    struct Client(Sender<Change>);

    /// Ducking: a communications stream opened (a call) or closed.
    #[implement(IAudioVolumeDuckNotification)]
    struct Duck(Sender<Change>);

    fn text(id: &PCWSTR) -> Option<String> {
        if id.is_null() {
            return None;
        }
        unsafe { id.to_string() }.ok()
    }

    impl IMMNotificationClient_Impl for Client_Impl {
        fn OnDeviceStateChanged(&self, id: &PCWSTR, state: DEVICE_STATE) -> Result<()> {
            if let Some(id) = text(id) {
                let _ = self.0.send(if state == DEVICE_STATE_ACTIVE { Change::Back(id) } else { Change::Gone(id) });
            }
            Ok(())
        }

        fn OnDeviceAdded(&self, _: &PCWSTR) -> Result<()> {
            Ok(())
        }

        fn OnDeviceRemoved(&self, id: &PCWSTR) -> Result<()> {
            if let Some(id) = text(id) {
                let _ = self.0.send(Change::Gone(id));
            }
            Ok(())
        }

        // Console role: the default the native player (cpal) and WebView2 open.
        fn OnDefaultDeviceChanged(&self, flow: EDataFlow, role: ERole, id: &PCWSTR) -> Result<()> {
            if flow == eRender && role == eConsole {
                let _ = self.0.send(Change::Default(text(id)));
            }
            Ok(())
        }

        fn OnPropertyValueChanged(&self, _: &PCWSTR, _: &PROPERTYKEY) -> Result<()> {
            Ok(())
        }
    }

    impl IAudioVolumeDuckNotification_Impl for Duck_Impl {
        fn OnVolumeDuckNotification(&self, _: &PCWSTR, sessions: u32) -> Result<()> {
            let _ = self.0.send(Change::Call(sessions > 0));
            Ok(())
        }

        fn OnVolumeUnduckNotification(&self, _: &PCWSTR) -> Result<()> {
            let _ = self.0.send(Change::Call(false));
            Ok(())
        }
    }

    fn default_id(devices: &IMMDeviceEnumerator) -> Option<String> {
        unsafe {
            let id = devices.GetDefaultAudioEndpoint(eRender, eConsole).ok()?.GetId().ok()?;
            let out = id.to_string().ok();
            CoTaskMemFree(Some(id.0 as _));
            out
        }
    }

    /// Ducking notifications of the default output, every session's (no session of ours to change).
    fn listen_calls(devices: &IMMDeviceEnumerator, duck: &IAudioVolumeDuckNotification) -> Option<IAudioSessionManager2> {
        unsafe {
            let manager: IAudioSessionManager2 = devices.GetDefaultAudioEndpoint(eRender, eConsole).ok()?.Activate(CLSCTX_ALL, None).ok()?;
            manager.RegisterDuckNotification(PCWSTR::null(), duck).ok()?;
            Some(manager)
        }
    }

    /// Thread holding the registrations for the app's life; emits `audio-output-lost` and `audio-call`.
    pub fn spawn(app: AppHandle) {
        let _ = std::thread::Builder::new().name("output-watch".into()).spawn(move || {
            let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            let Ok(devices) = (unsafe { CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) }) else { return };
            let (tx, rx) = channel();
            let duck: IAudioVolumeDuckNotification = Duck(tx.clone()).into();
            let client: IMMNotificationClient = Client(tx).into();
            if unsafe { devices.RegisterEndpointNotificationCallback(&client) }.is_err() {
                return;
            }
            let mut watch = Watch { now: default_id(&devices), ..Watch::default() };
            let mut calls = listen_calls(&devices, &duck);
            // Never ends: the clients (holding the senders) stay registered.
            for change in rx {
                let heard = watch.hear(change, Instant::now());
                if heard.lost {
                    let _ = app.emit("audio-output-lost", ());
                }
                if heard.moved {
                    if let Some(old) = calls.take() {
                        let _ = unsafe { old.UnregisterDuckNotification(&duck) };
                    }
                    calls = listen_calls(&devices, &duck);
                    if let Some(state) = app.try_state::<crate::AppState>() {
                        state.player.send(music_player::Command::Reopen);
                    }
                }
                if let Some(on) = heard.call {
                    let _ = app.emit("audio-call", on);
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{Change, Heard, Watch, GRACE};
    use std::time::{Duration, Instant};

    fn s(id: &str) -> String {
        id.to_string()
    }

    const LOST: Heard = Heard { lost: true, moved: false, call: None };
    const MOVED: Heard = Heard { lost: false, moved: true, call: None };
    const NOTHING: Heard = Heard { lost: false, moved: false, call: None };

    #[test]
    fn the_default_leaving_is_told_once_in_either_order() {
        let t = Instant::now();
        // Gone first, then the new default.
        let mut w = Watch { now: Some(s("phones")), ..Watch::default() };
        assert_eq!(w.hear(Change::Gone(s("phones")), t), LOST);
        assert_eq!(w.hear(Change::Default(Some(s("speakers"))), t), MOVED);
        assert_eq!(w.hear(Change::Gone(s("phones")), t), NOTHING);
        // New default first, then gone.
        let mut w = Watch { now: Some(s("phones")), ..Watch::default() };
        assert_eq!(w.hear(Change::Default(Some(s("speakers"))), t), MOVED);
        assert_eq!(w.hear(Change::Gone(s("phones")), t + Duration::from_millis(50)), LOST);
        // Last output gone: no default at all, nowhere to move to.
        let mut w = Watch { now: Some(s("bt")), ..Watch::default() };
        assert_eq!(w.hear(Change::Default(None), t), NOTHING);
        assert_eq!(w.hear(Change::Gone(s("bt")), t), LOST);
    }

    #[test]
    fn other_devices_and_a_picked_default_pause_nothing() {
        let t = Instant::now();
        let mut w = Watch { now: Some(s("phones")), ..Watch::default() };
        // Another device leaves.
        assert_eq!(w.hear(Change::Gone(s("hdmi")), t), NOTHING);
        // The user picks the speakers (the song moves there); the headphones leave long after.
        assert_eq!(w.hear(Change::Default(Some(s("speakers"))), t), MOVED);
        assert_eq!(w.hear(Change::Gone(s("phones")), t + GRACE), NOTHING);
        // Windows says the same default again: nothing moves.
        assert_eq!(w.hear(Change::Default(Some(s("speakers"))), t), NOTHING);
    }

    #[test]
    fn a_device_back_can_be_lost_again() {
        let t = Instant::now();
        let mut w = Watch { now: Some(s("bt")), ..Watch::default() };
        assert_eq!(w.hear(Change::Gone(s("bt")), t), LOST);
        assert_eq!(w.hear(Change::Back(s("bt")), t), NOTHING);
        assert_eq!(w.hear(Change::Gone(s("bt")), t), LOST);
    }

    #[test]
    fn a_call_is_told_when_it_starts_and_when_it_ends() {
        let t = Instant::now();
        let mut w = Watch::default();
        let call = |on| Heard { call: Some(on), ..Heard::default() };
        assert_eq!(w.hear(Change::Call(true), t), call(true));
        // A second stream of the same call: nothing new.
        assert_eq!(w.hear(Change::Call(true), t), NOTHING);
        assert_eq!(w.hear(Change::Call(false), t), call(false));
        assert_eq!(w.hear(Change::Call(false), t), NOTHING);
    }
}
