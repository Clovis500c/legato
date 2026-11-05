//! The taskbar button's Jump List (right-click Legato on the taskbar, or its Start entry): Shuffle all, then your
//! playlists opened lately. Each entry starts legato.exe with `--jump <what>`; the ask waits here until the interface
//! takes it (`jump_pending`): at its start for a closed app, on the "jump" event for a running one (second launch,
//! single instance in lib.rs). Installed app only: Windows keeps the list outside the app's folders (identity.rs).

// Windows only; the parsing below is tested on every system (CI), where nothing else calls it.
#![cfg_attr(not(windows), allow(dead_code))]

use serde::Deserialize;
use std::sync::Mutex;

/// Playlists in the list (Windows shows about ten entries, tasks included).
pub const MAX: usize = 5;
/// The Shuffle all task's arguments.
const SHUFFLE: &str = "--jump shuffle";

/// A playlist for the list: its library id and the name shown.
#[derive(Debug, Clone, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct JumpPlaylist {
    pub id: i64,
    pub name: String,
}

/// What a launch's arguments ask for: `shuffle` or `playlist:<id>`, anything else dropped.
pub fn arg_of(args: &[String]) -> Option<String> {
    let v = args.iter().skip_while(|a| *a != "--jump").nth(1)?;
    let id = |id: &str| (1..=18).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit());
    (v == "shuffle" || v.strip_prefix("playlist:").is_some_and(id)).then(|| v.clone())
}

/// Playlists as (arguments, title): MAX at most, each once, names cut short (the menu is narrow), nameless ones out.
pub fn playlist_links(playlists: &[JumpPlaylist]) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for p in playlists {
        let args = format!("--jump playlist:{}", p.id);
        let name = cut(&p.name);
        if p.id > 0 && !name.is_empty() && !out.iter().any(|(a, _)| *a == args) {
            out.push((args, name));
        }
        if out.len() == MAX {
            break;
        }
    }
    out
}

/// Trust boundary (text from the UI): trimmed, 100 characters at most.
fn cut(s: &str) -> String {
    s.trim().chars().take(100).collect()
}

/// The entry a launch asked for, until the interface takes it.
static PENDING: Mutex<Option<String>> = Mutex::new(None);

/// A launch's arguments (this one at start, a second one forwarded): true when they ask for an entry, kept for the
/// interface.
pub fn note(args: &[String]) -> bool {
    let Some(jump) = arg_of(args) else { return false };
    *PENDING.lock().unwrap() = Some(jump);
    true
}

/// The Jump List entry asked for, once: `shuffle` or `playlist:<id>`.
#[tauri::command]
pub fn jump_pending() -> Option<String> {
    PENDING.lock().unwrap().take()
}

/// The list written again (titles in the interface's language). Off the caller's thread; a failure is logged.
#[tauri::command]
pub async fn set_jump_list(shuffle: String, recent: String, playlists: Vec<JumpPlaylist>) {
    if !crate::identity::installed() {
        return;
    }
    #[cfg(windows)]
    {
        let (shuffle, recent, links) = (cut(&shuffle), cut(&recent), playlist_links(&playlists));
        std::thread::spawn(move || {
            if let Err(e) = imp::write(&shuffle, &recent, &links) {
                crate::diag::warn("jumplist", "jump list not written", &format!("{e:#}"));
            }
        });
    }
    #[cfg(not(windows))]
    let _ = (shuffle, recent, playlists);
}

#[cfg(windows)]
mod imp {
    use super::SHUFFLE;
    use std::sync::Mutex;
    use windows::Win32::Foundation::E_OUTOFMEMORY;
    use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
    use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PropVariantClear};
    use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemAlloc, CoUninitialize};
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW, ShellLink};
    use windows::core::{HSTRING, Interface, PWSTR};

    /// One write at a time (two quick changes).
    static WRITING: Mutex<()> = Mutex::new(());

    /// Text in a PROPVARIANT (VT_LPWSTR), from COM's allocator: PropVariantClear frees it.
    unsafe fn text(s: &str) -> windows::core::Result<PROPVARIANT> {
        let wide: Vec<u16> = s.encode_utf16().chain([0]).collect();
        unsafe {
            let p = CoTaskMemAlloc(wide.len() * 2) as *mut u16;
            if p.is_null() {
                return Err(E_OUTOFMEMORY.into());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), p, wide.len());
            let mut v = PROPVARIANT::default();
            (*v.Anonymous.Anonymous).vt = VT_LPWSTR;
            (*v.Anonymous.Anonymous).Anonymous.pwszVal = PWSTR(p);
            Ok(v)
        }
    }

    /// This exe with `args`, its icon, `title` shown.
    unsafe fn link(exe: &HSTRING, args: &str, title: &str) -> windows::core::Result<IShellLinkW> {
        unsafe {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.SetPath(exe)?;
            link.SetArguments(&HSTRING::from(args))?;
            link.SetIconLocation(exe, 0)?;
            let store: IPropertyStore = link.cast()?;
            let mut title = text(title)?;
            let set = store.SetValue(&PKEY_Title, &title).and_then(|()| store.Commit());
            let _ = PropVariantClear(&mut title);
            set?;
            Ok(link)
        }
    }

    /// Arguments of an entry the user removed from the list (not put back: Windows refuses the whole category then).
    unsafe fn removed_args(items: &IObjectArray, i: u32) -> Option<String> {
        unsafe {
            let link: IShellLinkW = items.GetAt(i).ok()?;
            let mut buf = [0u16; 512];
            link.GetArguments(&mut buf).ok()?;
            let n = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            Some(String::from_utf16_lossy(&buf[..n]))
        }
    }

    unsafe fn build(list: &ICustomDestinationList, exe: &HSTRING, shuffle: &str, recent: &str, links: &[(String, String)]) -> windows::core::Result<()> {
        unsafe {
            let mut slots = 0u32;
            let removed: IObjectArray = list.BeginList(&mut slots)?;
            let gone: Vec<String> = (0..removed.GetCount()?).filter_map(|i| removed_args(&removed, i)).collect();
            let tasks: IObjectCollection = CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
            tasks.AddObject(&link(exe, SHUFFLE, shuffle)?)?;
            list.AddUserTasks(&tasks.cast::<IObjectArray>()?)?;
            let kept: Vec<_> = links.iter().filter(|(args, _)| !gone.contains(args)).take(slots.max(1) as usize).collect();
            if !kept.is_empty() {
                let category: IObjectCollection = CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
                for (args, title) in kept {
                    category.AddObject(&link(exe, args, title)?)?;
                }
                list.AppendCategory(&HSTRING::from(recent), &category.cast::<IObjectArray>()?)?;
            }
            list.CommitList()
        }
    }

    pub fn write(shuffle: &str, recent: &str, links: &[(String, String)]) -> anyhow::Result<()> {
        let _one = WRITING.lock().unwrap_or_else(|e| e.into_inner());
        let exe = HSTRING::from(std::env::current_exe()?.as_os_str());
        unsafe {
            // Own thread: COM set up here, taken down after.
            let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let list: windows::core::Result<ICustomDestinationList> = CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER);
            let out = list.and_then(|list| {
                let built = build(&list, &exe, shuffle, recent, links);
                if built.is_err() {
                    let _ = list.AbortList();
                }
                built
            });
            if init.is_ok() {
                CoUninitialize();
            }
            Ok(out?)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(s: &str) -> Vec<String> {
        s.split(' ').map(String::from).collect()
    }

    #[test]
    fn a_launch_says_which_entry_it_came_from() {
        assert_eq!(arg_of(&args("legato.exe --jump shuffle")).as_deref(), Some("shuffle"));
        assert_eq!(arg_of(&args("legato.exe --jump playlist:42")).as_deref(), Some("playlist:42"));
        // Only what the list writes.
        for bad in ["legato.exe", "legato.exe --jump", "legato.exe --jump play", "legato.exe --jump playlist:", "legato.exe --jump playlist:-3", "legato.exe --jump playlist:4x", "legato.exe --jump playlist:1234567890123456789", "legato.exe shuffle --jump"] {
            assert_eq!(arg_of(&args(bad)), None, "{bad}");
        }
    }

    #[test]
    fn the_list_holds_a_few_named_playlists_once() {
        let p = |id: i64, name: &str| JumpPlaylist { id, name: name.into() };
        let long = "x".repeat(150);
        let links = playlist_links(&[p(1, " Road trip "), p(1, "Road trip"), p(0, "Ghost"), p(2, "  "), p(3, &long), p(4, "a"), p(5, "b"), p(6, "c"), p(7, "d")]);
        assert_eq!(links.len(), MAX);
        assert_eq!(links[0], ("--jump playlist:1".into(), "Road trip".into()));
        assert_eq!(links[1].1.chars().count(), 100);
        assert_eq!(links[4].0, "--jump playlist:6");
        // Each entry's arguments read back as what it asks for.
        for (a, _) in &links {
            assert!(arg_of(&args(&format!("legato.exe {a}"))).is_some());
        }
        assert_eq!(arg_of(&args(&format!("legato.exe {SHUFFLE}"))).as_deref(), Some("shuffle"));
    }

    #[test]
    fn an_asked_entry_is_taken_once() {
        assert!(!note(&args("legato.exe --minimized")));
        assert!(note(&args("legato.exe --jump playlist:9")));
        assert_eq!(jump_pending().as_deref(), Some("playlist:9"));
        assert_eq!(jump_pending(), None);
    }
}
