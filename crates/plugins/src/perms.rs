//! What a plugin may do. Every call from a plugin names a method; each method needs one permission (or none: its own
//! storage, its log, its timers). Checked in Rust before anything happens. Never available: secrets, files, other
//! plugins' data, raw app commands.

use anyhow::{Result, bail, ensure};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "host")]
pub enum Permission {
    /// What plays, play / pause, position; player events.
    PlayerRead,
    /// Play, pause, skip, seek, volume, play songs.
    PlayerControl,
    /// Songs and playlists in the library.
    LibraryRead,
    /// Make playlists, add songs to them.
    LibraryWrite,
    /// Menu items, a panel, notifications.
    Ui,
    /// Restyle the whole interface (CSS).
    UiStyle,
    /// Read and change the Live Editor's settings.
    Editor,
    /// HTTPS requests to this host only, through the app.
    Network(String),
}

/// Host names a plugin may ask for: plain DNS names, no IPs, no wildcards, no local names.
fn host_ok(h: &str) -> bool {
    let labels: Vec<&str> = h.split('.').collect();
    h.len() <= 253
        && labels.len() >= 2
        && labels.iter().all(|l| !l.is_empty() && l.len() <= 63 && l.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') && !l.starts_with('-') && !l.ends_with('-'))
        && !labels.last().unwrap().bytes().all(|b| b.is_ascii_digit())
        && !["localhost", "local", "internal", "lan", "home"].contains(labels.last().unwrap())
}

impl Permission {
    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "player:read" => Self::PlayerRead,
            "player:control" => Self::PlayerControl,
            "library:read" => Self::LibraryRead,
            "library:write" => Self::LibraryWrite,
            "ui" => Self::Ui,
            "ui:style" => Self::UiStyle,
            "editor" => Self::Editor,
            _ => match s.strip_prefix("network:") {
                Some(h) => {
                    ensure!(host_ok(h), "Not a host name a plugin can ask for: {h}");
                    Self::Network(h.to_string())
                }
                None => bail!("Unknown permission: {s}"),
            },
        })
    }

    pub fn as_string(&self) -> String {
        match self {
            Self::PlayerRead => "player:read".into(),
            Self::PlayerControl => "player:control".into(),
            Self::LibraryRead => "library:read".into(),
            Self::LibraryWrite => "library:write".into(),
            Self::Ui => "ui".into(),
            Self::UiStyle => "ui:style".into(),
            Self::Editor => "editor".into(),
            Self::Network(h) => format!("network:{h}"),
        }
    }
}

/// Who handles a call: the plugin's own thread, the app's Rust side, or the interface.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Shell,
    Ui,
}

/// Methods a plugin can call, the permission each needs (None = its own things), and where it goes.
pub const METHODS: &[(&str, Option<&str>, Route)] = &[
    ("log", None, Route::Shell),
    ("storage.get", None, Route::Shell),
    ("storage.set", None, Route::Shell),
    ("storage.remove", None, Route::Shell),
    ("storage.keys", None, Route::Shell),
    ("player.state", Some("player:read"), Route::Ui),
    ("player.play", Some("player:control"), Route::Ui),
    ("player.pause", Some("player:control"), Route::Ui),
    ("player.toggle", Some("player:control"), Route::Ui),
    ("player.next", Some("player:control"), Route::Ui),
    ("player.previous", Some("player:control"), Route::Ui),
    ("player.seek", Some("player:control"), Route::Ui),
    ("player.volume", Some("player:control"), Route::Ui),
    ("player.playTracks", Some("player:control"), Route::Ui),
    ("library.tracks", Some("library:read"), Route::Shell),
    ("library.playlists", Some("library:read"), Route::Shell),
    ("library.playlist", Some("library:read"), Route::Shell),
    ("playlists.create", Some("library:write"), Route::Ui),
    ("playlists.add", Some("library:write"), Route::Ui),
    ("ui.notify", Some("ui"), Route::Ui),
    ("ui.addCommand", Some("ui"), Route::Ui),
    ("ui.removeCommand", Some("ui"), Route::Ui),
    ("ui.setPanel", Some("ui"), Route::Ui),
    ("ui.setStyle", Some("ui:style"), Route::Ui),
    ("editor.get", Some("editor"), Route::Ui),
    ("editor.set", Some("editor"), Route::Ui),
    ("net.fetch", Some("network"), Route::Shell),
];

/// Events a plugin may receive, and the permission each needs.
pub const EVENTS: &[(&str, &str)] = &[("track", "player:read"), ("playing", "player:read"), ("command", "ui"), ("panel", "ui")];

/// May a plugin with `granted` call `method` with `args`? Where does the call go?
pub fn check(granted: &[Permission], method: &str, args: &serde_json::Value) -> Result<Route, String> {
    let Some((_, need, route)) = METHODS.iter().find(|(m, _, _)| *m == method) else { return Err(format!("Unknown method: {method}")) };
    match need {
        None => {}
        Some("network") => {
            let url = args.get("url").and_then(|u| u.as_str()).unwrap_or_default();
            let host = crate::net::https_host(url).ok_or_else(|| "net.fetch: only https:// links".to_string())?;
            if !granted.contains(&Permission::Network(host.clone())) {
                return Err(format!("Permission needed: network:{host}"));
            }
        }
        Some(p) => {
            let p = Permission::parse(p).expect("known permission");
            if !granted.contains(&p) {
                return Err(format!("Permission needed: {}", p.as_string()));
            }
        }
    }
    Ok(*route)
}

/// May a plugin with `granted` receive `event`?
pub fn may_receive(granted: &[Permission], event: &str) -> bool {
    EVENTS.iter().find(|(e, _)| *e == event).is_some_and(|(_, p)| granted.contains(&Permission::parse(p).expect("known permission")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn permissions_and_hosts() {
        assert_eq!(Permission::parse("network:api.example.com").unwrap(), Permission::Network("api.example.com".into()));
        for bad in ["network:localhost", "network:192.168.1.2", "network:*.example.com", "network:example", "network:printer.local", "network:Example.com", "files"] {
            assert!(Permission::parse(bad).is_err(), "{bad}");
        }
        for p in ["player:read", "player:control", "library:read", "library:write", "ui", "ui:style", "editor", "network:a.b"] {
            assert_eq!(Permission::parse(p).unwrap().as_string(), p);
        }
    }

    #[test]
    fn calls_need_their_permission() {
        let granted = [Permission::PlayerRead, Permission::Network("api.example.com".into())];
        assert_eq!(check(&granted, "player.state", &json!({})), Ok(Route::Ui));
        assert!(check(&granted, "player.next", &json!({})).unwrap_err().contains("player:control"));
        assert_eq!(check(&granted, "storage.set", &json!({})), Ok(Route::Shell));
        assert_eq!(check(&granted, "net.fetch", &json!({ "url": "https://api.example.com/v1?q=1" })), Ok(Route::Shell));
        assert!(check(&granted, "net.fetch", &json!({ "url": "https://evil.example.org/" })).is_err());
        assert!(check(&granted, "net.fetch", &json!({ "url": "http://api.example.com/" })).is_err());
        assert!(check(&granted, "secrets.get", &json!({})).is_err());
        assert!(may_receive(&granted, "track"));
        assert!(!may_receive(&granted, "command"));
    }
}
