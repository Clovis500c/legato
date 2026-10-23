//! Windows volume mixer: YouTube's sound comes out of WebView2's own processes (msedgewebview2.exe), so Windows listed
//! it as "Microsoft Edge WebView2". Our WebView2 audio sessions get Music App's name, icon and grouping, joining the
//! native player's session. Only processes started by this app: other apps' WebView2 (Teams…) are left alone.
//! Label only: the sound itself still plays in WebView2, never taken out of the player.

use std::collections::HashMap;

/// True when `pid` was started by `me`, directly or a few levels down (WebView2: browser → audio utility process).
#[cfg_attr(not(windows), allow(dead_code))]
fn descends(mut pid: u32, me: u32, parents: &HashMap<u32, u32>) -> bool {
    for _ in 0..4 {
        match parents.get(&pid) {
            Some(&p) if p == me => return true,
            Some(&p) if p != 0 && p != pid => pid = p,
            _ => return false,
        }
    }
    false
}

#[cfg(windows)]
pub use imp::spawn;

#[cfg(windows)]
mod imp {
    use super::descends;
    use std::collections::HashMap;
    use std::time::Duration;
    use windows::core::{Interface, GUID, PCWSTR};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Media::Audio::{eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED};
    use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};

    const NAME: &str = "Music App";
    /// Same value on every Music App session: the mixer shows them as one app.
    const GROUP: GUID = GUID::from_u128(0x6d75_7369_6361_7070_6d69_7865_7200_0001);

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain([0]).collect()
    }

    fn parents() -> HashMap<u32, u32> {
        let mut out = HashMap::new();
        unsafe {
            let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
            let mut e = PROCESSENTRY32W { dwSize: size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
            let mut ok = Process32FirstW(snap, &mut e).is_ok();
            while ok {
                out.insert(e.th32ProcessID, e.th32ParentProcessID);
                ok = Process32NextW(snap, &mut e).is_ok();
            }
            let _ = CloseHandle(snap);
        }
        out
    }

    /// One pass over every active output device. Already-named sessions are skipped (no mixer churn).
    unsafe fn claim(icon: &[u16]) -> windows::core::Result<()> {
        let me = std::process::id();
        let tree = parents();
        let name = wide(NAME);
        let devices = unsafe { CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)?.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)? };
        for d in 0..unsafe { devices.GetCount()? } {
            let manager: IAudioSessionManager2 = unsafe { devices.Item(d)?.Activate(CLSCTX_ALL, None)? };
            let sessions = unsafe { manager.GetSessionEnumerator()? };
            for i in 0..unsafe { sessions.GetCount()? } {
                let Ok(s) = (unsafe { sessions.GetSession(i) }).and_then(|s| s.cast::<IAudioSessionControl2>()) else { continue };
                // Multi-process sessions have no single pid: not ours.
                let Ok(pid) = (unsafe { s.GetProcessId() }) else { continue };
                if pid == me {
                    let _ = unsafe { s.SetGroupingParam(&GROUP, std::ptr::null()) };
                    continue;
                }
                if !descends(pid, me, &tree) {
                    continue;
                }
                let done = unsafe { s.GetDisplayName() }.is_ok_and(|n| {
                    let same = unsafe { n.to_string() }.is_ok_and(|n| n == NAME);
                    unsafe { CoTaskMemFree(Some(n.0 as _)) };
                    same
                });
                if done {
                    continue;
                }
                unsafe {
                    s.SetDisplayName(PCWSTR(name.as_ptr()), std::ptr::null())?;
                    s.SetIconPath(PCWSTR(icon.as_ptr()), std::ptr::null())?;
                    s.SetGroupingParam(&GROUP, std::ptr::null())?;
                }
            }
        }
        Ok(())
    }

    /// Background thread, a pass every 3 s.
    // shortcut: polling, not IAudioSessionNotification callbacks; the label can lag 3 s behind a new session.
    pub fn spawn() {
        let icon = std::env::current_exe().map(|p| wide(&format!("{},0", p.display()))).unwrap_or_else(|_| wide(""));
        let _ = std::thread::Builder::new().name("mixer-label".into()).spawn(move || {
            let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            loop {
                let _ = unsafe { claim(&icon) };
                std::thread::sleep(Duration::from_secs(3));
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::descends;

    #[test]
    fn only_our_process_tree() {
        // 10 = app, 20 = WebView2 browser, 30 = its audio process; 99 = another app's WebView2.
        let tree = [(20, 10), (30, 20), (99, 5), (5, 0), (10, 1)].into_iter().collect();
        assert!(descends(20, 10, &tree));
        assert!(descends(30, 10, &tree));
        assert!(!descends(99, 10, &tree));
        assert!(!descends(42, 10, &tree));
        // A loop in stale data ends.
        let looped = [(7, 8), (8, 7)].into_iter().collect();
        assert!(!descends(7, 10, &looped));
    }
}
