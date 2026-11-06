//! Personal servers (Settings › Accounts › Your music server): the user's own music on the user's own server.
//! Subsonic-compatible (Navidrome, Airsonic, Gonic, Ampache), Jellyfin and Plex, on the same account and ids.
//! Library ids: `Source::Server` → "<server key>:<item id>", one key per server account.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::IpAddr;

/// Which API the server speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "ServerKind")]
pub enum Kind {
    /// Subsonic API 1.16.1 and its OpenSubsonic additions.
    #[default]
    Subsonic,
    /// Jellyfin 10.9 or newer: its own API, an access token.
    Jellyfin,
    /// Plex Media Server, signed in by a PIN on plex.tv: the server's own token.
    Plex,
}

/// A signed-in server, as kept in the keychain (secrets beside it there, never in settings, a log or `diag`).
#[derive(Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    #[serde(default)]
    pub kind: Kind,
    /// Base URL, as `normalize` left it (Plex: the connection in use, one of `connections`).
    pub address: String,
    pub user: String,
    /// Subsonic only (its token auth needs it each request). Jellyfin's is used once at sign-in, Plex's never seen.
    #[serde(default)]
    pub password: String,
    /// Jellyfin's access token, Plex's server token.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub token: String,
    /// Jellyfin's user id.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub user_id: String,
    /// Random id of this sign-in (Jellyfin's DeviceId, Plex's client identifier): never the PC's own.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub device: String,
    /// Plex's machine identifier (the key: its addresses change).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub server_id: String,
    /// The server's own name (Jellyfin, Plex), for its row.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    /// Plex: its direct addresses plex.tv gave, best first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub connections: Vec<String>,
    /// Plex: its addresses through Plex's relay, tried last. `address` is one of these or of `connections`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relays: Vec<String>,
}

impl std::fmt::Debug for Account {
    // Never the password or the token.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Account").field("kind", &self.kind).field("address", &self.address).field("user", &self.user).finish_non_exhaustive()
    }
}

impl Account {
    /// Stable short id of this server account: library ids carry it. Plex: by its machine id (its addresses change).
    pub fn key(&self) -> String {
        match self.kind {
            Kind::Plex => key(self.kind, &format!("plex:{}", self.server_id), &self.user),
            _ => key(self.kind, &self.address, &self.user),
        }
    }

    /// Plex: reached through Plex's relay (nothing else answered).
    pub fn via_relay(&self) -> bool {
        self.relays.contains(&self.address)
    }

    /// Everything this kind needs to talk to its server (Sync Mode's accounts are checked so).
    pub fn complete(&self) -> bool {
        let short = |s: &str, max: usize| !s.is_empty() && s.len() <= max;
        short(&self.user, 200)
            && match self.kind {
                Kind::Subsonic => short(&self.password, 500),
                Kind::Jellyfin => short(&self.token, 500) && short(&self.user_id, 200) && short(&self.device, 200),
                Kind::Plex => short(&self.token, 500) && short(&self.server_id, 200) && short(&self.device, 200) && self.connections.len() + self.relays.len() <= 16 && (self.connections.contains(&self.address) || self.relays.contains(&self.address)),
            }
    }
}

pub fn key(kind: Kind, address: &str, user: &str) -> String {
    let h = Sha256::digest(format!("{kind:?}\n{}\n{user}", address.to_lowercase()).as_bytes());
    format!("s{}", h.iter().take(4).map(|b| format!("{b:02x}")).collect::<String>())
}

/// Library id of a server item.
pub fn item_id(key: &str, item: &str) -> String {
    format!("{key}:{item}")
}

/// "<key>:<item>" → (key, item).
pub fn split_item(id: &str) -> Option<(&str, &str)> {
    id.split_once(':').filter(|(k, i)| k.starts_with('s') && !i.is_empty())
}

/// Address as typed → base URL. No scheme: http for a private address (a server on the LAN), https otherwise. A pasted
/// `/rest/...` page or a query is cut off; no trailing slash. Err = not an address.
pub fn normalize(typed: &str) -> Result<String, &'static str> {
    let t = typed.trim();
    if t.is_empty() || t.len() > 300 || t.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Type your server's address, like http://192.168.1.10:4533");
    }
    let lower = t.to_ascii_lowercase();
    let with = if lower.starts_with("http://") || lower.starts_with("https://") {
        t.to_string()
    } else if t.contains("://") {
        return Err("Your server's address starts with http:// or https://");
    } else {
        let host = host_of(&format!("http://{t}")).unwrap_or_default();
        format!("{}://{t}", if private_host(&host) { "http" } else { "https" })
    };
    let cut = with.split(['?', '#']).next().unwrap_or(&with);
    let cut = match cut.to_ascii_lowercase().find("/rest") {
        Some(i) if i > 8 => &cut[..i],
        _ => cut,
    };
    let base = cut.trim_end_matches('/').to_string();
    // "http://me:secret@nas": a password in the address would be shown, kept and logged as one. The user and the
    // password have their own fields.
    let userinfo = base.split_once("://").is_some_and(|(_, rest)| rest.split('/').next().is_some_and(|a| a.contains('@')));
    if userinfo || host_of(&base).is_none_or(|h| h.is_empty()) {
        return Err("Type your server's address, like http://192.168.1.10:4533");
    }
    Ok(base)
}

/// Host of a base URL (lowercase, IPv6 without brackets).
pub fn host_of(base: &str) -> Option<String> {
    let rest = base.split_once("://")?.1;
    let authority = rest.split('/').next()?;
    let authority = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    let host = if let Some(v6) = authority.strip_prefix('[') { v6.split(']').next()? } else { authority.split(':').next()? };
    Some(host.to_ascii_lowercase())
}

/// A host on this network: private / link-local / loopback addresses (`remote::private`), Tailscale's range, plain
/// names without a dot and the LAN's own suffixes.
pub fn private_host(host: &str) -> bool {
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) if v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 64 => true,
        Ok(ip) => crate::remote::private(ip),
        Err(_) => !host.contains('.') || [".local", ".lan", ".home", ".home.arpa", ".internal", ".localdomain"].iter().any(|s| host.ends_with(s)),
    }
}

/// How the server is reached, for the Accounts row's warning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "ServerExposure")]
pub enum Exposure {
    /// https.
    Secure,
    /// Plain http on this network: allowed.
    Local,
    /// Plain http to a public address: the sign-in and the music travel unencrypted.
    Open,
}

pub fn exposure(base: &str) -> Exposure {
    if base.to_ascii_lowercase().starts_with("https://") {
        Exposure::Secure
    } else if host_of(base).is_some_and(|h| private_host(&h)) {
        Exposure::Local
    } else {
        Exposure::Open
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_as_typed_become_a_base_url() {
        assert_eq!(normalize("192.168.1.10:4533"), Ok("http://192.168.1.10:4533".into()));
        assert_eq!(normalize("nas:4533/"), Ok("http://nas:4533".into()));
        assert_eq!(normalize("music.example.com"), Ok("https://music.example.com".into()));
        assert_eq!(normalize(" https://music.example.com/navidrome/ "), Ok("https://music.example.com/navidrome".into()));
        assert_eq!(normalize("http://10.0.0.2:4533/rest/ping.view?u=me&t=x"), Ok("http://10.0.0.2:4533".into()));
        assert_eq!(normalize("HTTP://[fd00::5]:4533"), Ok("HTTP://[fd00::5]:4533".into()));
        assert!(normalize("").is_err() && normalize("ftp://x").is_err() && normalize("a b").is_err() && normalize("http://").is_err());
        // No user or password inside the address (they'd show in Settings and travel in every URL).
        assert!(normalize("http://me:secret@nas:4533").is_err() && normalize("me@nas:4533").is_err());
        assert_eq!(normalize("https://music.example.com/@me"), Ok("https://music.example.com/@me".into()));
    }

    #[test]
    fn plain_http_warns_only_off_this_network() {
        assert_eq!(exposure("https://music.example.com"), Exposure::Secure);
        assert_eq!(exposure("http://192.168.1.10:4533"), Exposure::Local);
        assert_eq!(exposure("http://[fd00::5]:4533"), Exposure::Local);
        assert_eq!(exposure("http://100.101.102.103"), Exposure::Local);
        assert_eq!(exposure("http://nas.local:4533"), Exposure::Local);
        assert_eq!(exposure("http://user@nas:4533"), Exposure::Local);
        assert_eq!(exposure("http://music.example.com"), Exposure::Open);
        assert_eq!(exposure("http://8.8.8.8:4533"), Exposure::Open);
    }

    #[test]
    fn keys_name_one_server_account_and_ids_split_back() {
        let a = Account { kind: Kind::Subsonic, address: "http://nas:4533".into(), user: "me".into(), password: "x".into(), ..Default::default() };
        let b = Account { password: "other".into(), address: "HTTP://NAS:4533".into(), ..a.clone() };
        assert_eq!(a.key(), b.key(), "password and case don't change the key");
        assert_ne!(a.key(), Account { user: "you".into(), ..a.clone() }.key());
        assert_eq!(a.key().len(), 9);
        assert!(!format!("{a:?}").contains("\"x\""), "no password in Debug");
        let id = item_id(&a.key(), "tr-1:2");
        assert_eq!(split_item(&id), Some((a.key().as_str(), "tr-1:2")));
        assert_eq!(split_item("nope"), None);
    }

    #[test]
    fn a_plex_key_follows_its_machine_not_its_address() {
        let at = |a: &str| (a.to_string(), vec![a.to_string()]);
        let (address, connections) = at("https://10-0-0-2.abc.plex.direct:32400");
        let a = Account { kind: Kind::Plex, address, connections, user: "me".into(), token: "tok".into(), device: "d".into(), server_id: "m1".into(), ..Default::default() };
        let (address, connections) = at("https://1-2-3-4.abc.plex.direct:32400");
        let moved = Account { address, connections, ..a.clone() };
        assert_eq!(a.key(), moved.key());
        assert_ne!(a.key(), Account { server_id: "m2".into(), ..a.clone() }.key());
        assert!(a.complete() && moved.complete());
        assert!(!Account { connections: vec![], ..a.clone() }.complete(), "its address is one of its connections");
        assert!(!format!("{a:?}").contains("tok"), "no token in Debug");
    }

    #[test]
    fn each_kind_needs_its_own_secrets() {
        let sub = Account { kind: Kind::Subsonic, address: "http://nas:4533".into(), user: "me".into(), password: "pw".into(), ..Default::default() };
        assert!(sub.complete() && !Account { password: String::new(), ..sub.clone() }.complete());
        let jf = Account { kind: Kind::Jellyfin, address: "http://nas:8096".into(), user: "me".into(), token: "t".into(), user_id: "u".into(), device: "d".into(), ..Default::default() };
        assert!(jf.complete() && !Account { token: String::new(), ..jf.clone() }.complete() && !Account { user_id: String::new(), ..jf.clone() }.complete());
        // Part 1's keychain entries read as Subsonic with a password.
        let old: Account = serde_json::from_str(r#"{"kind":"subsonic","address":"http://nas:4533","user":"me","password":"pw"}"#).unwrap();
        assert_eq!(old, sub);
        assert!(!serde_json::to_string(&sub).unwrap().contains("token"), "empty fields stay out");
    }
}
