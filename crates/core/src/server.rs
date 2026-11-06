//! Personal servers (Settings › Accounts › Your music server): the user's own music on the user's own server.
//! Subsonic-compatible now (Navidrome, Airsonic, Gonic, Ampache); Jellyfin and Plex fit the same account and ids.
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
}

/// A signed-in server, as kept in the keychain (password beside it there, never in settings, a log or `diag`).
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    #[serde(default)]
    pub kind: Kind,
    /// Base URL, as `normalize` left it.
    pub address: String,
    pub user: String,
    pub password: String,
}

impl std::fmt::Debug for Account {
    // Never the password.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Account").field("kind", &self.kind).field("address", &self.address).field("user", &self.user).finish_non_exhaustive()
    }
}

impl Account {
    /// Stable short id of this server account: library ids carry it.
    pub fn key(&self) -> String {
        key(self.kind, &self.address, &self.user)
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
        let a = Account { kind: Kind::Subsonic, address: "http://nas:4533".into(), user: "me".into(), password: "x".into() };
        let b = Account { password: "other".into(), address: "HTTP://NAS:4533".into(), ..a.clone() };
        assert_eq!(a.key(), b.key(), "password and case don't change the key");
        assert_ne!(a.key(), Account { user: "you".into(), ..a.clone() }.key());
        assert_eq!(a.key().len(), 9);
        assert!(!format!("{a:?}").contains("\"x\""), "no password in Debug");
        let id = item_id(&a.key(), "tr-1:2");
        assert_eq!(split_item(&id), Some((a.key().as_str(), "tr-1:2")));
        assert_eq!(split_item("nope"), None);
    }
}
