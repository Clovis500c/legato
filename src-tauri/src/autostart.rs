//! Opens at sign-in (Settings › Advanced). Windows: the HKCU Run entry Task Manager › Startup apps lists.
//! Task Manager's own switch lives in StartupApproved: read here, and turned back on with ours. Elsewhere: not offered.

/// Run value name (Task Manager falls back to it when the exe has no description).
#[cfg(windows)]
const NAME: &str = "Legato";
/// The same entry under the app's first name: `follow` renames it.
#[cfg(windows)]
const OLD_NAME: &str = "Music App";

/// Some(on) on Windows: this exe registered and not turned off in Task Manager. None elsewhere.
pub fn get() -> Option<bool> {
    #[cfg(windows)]
    return Some(std::env::current_exe().is_ok_and(|exe| win::get(NAME, &exe)));
    #[cfg(not(windows))]
    None
}

pub fn set(on: bool) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        // One Run value for every build under this user: a dev or bench build switching it off would switch the real one off.
        anyhow::ensure!(crate::identity::installed(), "Open at startup works in the installed app: another build would change the real app's entry");
        anyhow::ensure!(!on || !cfg!(debug_assertions), "Open at startup works in the installed app: a dev build would start without its dev server");
        win::set(NAME, &std::env::current_exe()?, on)
    }
    #[cfg(not(windows))]
    {
        let _ = on;
        anyhow::bail!("Open at startup is Windows only for now")
    }
}

/// Music App became Legato (2026-10-29): its Run entry takes the new name, and since updates install in a new folder, it
/// may still name the old exe, gone with the old folder: pointed at this one. Task Manager's switch stays as it was.
/// Installed app only (`identity.rs`): any other build would point the real app's entry at itself.
pub fn follow() {
    #[cfg(windows)]
    if !cfg!(debug_assertions)
        && crate::identity::installed()
        && let Ok(exe) = std::env::current_exe()
    {
        let _ = win::rename(OLD_NAME, NAME);
        let _ = win::follow(NAME, &exe);
    }
}

/// Run command. Quoted: install folders can have a space.
#[cfg(any(windows, test))]
fn command(exe: &std::path::Path) -> String {
    format!("\"{}\"", exe.display())
}

/// StartupApproved value: odd first byte = turned off in Task Manager. No value = on.
#[cfg(any(windows, test))]
fn approved(value: Option<&[u8]>) -> bool {
    value.and_then(|v| v.first()).is_none_or(|b| b & 1 == 0)
}

#[cfg(windows)]
mod win {
    use anyhow::Result;
    use std::path::Path;
    use windows_registry::{CURRENT_USER, Type};

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    /// Task Manager's "Enabled".
    const ENABLED: [u8; 12] = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const NOT_FOUND: i32 = 0x8007_0002_u32 as i32;

    /// Registered for this exe (an old dev build or install path doesn't count) and on in Task Manager.
    pub fn get(name: &str, exe: &Path) -> bool {
        let ours = CURRENT_USER.open(RUN).and_then(|k| k.get_string(name)).is_ok_and(|v| v.eq_ignore_ascii_case(&super::command(exe)));
        let value = CURRENT_USER.open(APPROVED).and_then(|k| k.get_value(name)).ok();
        ours && super::approved(value.as_deref())
    }

    /// Entry made under `old`: now under `new`, Task Manager's switch with it.
    pub fn rename(old: &str, new: &str) -> Result<()> {
        let Ok(command) = CURRENT_USER.open(RUN).and_then(|k| k.get_string(old)) else { return Ok(()) };
        CURRENT_USER.create(RUN)?.set_string(new, &command)?;
        if let Ok(switch) = CURRENT_USER.open(APPROVED).and_then(|k| k.get_value(old)) {
            CURRENT_USER.create(APPROVED)?.set_bytes(new, Type::Bytes, &switch)?;
        }
        set(old, Path::new(""), false)
    }

    /// Entry naming an exe that no longer exists: now `exe`. Ours already, another exe that exists, or none: left alone.
    pub fn follow(name: &str, exe: &Path) -> Result<()> {
        let Ok(old) = CURRENT_USER.open(RUN).and_then(|k| k.get_string(name)) else { return Ok(()) };
        if !old.eq_ignore_ascii_case(&super::command(exe)) && !Path::new(old.trim_matches('"')).exists() {
            CURRENT_USER.create(RUN)?.set_string(name, super::command(exe))?;
        }
        Ok(())
    }

    pub fn set(name: &str, exe: &Path, on: bool) -> Result<()> {
        if on {
            CURRENT_USER.create(RUN)?.set_string(name, super::command(exe))?;
            CURRENT_USER.create(APPROVED)?.set_bytes(name, Type::Bytes, &ENABLED)?;
            return Ok(());
        }
        for path in [RUN, APPROVED] {
            match CURRENT_USER.options().write().open(path).and_then(|k| k.remove_value(name)) {
                Err(e) if e.code().0 != NOT_FOUND => return Err(e.into()),
                _ => {}
            }
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        /// Real HKCU, own value name, fake exe (harmless if left behind). By hand: cargo test -p legato -- --ignored
        #[test]
        #[ignore = "writes the user's registry"]
        fn round_trip_and_task_manager_switch() {
            let (name, exe) = ("Music App test entry", Path::new(r"C:\Nowhere\Music App\music-app.exe"));
            set(name, exe, true).unwrap();
            assert_eq!(CURRENT_USER.open(RUN).unwrap().get_string(name).unwrap(), r#""C:\Nowhere\Music App\music-app.exe""#);
            assert!(get(name, exe));
            assert!(!get(name, Path::new(r"C:\Other\music-app.exe")));
            // Switched off in Task Manager.
            CURRENT_USER.create(APPROVED).unwrap().set_bytes(name, Type::Bytes, &[3, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]).unwrap();
            assert!(!get(name, exe));
            set(name, exe, true).unwrap();
            assert!(get(name, exe));
            set(name, exe, false).unwrap();
            assert!(!get(name, exe));
            assert!(CURRENT_USER.open(RUN).unwrap().get_string(name).is_err());
            set(name, exe, false).unwrap();
        }

        /// Same, by hand: an entry left on a removed install follows this exe; one on an exe that exists stays.
        #[test]
        #[ignore = "writes the user's registry"]
        fn follows_a_moved_install() {
            let (old, name, gone, here) = ("Legato test old entry", "Legato test entry 2", Path::new(r"C:\Nowhere\Music App\music-app.exe"), std::env::current_exe().unwrap());
            set(old, gone, true).unwrap();
            rename(old, name).unwrap();
            assert!(CURRENT_USER.open(RUN).unwrap().get_string(old).is_err());
            follow(name, &here).unwrap();
            assert!(get(name, &here));
            follow(name, gone).unwrap();
            assert!(get(name, &here));
            set(name, &here, false).unwrap();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_is_quoted() {
        assert_eq!(command(std::path::Path::new(r"C:\Users\a\AppData\Local\Music App\music-app.exe")), r#""C:\Users\a\AppData\Local\Music App\music-app.exe""#);
    }

    #[test]
    fn task_manager_switch() {
        assert!(approved(None));
        assert!(approved(Some(&[2, 0, 0, 0])));
        assert!(approved(Some(&[6, 0])));
        assert!(!approved(Some(&[3, 0, 0, 0, 9, 9])));
        assert!(!approved(Some(&[7])));
        assert!(approved(Some(&[])));
    }
}
