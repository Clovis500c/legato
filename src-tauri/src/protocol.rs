//! The `legato://` link type (the share page's "Open in Legato"). The installed app registers it for this user
//! (HKCU\Software\Classes\legato, no admin); Windows then starts `legato.exe "legato://playlist/…"`, or hands the link to
//! the running one (single instance in lib.rs). The text is untrusted: it waits here until the interface takes it
//! (`link_pending`), which reads it like a pasted one (`isShareCode`, then the same import dialog) and nothing else.
//! Installed app only: the key is outside the app's folders (identity.rs). The installer's uninstall hook removes it.
//! A `.lmix` file double-clicked comes the same way, as its path (`file_of`): the installer registers that file type
//! (`tauri.windows.conf.json`), never the running app, and its uninstaller removes it.

// Windows only; the argument parsing below is tested on every system.
#![cfg_attr(not(windows), allow(dead_code))]

use std::sync::Mutex;

/// A link longer than this is dropped (a command line holds 32 767 characters).
const MAX: usize = 30_000;

/// The `legato://` argument of a launch, as text: that scheme only, no control characters, not too long.
pub fn arg_of(args: &[String]) -> Option<String> {
    args.iter().skip(1).find(|a| a.get(..9).is_some_and(|p| p.eq_ignore_ascii_case("legato://"))).filter(|a| a.len() <= MAX && !a.chars().any(char::is_control)).cloned()
}

/// A `.lmix` file double-clicked (the installer's file type, `tauri.windows.conf.json`: Windows starts `legato.exe "<path>"`):
/// its path, absolute, that extension, not a folder, no control characters. Only a path: `lmix_read` checks its size and
/// content as for a dropped file; nothing runs it.
pub fn file_of(args: &[String]) -> Option<String> {
    use std::path::Path;
    args.iter().skip(1).find(|a| {
        let p = Path::new(a.as_str());
        a.len() <= MAX && !a.chars().any(char::is_control) && p.is_absolute() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("lmix")) && !p.is_dir()
    }).cloned()
}

static PENDING: Mutex<Option<String>> = Mutex::new(None);

/// A launch's arguments (this one at start, a second one forwarded): true when they carry a link or a remix file, kept
/// for the interface.
pub fn note(args: &[String]) -> bool {
    let Some(link) = arg_of(args).or_else(|| file_of(args)) else { return false };
    *PENDING.lock().unwrap() = Some(link);
    true
}

/// The link (or the remix file's path) a launch carried, once.
#[tauri::command]
pub fn link_pending() -> Option<String> {
    PENDING.lock().unwrap().take()
}

/// The link type pointed at this exe, when it is the installed app (updates install in a new folder: a command naming a
/// gone exe is replaced, another working one is left alone).
pub fn register() {
    #[cfg(windows)]
    if !cfg!(debug_assertions)
        && crate::identity::installed()
        && let Ok(exe) = std::env::current_exe()
    {
        let _ = win::register(&exe);
    }
}

#[cfg(any(windows, test))]
fn command(exe: &std::path::Path) -> String {
    format!("\"{}\" \"%1\"", exe.display())
}

/// The exe a registered command names.
#[cfg(any(windows, test))]
fn exe_of(command: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(command.trim_start().strip_prefix('"').and_then(|c| c.split('"').next()).unwrap_or_default())
}

#[cfg(windows)]
mod win {
    use anyhow::Result;
    use std::path::Path;
    use windows_registry::CURRENT_USER;

    const KEY: &str = r"Software\Classes\legato";
    const COMMAND: &str = r"Software\Classes\legato\shell\open\command";

    pub fn register(exe: &Path) -> Result<()> {
        let want = super::command(exe);
        match CURRENT_USER.open(COMMAND).and_then(|k| k.get_string("")) {
            Ok(have) if have.eq_ignore_ascii_case(&want) => return Ok(()),
            Ok(have) if super::exe_of(&have).exists() => return Ok(()),
            _ => {}
        }
        let root = CURRENT_USER.create(KEY)?;
        root.set_string("", "URL:Legato")?;
        root.set_string("URL Protocol", "")?;
        CURRENT_USER.create(COMMAND)?.set_string("", &want)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn only_a_clean_legato_link_is_kept() {
        assert_eq!(arg_of(&args(&["legato.exe", "legato://playlist/ABC"])).as_deref(), Some("legato://playlist/ABC"));
        assert_eq!(arg_of(&args(&["legato.exe", "LEGATO://playlist/x"])).as_deref(), Some("LEGATO://playlist/x"));
        assert_eq!(arg_of(&args(&["legato.exe", "--jump", "shuffle"])), None);
        assert_eq!(arg_of(&args(&["legato.exe", "https://x.example/legato://"])), None);
        assert_eq!(arg_of(&args(&["legato://playlist/first-is-the-exe"])), None);
        assert_eq!(arg_of(&args(&["legato.exe", "legato://playlist/a\nb"])), None);
        assert_eq!(arg_of(&args(&["legato.exe", &format!("legato://playlist/{}", "a".repeat(MAX))])), None);
        assert_eq!(arg_of(&args(&["legato.exe", "é"])), None);
    }

    #[test]
    fn a_double_clicked_remix_file_is_kept_as_its_absolute_path() {
        let dir = std::env::temp_dir();
        let path = |name: &str| dir.join(name).to_string_lossy().into_owned();
        let spaced = path("My mixes/Été · remix.LMIX");
        assert_eq!(file_of(&args(&["legato.exe", &spaced])).as_deref(), Some(spaced.as_str()));
        // Two files: the first; the Jump List's argument and a link are not files.
        let other = path("b.lmix");
        assert_eq!(file_of(&args(&["legato.exe", &spaced, &other])).as_deref(), Some(spaced.as_str()));
        assert_eq!(file_of(&args(&["legato.exe", "--jump", "shuffle"])), None);
        assert_eq!(file_of(&args(&["legato.exe", "legato://remix/abc"])), None);
        // Longer than MAX_PATH is still a path; past what a command line holds, dropped.
        let long = path(&format!("{}.lmix", "a".repeat(300)));
        assert_eq!(file_of(&args(&["legato.exe", &long])).as_deref(), Some(long.as_str()));
        assert_eq!(file_of(&args(&["legato.exe", &path(&format!("{}.lmix", "a".repeat(MAX)))])), None);
        // Relative, another type, the exe itself, a control character, a folder: none.
        for bad in ["mix.lmix", r"..\mix.lmix", &path("mix.lmix.exe"), &path("mix.json"), &path("a\nb.lmix")] {
            assert_eq!(file_of(&args(&["legato.exe", bad])), None, "{bad}");
        }
        assert_eq!(file_of(&args(&[&spaced])), None);
        let folder = dir.join("legato-test-folder.lmix");
        std::fs::create_dir_all(&folder).unwrap();
        assert_eq!(file_of(&args(&["legato.exe", &folder.to_string_lossy()])), None);
        let _ = std::fs::remove_dir(&folder);
    }

    #[test]
    fn the_registered_command_quotes_the_exe_and_the_link() {
        let exe = std::path::Path::new(r"C:\Program Files\Legato\legato.exe");
        assert_eq!(command(exe), r#""C:\Program Files\Legato\legato.exe" "%1""#);
        assert_eq!(exe_of(&command(exe)), exe);
        assert_eq!(exe_of("nonsense"), std::path::PathBuf::new());
    }

    #[test]
    fn a_link_waits_for_the_interface_once() {
        assert!(!note(&args(&["legato.exe"])));
        assert!(note(&args(&["legato.exe", "legato://playlist/Z"])));
        assert_eq!(link_pending().as_deref(), Some("legato://playlist/Z"));
        assert_eq!(link_pending(), None);
        // A double-clicked remix file the same way (one test: the pending slot is shared).
        let file = std::env::temp_dir().join("w.lmix").to_string_lossy().into_owned();
        assert!(note(&args(&["legato.exe", &file])));
        assert_eq!(link_pending(), Some(file));
    }
}
