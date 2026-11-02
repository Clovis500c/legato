//! Your devices on the same network (Sync Mode v2, `docs/sync-mode.md`): what a device is, its mDNS words, the QR link
//! a code is shown with, who starts a sync and when, the rows Settings shows. Wire and mDNS:
//! `music_connectors::devices`; shell: `src-tauri` `devices.rs`.

use crate::remote::private;
use crate::syncmode::device_file;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::{IpAddr, SocketAddrV4};

/// Longest name kept from another device.
const NAME_MAX: usize = 60;
/// Most addresses in a QR link, or kept per device.
pub const ADDRS_MAX: usize = 4;
/// Reached this recently (ms): here, whatever mDNS says.
pub const HERE_FOR: i64 = 3 * 60_000;
/// No stamp heard: an automatic sync anyway after this (ms).
pub const PULL_EVERY: i64 = 10 * 60_000;
pub const PAIR_LINK: &str = "legato://pair?";
/// mDNS words' version: another one is not ours to read.
const VERSION: &str = "2";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename = "DeviceOs")]
pub enum Os {
    Windows,
    Macos,
    Linux,
    Android,
    Ios,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename = "DeviceForm")]
pub enum Form {
    Tower,
    Laptop,
    Desktop,
    Phone,
    Tablet,
}

const OSES: [(Os, &str); 5] = [(Os::Windows, "windows"), (Os::Macos, "macos"), (Os::Linux, "linux"), (Os::Android, "android"), (Os::Ios, "ios")];
const FORMS: [(Form, &str); 5] = [(Form::Tower, "tower"), (Form::Laptop, "laptop"), (Form::Desktop, "desktop"), (Form::Phone, "phone"), (Form::Tablet, "tablet")];

impl Os {
    /// The one this build runs on.
    pub fn this() -> Os {
        if cfg!(target_os = "android") {
            Os::Android
        } else if cfg!(target_os = "ios") {
            Os::Ios
        } else if cfg!(target_os = "macos") {
            Os::Macos
        } else if cfg!(target_os = "linux") {
            Os::Linux
        } else {
            Os::Windows
        }
    }

    pub fn word(self) -> &'static str {
        OSES.iter().find(|(o, _)| *o == self).map_or("windows", |(_, w)| w)
    }

    pub fn from_word(w: &str) -> Option<Os> {
        OSES.iter().find(|(_, x)| *x == w).map(|(o, _)| *o)
    }
}

impl Form {
    /// From its system and whether it has a battery. A phone's tablet is the shell's to say.
    pub fn of(os: Os, battery: bool) -> Form {
        match os {
            Os::Android | Os::Ios => Form::Phone,
            Os::Macos if !battery => Form::Desktop,
            Os::Windows | Os::Linux if !battery => Form::Tower,
            _ => Form::Laptop,
        }
    }

    pub fn word(self) -> &'static str {
        FORMS.iter().find(|(f, _)| *f == self).map_or("laptop", |(_, w)| w)
    }

    pub fn from_word(w: &str) -> Option<Form> {
        FORMS.iter().find(|(_, x)| *x == w).map(|(f, _)| *f)
    }
}

/// What a device says about itself: in its mDNS record, and sealed in its intro.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Card {
    /// Its Sync Mode id (32 hex).
    pub id: String,
    pub name: String,
    pub os: Os,
    pub form: Form,
}

impl Card {
    /// Another device's words checked: a sync id, a name without control characters, 60 at most.
    pub fn checked(self) -> Option<Card> {
        device_file(&self.id)?;
        let name = clean_name(&self.name)?;
        Some(Card { name, ..self })
    }
}

pub fn clean_name(name: &str) -> Option<String> {
    let n: String = name.chars().filter(|c| !c.is_control()).take(NAME_MAX).collect();
    let n = n.trim();
    (!n.is_empty()).then(|| n.to_string())
}

/// A device heard over mDNS.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Heard {
    pub card: Card,
    /// Showing a code now.
    pub offering: bool,
    /// Syncs automatically.
    pub auto: bool,
    /// Its snapshot's stamp, when it says.
    pub stamp: Option<String>,
}

/// This device's mDNS TXT words.
pub fn txt(card: &Card, offering: bool, auto: bool, stamp: Option<&str>) -> Vec<(&'static str, String)> {
    let mut words = vec![("v", VERSION.to_string()), ("id", card.id.clone()), ("n", card.name.clone()), ("o", card.os.word().into()), ("f", card.form.word().into())];
    if offering {
        words.push(("c", "1".into()));
    }
    if auto {
        words.push(("a", "1".into()));
    }
    if let Some(s) = stamp {
        words.push(("s", s.to_string()));
    }
    words
}

/// Another device's TXT words (`get` reads one); None when not version 2 or not well formed.
pub fn heard(get: impl Fn(&str) -> Option<String>) -> Option<Heard> {
    if get("v")? != VERSION {
        return None;
    }
    let card = Card { id: get("id")?, name: get("n")?, os: Os::from_word(&get("o")?)?, form: Form::from_word(&get("f")?)? }.checked()?;
    let stamp = get("s").filter(|s| s.len() == 12 && s.bytes().all(|b| b.is_ascii_hexdigit()));
    Some(Heard { card, offering: get("c").as_deref() == Some("1"), auto: get("a").as_deref() == Some("1"), stamp })
}

/// A snapshot's stamp: 12 hex of SHA-256 of its bytes (its time left out by the caller).
pub fn stamp(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().take(6).map(|b| format!("{b:02x}")).collect()
}

/// What a QR code holds: the code, where the device showing it listens, its id. IPv4 private addresses only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairLink {
    pub code: String,
    pub hosts: Vec<SocketAddrV4>,
    pub id: String,
}

impl PairLink {
    pub fn text(&self) -> String {
        let hosts: Vec<String> = self.hosts.iter().map(ToString::to_string).collect();
        format!("{PAIR_LINK}c={}&h={}&i={}", self.code, hosts.join(","), self.id)
    }

    pub fn parse(text: &str) -> Option<PairLink> {
        let query = text.trim().strip_prefix(PAIR_LINK)?;
        let get = |k: &str| query.split('&').find_map(|kv| kv.strip_prefix(k)?.strip_prefix('='));
        let code = get("c").filter(|c| is_code(c))?.to_string();
        let id = get("i").filter(|i| device_file(i).is_some())?.to_string();
        let hosts: Option<Vec<SocketAddrV4>> = get("h")?.split(',').map(|h| h.parse().ok().filter(|a: &SocketAddrV4| private(IpAddr::V4(*a.ip())))).collect();
        let hosts = hosts.filter(|h| !h.is_empty() && h.len() <= ADDRS_MAX)?;
        Some(PairLink { code, hosts, id })
    }
}

pub fn is_code(code: &str) -> bool {
    code.len() == 6 && code.bytes().all(|b| b.is_ascii_digit())
}

/// Starts an automatic sync with a trusted device: only when this one syncs automatically, and when both do, the smaller
/// id (one sync, not two crossing).
pub fn starts(me: &str, auto: bool, peer: &str, peer_auto: bool) -> bool {
    auto && (!peer_auto || me < peer)
}

/// A trusted device, as kept here (the `sync` config row; its pair key is in the keychain).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    pub card: Card,
    /// Paired (unix ms).
    pub added: i64,
    /// Last good sync (unix ms).
    #[serde(default)]
    pub synced: Option<i64>,
    /// Where it was last reached ("ip:port"), newest first.
    #[serde(default)]
    pub addrs: Vec<String>,
    /// Its stamp at the last merge.
    #[serde(default)]
    pub merged: Option<String>,
    /// This device's stamp at the last send.
    #[serde(default)]
    pub sent: Option<String>,
    /// It no longer knows this device (forgot it): pair again.
    #[serde(default)]
    pub refused: bool,
}

impl Peer {
    /// An automatic sync is due: its stamp moved since the last merge, this one's since the last send, or it says no
    /// stamp and the last sync is 10 minutes old.
    pub fn due(&self, theirs: Option<&str>, mine: &str, now: i64) -> bool {
        if self.refused {
            return false;
        }
        let pull = theirs.is_none() && self.synced.is_none_or(|t| now - t >= PULL_EVERY);
        pull || theirs.is_some_and(|t| self.merged.as_deref() != Some(t)) || self.sent.as_deref() != Some(mine)
    }

    /// `addr` first, the oldest dropped past 4.
    pub fn reached_at(&mut self, addr: &str) {
        self.addrs.retain(|a| a != addr);
        self.addrs.insert(0, addr.to_string());
        self.addrs.truncate(ADDRS_MAX);
    }
}

/// One row of Settings › Sync Mode › Your devices.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "SyncDeviceRow")]
pub struct Row {
    pub id: String,
    pub name: String,
    pub os: Os,
    pub form: Form,
    /// Paired and trusted: no code.
    pub trusted: bool,
    /// On this network now.
    pub here: bool,
    /// Showing a code now.
    pub offering: bool,
    /// Last good sync (unix ms).
    pub synced: Option<i64>,
    /// It forgot this device: pair again.
    pub refused: bool,
}

/// Trusted devices first (here before away, then by name), then the others heard here (showing a code first). `reached`
/// = when one was last reached over TCP.
pub fn rows(me: &str, peers: &[Peer], heard: &[Heard], reached: impl Fn(&str) -> Option<i64>, now: i64) -> Vec<Row> {
    let near = |id: &str| heard.iter().any(|h| h.card.id == id) || reached(id).is_some_and(|t| now - t < HERE_FOR);
    let mut out: Vec<Row> = peers
        .iter()
        .map(|p| {
            let card = heard.iter().find(|h| h.card.id == p.card.id).map_or(&p.card, |h| &h.card);
            Row { id: p.card.id.clone(), name: card.name.clone(), os: card.os, form: card.form, trusted: true, here: near(&p.card.id), offering: false, synced: p.synced, refused: p.refused }
        })
        .collect();
    out.extend(heard.iter().filter(|h| h.card.id != me && !peers.iter().any(|p| p.card.id == h.card.id)).map(|h| Row {
        id: h.card.id.clone(),
        name: h.card.name.clone(),
        os: h.card.os,
        form: h.card.form,
        trusted: false,
        here: true,
        offering: h.offering,
        synced: None,
        refused: false,
    }));
    out.sort_by_key(|r| (!r.trusted, !r.here, !r.offering, r.name.to_lowercase()));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const A: &str = "0123456789abcdef0123456789abcdef";
    const B: &str = "fedcba9876543210fedcba9876543210";

    fn card(id: &str, name: &str) -> Card {
        Card { id: id.into(), name: name.into(), os: Os::Android, form: Form::Phone }
    }

    fn peer(id: &str, name: &str) -> Peer {
        Peer { card: card(id, name), added: 0, synced: None, addrs: vec![], merged: None, sent: None, refused: false }
    }

    #[test]
    fn forms_follow_the_system_and_battery() {
        assert_eq!(Form::of(Os::Windows, false), Form::Tower);
        assert_eq!(Form::of(Os::Windows, true), Form::Laptop);
        assert_eq!(Form::of(Os::Linux, false), Form::Tower);
        assert_eq!(Form::of(Os::Macos, false), Form::Desktop);
        assert_eq!(Form::of(Os::Macos, true), Form::Laptop);
        assert_eq!(Form::of(Os::Android, true), Form::Phone);
        assert_eq!(Form::of(Os::Ios, false), Form::Phone);
        for (o, w) in OSES {
            assert_eq!(Os::from_word(w), Some(o));
            assert_eq!(o.word(), w);
        }
        for (f, w) in FORMS {
            assert_eq!(Form::from_word(w), Some(f));
        }
    }

    #[test]
    fn mdns_words_read_back_and_bad_ones_are_dropped() {
        let me = Card { id: A.into(), name: "TOUR-SALON".into(), os: Os::Windows, form: Form::Tower };
        let words: HashMap<&str, String> = txt(&me, true, true, Some("0123456789ab")).into_iter().collect();
        let h = heard(|k| words.get(k).cloned()).unwrap();
        assert_eq!(h, Heard { card: me.clone(), offering: true, auto: true, stamp: Some("0123456789ab".into()) });
        let quiet: HashMap<&str, String> = txt(&me, false, false, None).into_iter().collect();
        let h = heard(|k| quiet.get(k).cloned()).unwrap();
        assert!(!h.offering && !h.auto && h.stamp.is_none());
        for (k, v) in [("v", "3"), ("id", "not-an-id"), ("o", "beos"), ("f", "watch"), ("n", "\u{7}  ")] {
            let mut bad = words.clone();
            bad.insert(k, v.into());
            assert!(heard(|k| bad.get(k).cloned()).is_none(), "{k}={v}");
        }
        let mut odd = words.clone();
        odd.insert("s", "not hex at all".into());
        assert_eq!(heard(|k| odd.get(k).cloned()).unwrap().stamp, None, "a bad stamp is no stamp");
        odd.insert("n", format!("{}\u{1b}[31m", "x".repeat(80)));
        assert_eq!(heard(|k| odd.get(k).cloned()).unwrap().card.name, "x".repeat(60), "cut, no control characters");
    }

    #[test]
    fn stamps_are_twelve_hex_of_sha256() {
        assert_eq!(stamp(b""), "e3b0c44298fc");
        assert_ne!(stamp(b"a"), stamp(b"b"));
    }

    #[test]
    fn pair_links_read_back_private_addresses_only() {
        let link = PairLink { code: "042917".into(), hosts: vec!["192.168.1.20:47822".parse().unwrap(), "10.0.0.7:47822".parse().unwrap()], id: A.into() };
        let text = link.text();
        assert_eq!(text, format!("legato://pair?c=042917&h=192.168.1.20:47822,10.0.0.7:47822&i={A}"));
        assert_eq!(PairLink::parse(&format!("  {text}\n")), Some(link));
        for bad in [
            format!("legato://pair?c=42917&h=192.168.1.20:47822&i={A}"),
            format!("legato://pair?c=042917&h=8.8.8.8:47822&i={A}"),
            format!("legato://pair?c=042917&h=&i={A}"),
            format!("legato://pair?c=042917&h=192.168.1.2:1,192.168.1.3:1,192.168.1.4:1,192.168.1.5:1,192.168.1.6:1&i={A}"),
            "legato://pair?c=042917&h=192.168.1.20:47822&i=nope".to_string(),
            format!("legato://playlist/c=042917&h=192.168.1.20:47822&i={A}"),
            format!("https://example.com/?c=042917&h=192.168.1.20:47822&i={A}"),
        ] {
            assert_eq!(PairLink::parse(&bad), None, "{bad}");
        }
    }

    #[test]
    fn one_side_starts() {
        assert!(starts(A, true, B, true) && !starts(B, true, A, true), "both automatic: the smaller id");
        assert!(starts(B, true, A, false), "only this one automatic");
        assert!(!starts(A, false, B, true) && !starts(A, false, B, false), "never when this one isn't");
    }

    #[test]
    fn a_sync_is_due_when_a_stamp_moved() {
        let mut p = peer(B, "Pixel");
        p.merged = Some("aaaaaaaaaaaa".into());
        p.sent = Some("bbbbbbbbbbbb".into());
        p.synced = Some(1_000);
        assert!(!p.due(Some("aaaaaaaaaaaa"), "bbbbbbbbbbbb", 2_000), "nothing moved");
        assert!(p.due(Some("cccccccccccc"), "bbbbbbbbbbbb", 2_000), "theirs moved");
        assert!(p.due(Some("aaaaaaaaaaaa"), "dddddddddddd", 2_000), "mine moved");
        assert!(!p.due(None, "bbbbbbbbbbbb", 1_000 + PULL_EVERY - 1), "no stamp heard, synced lately");
        assert!(p.due(None, "bbbbbbbbbbbb", 1_000 + PULL_EVERY), "no stamp heard for 10 minutes");
        p.refused = true;
        assert!(!p.due(Some("cccccccccccc"), "dddddddddddd", 2_000), "it forgot us: pair again first");
    }

    #[test]
    fn addresses_newest_first_four_kept() {
        let mut p = peer(B, "Pixel");
        for a in ["1", "2", "3", "4", "5", "3"] {
            p.reached_at(a);
        }
        assert_eq!(p.addrs, ["3", "5", "4", "2"]);
    }

    #[test]
    fn rows_put_trusted_first_then_who_is_here() {
        let peers = [peer(B, "zed phone"), peer("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Laptop"), peer("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "Away")];
        let near = |id: &str, name: &str, offering: bool| Heard { card: card(id, name), offering, auto: true, stamp: None };
        let heard = [
            near(A, "Me", false),
            near(B, "Zed Phone (renamed)", false),
            near("cccccccccccccccccccccccccccccccc", "Kitchen", false),
            near("dddddddddddddddddddddddddddddddd", "New PC", true),
        ];
        let reached = |id: &str| (id == "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").then_some(10_000 - HERE_FOR + 1);
        let r = rows(A, &peers, &heard, reached, 10_000);
        let names: Vec<(&str, bool, bool)> = r.iter().map(|r| (r.name.as_str(), r.trusted, r.here)).collect();
        assert_eq!(names, [("Laptop", true, true), ("Zed Phone (renamed)", true, true), ("Away", true, false), ("New PC", false, true), ("Kitchen", false, true)]);
        assert!(r[3].offering && !r[4].offering);
        assert!(!r.iter().any(|r| r.id == A), "never this device");
        let later = rows(A, &peers, &heard, reached, 10_000 + HERE_FOR);
        assert!(!later.iter().find(|r| r.name == "Laptop").unwrap().here, "reached 3 minutes ago, not heard: away");
    }
}
