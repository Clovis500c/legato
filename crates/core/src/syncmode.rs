//! Sync Mode: two or more PCs share one library without a server of ours. Each PC writes a snapshot of what the user
//! made (playlists, songs added, removed songs, mix preferences, listening history, Live Editor versions, settings)
//! and merges the others': per item, the newest change wins; deletions are remembered (`sync_gone`) so they spread
//! instead of coming back. Carried by a OneDrive folder (one file per PC: OneDrive never has to merge a file) or
//! straight over the local network (connectors `nearby`). Files can be sealed with a password (Argon2id key,
//! ChaCha20-Poly1305). Secrets travel only sealed; otherwise other PCs get the account list and sign in again.
//! Local files stay per PC: their songs are matched by title, artist and length on the other side.

use crate::library::{Library, now_ms};
use crate::model::{Source, Track};
use anyhow::{Context, Result, anyhow, bail, ensure};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::path::PathBuf;

pub const FORMAT: u32 = 1;
/// Settings that describe this PC, not the user: never synced.
pub const LOCAL_SETTINGS: [&str; 4] = ["zoom", "miniSpot", "miniWidth", "defaultsVersion"];
/// Library settings row holding when each interface setting last changed (unix ms).
const TIMES: &str = "sync_times";
/// Other library settings rows that travel (key → its stamp in TIMES).
const SHARED_ROWS: [&str; 1] = ["ytm_accounts"];
/// Unpacked snapshot limit: a hostile file can't fill memory.
const MAX_SNAPSHOT: u64 = 64 << 20;
const MAGIC: &[u8; 6] = b"MASYNC";

/// A song as other PCs can find it: service ids (never local paths), ISRC, then title + artist + length.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackRef {
    pub title: String,
    pub artist: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isrc: Option<String>,
    #[serde(default)]
    pub ids: BTreeMap<Source, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub art: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSnap {
    /// `source:source_id` (made here: `local:custom-<random>`).
    pub key: String,
    pub name: String,
    pub custom: bool,
    #[serde(default)]
    pub newest_first: Option<bool>,
    #[serde(default)]
    pub order_manual: bool,
    /// Indexes into `Snapshot::tracks`.
    pub tracks: Vec<u32>,
    pub updated: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Gone {
    /// playlist / removed / edit / history.
    pub kind: String,
    pub key: String,
    pub at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Removed {
    pub source: Source,
    pub id: String,
    pub at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditSnap {
    pub uid: String,
    /// `t#<track index>`, `yt:<video>`, `f:<path>`; None = preset.
    pub song: Option<String>,
    pub name: String,
    pub effects: String,
    pub active: bool,
    /// Unix seconds (edits table).
    pub updated: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stamped {
    pub value: Value,
    pub at: i64,
}

/// Services connected on a PC (the list other PCs show, to sign in there too).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Accounts {
    pub spotify: bool,
    pub youtube: bool,
}

/// Sealed snapshots only (password file or network code).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Secrets {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spotify_client_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audd_token: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub format: u32,
    pub device: String,
    pub device_name: String,
    pub at: i64,
    pub tracks: Vec<TrackRef>,
    /// Songs in the library, beyond those in playlists (added by hand). Indexes.
    pub library: Vec<u32>,
    pub playlists: Vec<PlaylistSnap>,
    pub gone: Vec<Gone>,
    pub removed: Vec<Removed>,
    /// [track index, pref, at].
    pub prefs: Vec<(u32, String, i64)>,
    /// [track index, started (unix s), listened ms, completed].
    pub plays: Vec<(u32, i64, u32, bool)>,
    pub edits: Vec<EditSnap>,
    pub settings: BTreeMap<String, Stamped>,
    pub accounts: Accounts,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secrets: Option<Secrets>,
}

/// What a merge changed here.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Merged {
    pub playlists: usize,
    pub deleted: usize,
    pub songs: usize,
    pub removed: usize,
    pub plays: usize,
    pub edits: usize,
    pub settings: usize,
}

impl Merged {
    pub fn any(&self) -> bool {
        *self != Merged::default()
    }
}

/// Track rows → snapshot indexes, built as rows are met.
#[derive(Default)]
struct Refs {
    tracks: Vec<TrackRef>,
    index: HashMap<i64, u32>,
}

impl Refs {
    fn of(&mut self, lib: &Library, id: i64) -> Result<u32> {
        if let Some(i) = self.index.get(&id) {
            return Ok(*i);
        }
        let (title, artist, album, duration_ms, isrc, art) = lib.db.query_row("SELECT title, artist, album, duration_ms, isrc, art FROM tracks WHERE id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
        })?;
        let mut ids = BTreeMap::new();
        let mut stmt = lib.db.prepare_cached("SELECT source, source_id FROM track_ids WHERE track_id = ?1 AND source != 'local'")?;
        for row in stmt.query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (s, sid) = row?;
            if let Ok(s) = serde_json::from_value::<Source>(Value::String(s)) {
                ids.insert(s, sid);
            }
        }
        let i = self.tracks.len() as u32;
        self.tracks.push(TrackRef { title, artist, album, duration_ms, isrc, ids, art });
        self.index.insert(id, i);
        Ok(i)
    }
}

/// Settings values that name playlists by row id (`custom:<id>`, this PC only) ↔ by their portable key.
fn swap_playlist_keys(value: &Value, map: &HashMap<String, String>) -> Value {
    let swap = |k: &str| map.get(k).cloned().unwrap_or_else(|| k.to_string());
    match value {
        Value::Array(a) => Value::Array(a.iter().map(|v| v.as_str().map_or_else(|| v.clone(), |k| Value::String(swap(k)))).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, v)| (swap(k), v.clone())).collect()),
        v => v.clone(),
    }
}
const PLAYLIST_KEYED: [&str; 2] = ["hiddenPlaylists", "playlistCovers"];

impl Library {
    fn times(&self) -> Result<Map<String, Value>> {
        Ok(self.setting(TIMES)?.and_then(|v| v.as_object().cloned()).unwrap_or_default())
    }

    /// Interface settings saved: each top-level key that changed gets `now` (newest change wins on merge).
    pub fn save_ui_settings(&self, new: &Value, now: i64) -> Result<()> {
        let old = self.setting("ui")?.unwrap_or(Value::Null);
        let mut times = self.times()?;
        if let Some(new) = new.as_object() {
            for (k, v) in new {
                if old.get(k) != Some(v) {
                    times.insert(format!("ui.{k}"), now.into());
                }
            }
        }
        self.set_setting("ui", new)?;
        self.set_setting(TIMES, &Value::Object(times))
    }

    /// A shared library settings row saved (`ytm_accounts`): stamped like interface settings.
    pub fn save_shared_setting(&self, key: &str, value: &Value, now: i64) -> Result<()> {
        let mut times = self.times()?;
        times.insert(key.to_string(), now.into());
        self.set_setting(key, value)?;
        self.set_setting(TIMES, &Value::Object(times))
    }

    /// First PC of a sync: its settings are the reference (all stamped now). Joining PCs keep 0 and take others'.
    pub fn stamp_all_settings(&self, now: i64) -> Result<()> {
        let mut times = self.times()?;
        if let Some(ui) = self.setting("ui")?.as_ref().and_then(Value::as_object) {
            for k in ui.keys() {
                times.entry(format!("ui.{k}")).or_insert(now.into());
            }
        }
        for k in SHARED_ROWS {
            if self.setting(k)?.is_some() {
                times.entry(k.to_string()).or_insert(now.into());
            }
        }
        self.set_setting(TIMES, &Value::Object(times))
    }

    /// Settings were never stamped here (never changed since Sync Mode exists, never synced).
    pub fn settings_unstamped(&self) -> Result<bool> {
        Ok(self.times()?.is_empty())
    }

    fn playlist_keys(&self) -> Result<Vec<(i64, String)>> {
        let mut stmt = self.db.prepare("SELECT id, source || ':' || source_id FROM playlists WHERE custom = 1")?;
        Ok(stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?)
    }

    /// Everything this PC holds that other PCs should get.
    pub fn snapshot(&self, device: &str, device_name: &str, accounts: Accounts, secrets: Option<Secrets>) -> Result<Snapshot> {
        let mut refs = Refs::default();
        let mut playlists = Vec::new();
        {
            let mut stmt = self.db.prepare("SELECT id, source || ':' || source_id, name, custom, newest_first, order_manual, updated FROM playlists ORDER BY id")?;
            let rows: Vec<(i64, PlaylistSnap)> = stmt
                .query_map([], |r| Ok((r.get(0)?, PlaylistSnap { key: r.get(1)?, name: r.get(2)?, custom: r.get(3)?, newest_first: r.get(4)?, order_manual: r.get(5)?, tracks: Vec::new(), updated: r.get(6)? })))?
                .collect::<rusqlite::Result<_>>()?;
            for (id, mut p) in rows {
                let ids: Vec<i64> = self.db.prepare_cached("SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position")?.query_map([id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
                p.tracks = ids.into_iter().map(|t| refs.of(self, t)).collect::<Result<_>>()?;
                playlists.push(p);
            }
        }
        // Songs other PCs can find (a service id): local-only files stay here.
        let library: Vec<i64> = self.db.prepare("SELECT DISTINCT track_id FROM track_ids WHERE source != 'local' ORDER BY track_id")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        let library = library.into_iter().map(|t| refs.of(self, t)).collect::<Result<_>>()?;
        let gone = self.db.prepare("SELECT kind, key, at FROM sync_gone")?.query_map([], |r| Ok(Gone { kind: r.get(0)?, key: r.get(1)?, at: r.get(2)? }))?.collect::<rusqlite::Result<_>>()?;
        let removed = self
            .db
            .prepare("SELECT source, source_id, at FROM removed")?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))?
            .filter_map(Result::ok)
            .filter_map(|(s, id, at)| Some(Removed { source: serde_json::from_value(Value::String(s)).ok()?, id, at }))
            .collect();
        let prefs_rows: Vec<(i64, String, i64)> = self.db.prepare("SELECT track_id, pref, at FROM track_prefs")?.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
        let prefs = prefs_rows.into_iter().map(|(t, p, at)| Ok((refs.of(self, t)?, p, at))).collect::<Result<_>>()?;
        let play_rows: Vec<(i64, i64, u32, bool)> =
            self.db.prepare("SELECT track_id, started_at, listened_ms, completed FROM plays ORDER BY started_at")?.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<rusqlite::Result<_>>()?;
        let plays = play_rows.into_iter().map(|(t, s, l, c)| Ok((refs.of(self, t)?, s, l, c))).collect::<Result<_>>()?;
        let edit_rows: Vec<(String, Option<String>, String, String, bool, i64)> = self
            .db
            .prepare("SELECT uid, song, name, effects, active, updated FROM edits WHERE uid IS NOT NULL")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let mut edits = Vec::new();
        for (uid, song, name, effects, active, updated) in edit_rows {
            let song = match song.as_deref().and_then(|s| s.strip_prefix("t:")).map(str::parse::<i64>) {
                Some(Ok(id)) => match refs.of(self, id) {
                    Ok(i) => Some(format!("t#{i}")),
                    Err(_) => continue,
                },
                _ => song,
            };
            edits.push(EditSnap { uid, song, name, effects, active, updated });
        }
        // Settings, playlist keys made portable.
        let times = self.times()?;
        let portable: HashMap<String, String> = self.playlist_keys()?.into_iter().map(|(id, key)| (format!("custom:{id}"), key)).collect();
        let mut settings = BTreeMap::new();
        if let Some(ui) = self.setting("ui")?.as_ref().and_then(Value::as_object) {
            for (k, v) in ui.iter().filter(|(k, _)| !LOCAL_SETTINGS.contains(&k.as_str())) {
                let value = if PLAYLIST_KEYED.contains(&k.as_str()) { swap_playlist_keys(v, &portable) } else { v.clone() };
                let at = times.get(&format!("ui.{k}")).and_then(Value::as_i64).unwrap_or(0);
                settings.insert(format!("ui.{k}"), Stamped { value, at });
            }
        }
        for k in SHARED_ROWS {
            if let Some(value) = self.setting(k)? {
                settings.insert(k.to_string(), Stamped { value, at: times.get(k).and_then(Value::as_i64).unwrap_or(0) });
            }
        }
        Ok(Snapshot {
            format: FORMAT,
            device: device.into(),
            device_name: device_name.into(),
            at: now_ms(),
            tracks: refs.tracks,
            library,
            playlists,
            gone,
            removed,
            prefs,
            plays,
            edits,
            settings,
            accounts,
            secrets,
        })
    }

    fn gone_at(&self, kind: &str, key: &str) -> Result<i64> {
        Ok(self.db.query_row("SELECT at FROM sync_gone WHERE kind = ?1 AND key = ?2", params![kind, key], |r| r.get(0)).optional()?.unwrap_or(i64::MIN))
    }

    /// Takes another PC's snapshot in: newest change wins per item, deletions spread.
    pub fn merge(&self, s: &Snapshot) -> Result<Merged> {
        ensure!(s.format == FORMAT, "Sync file from a newer version of the app: update this PC");
        self.tx(|| self.merge_in(s))
    }

    fn merge_in(&self, s: &Snapshot) -> Result<Merged> {
        let mut m = Merged::default();
        let track_ref = |i: u32| s.tracks.get(i as usize).ok_or_else(|| anyhow!("Bad sync file (track {i})"));

        // 1. Deletions.
        for g in &s.gone {
            if g.at <= self.gone_at(&g.kind, &g.key)? {
                continue;
            }
            self.db.execute("INSERT OR REPLACE INTO sync_gone (kind, key, at) VALUES (?1, ?2, ?3)", params![g.kind, g.key, g.at])?;
            match g.kind.as_str() {
                "playlist" => {
                    let Some((source, source_id)) = g.key.split_once(':') else { continue };
                    m.deleted += self.db.execute("DELETE FROM playlists WHERE source = ?1 AND source_id = ?2 AND updated < ?3", params![source, source_id, g.at])?;
                }
                "removed" => {
                    let Some((source, id)) = g.key.split_once(':') else { continue };
                    self.db.execute("DELETE FROM removed WHERE source = ?1 AND source_id = ?2 AND at < ?3", params![source, id, g.at])?;
                }
                "edit" => {
                    m.edits += self.db.execute("DELETE FROM edits WHERE uid = ?1 AND updated * 1000 < ?2", params![g.key, g.at])?;
                }
                "history" => {
                    m.plays += self.db.execute("DELETE FROM plays WHERE started_at * 1000 < ?1", [g.at])?;
                    self.db.execute("DELETE FROM track_prefs WHERE at < ?1", [g.at])?;
                }
                _ => {}
            }
        }

        // 2. Songs removed from the library there.
        for r in &s.removed {
            let key = format!("{}:{}", r.source.as_str(), r.id);
            if r.at <= self.gone_at("removed", &key)? {
                continue;
            }
            let known: bool = self.db.query_row("SELECT 1 FROM removed WHERE source = ?1 AND source_id = ?2", params![r.source.as_str(), r.id], |_| Ok(true)).optional()?.is_some();
            if known {
                continue;
            }
            let track: Option<i64> = self.db.query_row("SELECT track_id FROM track_ids WHERE source = ?1 AND source_id = ?2", params![r.source.as_str(), r.id], |r| r.get(0)).optional()?;
            if let Some(t) = track {
                self.remove_track(t)?;
            }
            self.db.execute("INSERT OR REPLACE INTO removed (source, source_id, at) VALUES (?1, ?2, ?3)", params![r.source.as_str(), r.id, r.at])?;
            m.removed += 1;
        }

        // 3. Songs: found here or added (row ids of this PC). Removed ones stay out.
        let mut local: HashMap<u32, Option<i64>> = HashMap::new();
        let mut row = |i: u32, m: &mut Merged| -> Result<Option<i64>> {
            if let Some(id) = local.get(&i) {
                return Ok(*id);
            }
            let r = track_ref(i)?;
            let t = Track { title: r.title.clone(), artist: r.artist.clone(), album: r.album.clone(), duration_ms: r.duration_ms, isrc: r.isrc.clone(), ids: r.ids.clone(), art: r.art.clone(), musicness: None };
            // Known with all these ids: nothing written (a merge that changes nothing writes nothing).
            let id = if t.title.trim().is_empty() || self.is_removed(&t)? {
                None
            } else {
                match self.find(&t)? {
                    Some(id) if self.has_ids(id, &t.ids)? => Some(id),
                    had => {
                        let id = self.upsert_track(&t)?;
                        if had.is_none() {
                            m.songs += 1;
                        }
                        Some(id)
                    }
                }
            };
            local.insert(i, id);
            Ok(id)
        };
        for i in &s.library {
            row(*i, &mut m)?;
        }

        // 4. Playlists: the newer one wins whole (name, songs, order).
        for p in &s.playlists {
            let Some((source, source_id)) = p.key.split_once(':') else { continue };
            if serde_json::from_value::<Source>(Value::String(source.into())).is_err() || p.updated <= self.gone_at("playlist", &p.key)? {
                continue;
            }
            let here: Option<(i64, i64)> = self.db.query_row("SELECT id, updated FROM playlists WHERE source = ?1 AND source_id = ?2", params![source, source_id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
            if here.is_some_and(|(_, updated)| updated >= p.updated) {
                continue;
            }
            let name: String = p.name.chars().take(200).collect();
            let id = match here {
                Some((id, _)) => {
                    self.db.execute("UPDATE playlists SET name = ?2, newest_first = ?3, order_manual = ?4 WHERE id = ?1", params![id, name, p.newest_first, p.order_manual])?;
                    id
                }
                None => self.db.query_row(
                    "INSERT INTO playlists (source, source_id, name, custom, newest_first, order_manual) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id",
                    params![source, source_id, name, p.custom, p.newest_first, p.order_manual],
                    |r| r.get(0),
                )?,
            };
            let mut ids = Vec::with_capacity(p.tracks.len());
            for i in &p.tracks {
                ids.extend(row(*i, &mut m)?);
            }
            self.db.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", [id])?;
            let mut ins = self.db.prepare_cached("INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?1, ?2, ?3)")?;
            for (pos, t) in ids.iter().enumerate() {
                ins.execute(params![id, pos as i64, t])?;
            }
            self.db.execute("UPDATE playlists SET updated = ?2 WHERE id = ?1", params![id, p.updated])?;
            m.playlists += 1;
        }

        // 5. Mix preferences.
        for (i, pref, at) in &s.prefs {
            if !matches!(pref.as_str(), "less" | "never" | "normal") {
                continue;
            }
            let Some(t) = row(*i, &mut m)? else { continue };
            let here: Option<i64> = self.db.query_row("SELECT at FROM track_prefs WHERE track_id = ?1", [t], |r| r.get(0)).optional()?;
            if here.is_none_or(|h| h < *at) {
                self.db.execute("INSERT INTO track_prefs (track_id, pref, at) VALUES (?1, ?2, ?3) ON CONFLICT (track_id) DO UPDATE SET pref = excluded.pref, at = excluded.at", params![t, pref, at])?;
            }
        }

        // 6. Listening history: every listen once.
        let cleared = self.gone_at("history", "")?;
        for (i, started, listened, completed) in &s.plays {
            if started * 1000 < cleared {
                continue;
            }
            let Some(t) = row(*i, &mut m)? else { continue };
            m.plays += self.db.execute(
                "INSERT INTO plays (track_id, started_at, listened_ms, completed) SELECT ?1, ?2, ?3, ?4 WHERE NOT EXISTS (SELECT 1 FROM plays WHERE track_id = ?1 AND started_at = ?2)",
                params![t, started, listened, completed],
            )?;
        }
        self.db.execute("DELETE FROM plays WHERE id IN (SELECT id FROM plays ORDER BY started_at DESC LIMIT -1 OFFSET 50000)", [])?;

        // 7. Live Editor versions and presets.
        for e in &s.edits {
            if e.updated * 1000 <= self.gone_at("edit", &e.uid)? {
                continue;
            }
            let song = match e.song.as_deref().and_then(|s| s.strip_prefix("t#")).map(str::parse::<u32>) {
                Some(Ok(i)) => match row(i, &mut m)? {
                    Some(t) => Some(format!("t:{t}")),
                    None => continue,
                },
                Some(Err(_)) => continue,
                None => e.song.clone(),
            };
            let here: Option<(i64, i64)> = self.db.query_row("SELECT id, updated FROM edits WHERE uid = ?1", [&e.uid], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
            if here.is_some_and(|(_, u)| u >= e.updated) {
                continue;
            }
            if e.active
                && let Some(song) = &song
            {
                self.db.execute("UPDATE edits SET active = 0 WHERE song = ?1", [song])?;
            }
            match here {
                Some((id, _)) => self.db.execute("UPDATE edits SET song = ?2, name = ?3, effects = ?4, active = ?5, updated = ?6 WHERE id = ?1", params![id, song, e.name, e.effects, e.active, e.updated])?,
                None => self.db.execute("INSERT INTO edits (uid, song, name, effects, active, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params![e.uid, song, e.name, e.effects, e.active, e.updated])?,
            };
            m.edits += 1;
        }

        // 8. Settings, key by key.
        let mut times = self.times()?;
        let mut ui = self.setting("ui")?.and_then(|v| v.as_object().cloned()).unwrap_or_default();
        let here_keys: HashMap<String, String> = self.playlist_keys()?.into_iter().map(|(id, key)| (key, format!("custom:{id}"))).collect();
        let mut ui_changed = false;
        let stamps = times.len();
        for (k, st) in &s.settings {
            let mine = times.get(k).and_then(Value::as_i64).unwrap_or(0);
            if st.at <= mine {
                continue;
            }
            if let Some(name) = k.strip_prefix("ui.") {
                if LOCAL_SETTINGS.contains(&name) {
                    continue;
                }
                let value = if PLAYLIST_KEYED.contains(&name) { swap_playlist_keys(&st.value, &here_keys) } else { st.value.clone() };
                ui.insert(name.to_string(), value);
                ui_changed = true;
            } else if SHARED_ROWS.contains(&k.as_str()) {
                self.set_setting(k, &st.value)?;
            } else {
                continue;
            }
            times.insert(k.clone(), st.at.into());
            m.settings += 1;
        }
        if ui_changed {
            let ui = Value::Object(ui);
            ensure!(ui.to_string().len() <= 256 * 1024, "Bad sync file (settings too big)");
            self.set_setting("ui", &ui)?;
        }
        if m.settings > 0 || times.len() != stamps {
            self.set_setting(TIMES, &Value::Object(times))?;
        }
        Ok(m)
    }

    fn has_ids(&self, track: i64, ids: &BTreeMap<Source, String>) -> Result<bool> {
        let mut stmt = self.db.prepare_cached("SELECT 1 FROM track_ids WHERE track_id = ?1 AND source = ?2 AND source_id = ?3")?;
        for (s, id) in ids {
            if !stmt.exists(params![track, s.as_str(), id])? {
                return Ok(false);
            }
        }
        Ok(true)
    }
}

/// Snapshot → file bytes: gzip'd JSON, sealed when a key is given.
pub fn encode(s: &Snapshot, key: Option<&Key>) -> Result<Vec<u8>> {
    let mut gz = GzEncoder::new(Vec::new(), Compression::default());
    serde_json::to_writer(&mut gz, s)?;
    let packed = gz.finish()?;
    let mut out = MAGIC.to_vec();
    match key {
        Some(k) => {
            out.push(1);
            out.extend(seal(k, &packed)?);
        }
        None => {
            out.push(0);
            out.extend(packed);
        }
    }
    Ok(out)
}

/// File bytes → snapshot. A sealed file needs the key; a plain one is refused when a key is expected (no downgrade).
pub fn decode(bytes: &[u8], key: Option<&Key>) -> Result<Snapshot> {
    ensure!(bytes.len() > 7 && &bytes[..6] == MAGIC, "Not a Music App sync file");
    let packed = match (bytes[6], key) {
        (1, Some(k)) => open(k, &bytes[7..])?,
        (1, None) => bail!("This sync file is protected by a password"),
        (0, None) => bytes[7..].to_vec(),
        (0, Some(_)) => bail!("Unprotected sync file where protected ones are expected: ignored"),
        _ => bail!("Unknown sync file"),
    };
    let mut json = Vec::new();
    GzDecoder::new(packed.as_slice()).take(MAX_SNAPSHOT + 1).read_to_end(&mut json).context("Damaged sync file")?;
    ensure!(json.len() as u64 <= MAX_SNAPSHOT, "Sync file too big");
    serde_json::from_slice(&json).context("Damaged sync file")
}

/// Raw payload for the network exchange (already end-to-end sealed by the code): gzip'd JSON.
pub fn pack(s: &Snapshot) -> Result<Vec<u8>> {
    let mut gz = GzEncoder::new(Vec::new(), Compression::default());
    serde_json::to_writer(&mut gz, s)?;
    Ok(gz.finish()?)
}

pub fn unpack(bytes: &[u8]) -> Result<Snapshot> {
    let mut json = Vec::new();
    GzDecoder::new(bytes).take(MAX_SNAPSHOT + 1).read_to_end(&mut json).context("Damaged sync data")?;
    ensure!(json.len() as u64 <= MAX_SNAPSHOT, "Sync data too big");
    Ok(serde_json::from_slice(&json)?)
}

/// 32-byte file key, derived from the user's password.
pub type Key = [u8; 32];

/// Argon2id over the password with the folder's salt: 64 MiB, 3 passes (above OWASP's 19 MiB / 2 minimum: a copied
/// OneDrive file can be attacked offline for as long as anyone likes). About 0.2 s once per unlock.
pub fn derive_key(password: &str, salt: &[u8]) -> Result<Key> {
    let mut key = [0u8; 32];
    let params = argon2::Params::new(64 * 1024, 3, 1, Some(32)).map_err(|e| anyhow!("Key derivation failed: {e}"))?;
    argon2::Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| anyhow!("Key derivation failed: {e}"))?;
    Ok(key)
}

fn seal(key: &Key, plain: &[u8]) -> Result<Vec<u8>> {
    let cipher = ChaCha20Poly1305::new_from_slice(key).map_err(|_| anyhow!("Bad key"))?;
    // Random nonce per file write: 96 bits, no realistic repeat at this rate.
    let nonce: [u8; 12] = rand::random();
    let mut out = nonce.to_vec();
    out.extend(cipher.encrypt(&Nonce::from(nonce), plain).map_err(|_| anyhow!("Encrypt failed"))?);
    Ok(out)
}

fn open(key: &Key, sealed: &[u8]) -> Result<Vec<u8>> {
    ensure!(sealed.len() > 12, "Damaged sync file");
    let cipher = ChaCha20Poly1305::new_from_slice(key).map_err(|_| anyhow!("Bad key"))?;
    let nonce: [u8; 12] = sealed[..12].try_into()?;
    cipher.decrypt(&Nonce::from(nonce), &sealed[12..]).map_err(|_| anyhow!("Wrong password, or a damaged file"))
}

/// The sync folder's description (`sync.json`): protected or not; if so, the salt and a check to verify a password.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: u32,
    pub protected: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub salt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check: Option<String>,
}

const CHECK: &[u8] = b"music-app-sync";

impl Manifest {
    pub fn plain() -> Self {
        Self { format: FORMAT, protected: false, salt: None, check: None }
    }

    /// New protected folder: fresh salt, the key, and a check sealed with it.
    pub fn protected(password: &str) -> Result<(Self, Key)> {
        use base64::Engine;
        let salt: [u8; 16] = rand::random();
        let key = derive_key(password, &salt)?;
        let b64 = base64::engine::general_purpose::STANDARD;
        Ok((Self { format: FORMAT, protected: true, salt: Some(b64.encode(salt)), check: Some(b64.encode(seal(&key, CHECK)?)) }, key))
    }

    /// The key for this folder if `password` is right.
    pub fn unlock(&self, password: &str) -> Result<Key> {
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD;
        let (Some(salt), Some(check)) = (&self.salt, &self.check) else { bail!("This sync folder has no password") };
        let key = derive_key(password, &b64.decode(salt)?)?;
        ensure!(open(&key, &b64.decode(check)?).ok().as_deref() == Some(CHECK), "Wrong password");
        Ok(key)
    }
}

/// OneDrive folders on this PC, from the variables OneDrive sets (personal and work or school), existing or not.
pub fn onedrive_folders(var: impl Fn(&str) -> Option<String>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for name in ["OneDriveConsumer", "OneDrive", "OneDriveCommercial"] {
        if let Some(p) = var(name).map(|v| v.trim().to_string()).filter(|v| !v.is_empty()).map(PathBuf::from)
            && !out.contains(&p)
        {
            out.push(p);
        }
    }
    out
}

/// A PC's file in the sync folder: its id, filesystem-safe.
pub fn device_file(device: &str) -> Option<String> {
    (device.len() == 32 && device.bytes().all(|b| b.is_ascii_hexdigit())).then(|| format!("{device}.musicsync"))
}

/// New PC id (32 hex chars).
pub fn new_device_id() -> String {
    let b: [u8; 16] = rand::random();
    b.iter().map(|x| format!("{x:02x}")).collect()
}

impl std::fmt::Display for Merged {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} playlists, {} deleted, {} songs, {} removed, {} plays, {} edits, {} settings", self.playlists, self.deleted, self.songs, self.removed, self.plays, self.edits, self.settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::{Play, Pref};
    use crate::library::PlaylistEdit;

    fn song(title: &str, yt: &str) -> Track {
        Track { title: title.into(), artist: "Artist".into(), album: None, duration_ms: Some(200_000), isrc: None, ids: BTreeMap::from([(Source::Youtube, yt.into())]), art: None, musicness: None }
    }

    fn snap(lib: &Library) -> Snapshot {
        lib.snapshot(&"a".repeat(32), "PC", Accounts::default(), None).unwrap()
    }

    fn names(lib: &Library) -> Vec<String> {
        let mut v: Vec<String> = lib.playlists().unwrap().into_iter().map(|p| p.name).collect();
        v.sort();
        v
    }

    #[test]
    fn playlists_songs_and_history_travel_both_ways() -> Result<()> {
        let a = Library::in_memory()?;
        let b = Library::in_memory()?;
        let x = a.upsert_track(&song("X", "x1"))?;
        let gym = a.edit_playlist(PlaylistEdit::Create { name: "Gym".into() })?.unwrap();
        a.edit_playlist(PlaylistEdit::Add { id: gym, track_ids: vec![x] })?;
        a.record_play(&Play { track_id: x, started_at: 1_000, listened_ms: 60_000, completed: true })?;
        a.save_playlist(Source::Youtube, "PL1", "Imported", &[song("Y", "y1")])?;
        b.edit_playlist(PlaylistEdit::Create { name: "Chill".into() })?;

        let m = b.merge(&snap(&a))?;
        assert_eq!((m.playlists, m.plays), (2, 1));
        assert_eq!(names(&b), ["Chill", "Gym", "Imported"]);
        let gym_b = b.playlists()?.into_iter().find(|p| p.name == "Gym").unwrap();
        assert!(gym_b.custom);
        assert_eq!(b.playlist_tracks(gym_b.id)?[0].track.title, "X");
        a.merge(&snap(&b))?;
        assert_eq!(names(&a), ["Chill", "Gym", "Imported"]);
        // Merging again changes nothing (history counted once) and writes nothing.
        let before = (b.versions.library(), b.versions.history());
        assert!(!b.merge(&snap(&a))?.any());
        assert_eq!((b.versions.library(), b.versions.history()), before);
        assert_eq!(b.plays()?.len(), 1);
        Ok(())
    }

    #[test]
    fn newest_change_wins_and_deletions_spread() -> Result<()> {
        let a = Library::in_memory()?;
        let b = Library::in_memory()?;
        let gym = a.edit_playlist(PlaylistEdit::Create { name: "Gym".into() })?.unwrap();
        b.merge(&snap(&a))?;
        let gym_b = b.playlists()?[0].id;
        std::thread::sleep(std::time::Duration::from_millis(5));
        a.edit_playlist(PlaylistEdit::Rename { id: gym, name: "Gym (old)".into() })?;
        std::thread::sleep(std::time::Duration::from_millis(5));
        b.edit_playlist(PlaylistEdit::Rename { id: gym_b, name: "Gym 2026".into() })?;
        // Conflict: B renamed last, B's name everywhere.
        a.merge(&snap(&b))?;
        b.merge(&snap(&a))?;
        assert_eq!(names(&a), ["Gym 2026"]);
        assert_eq!(names(&b), ["Gym 2026"]);
        // Deleted on A: gone from B, and B's old copy doesn't bring it back.
        std::thread::sleep(std::time::Duration::from_millis(5));
        a.edit_playlist(PlaylistEdit::Delete { id: gym })?;
        let old_b = snap(&b);
        assert_eq!(b.merge(&snap(&a))?.deleted, 1);
        assert!(names(&b).is_empty());
        a.merge(&old_b)?;
        assert!(names(&a).is_empty());
        Ok(())
    }

    #[test]
    fn removed_songs_prefs_and_cleared_history() -> Result<()> {
        let a = Library::in_memory()?;
        let b = Library::in_memory()?;
        let x = a.upsert_track(&song("X", "x1"))?;
        let z = a.upsert_track(&song("Z", "z1"))?;
        a.set_pref(z, Some(Pref::Never))?;
        b.merge(&snap(&a))?;
        assert_eq!(b.tracks()?.len(), 2);
        assert_eq!(b.prefs()?.values().copied().collect::<Vec<_>>(), [Pref::Never]);
        // Same millisecond = no newer change: wait, like the other tests.
        std::thread::sleep(std::time::Duration::from_millis(5));
        a.remove_track(x)?;
        a.set_pref(z, None)?;
        b.merge(&snap(&a))?;
        assert_eq!(b.tracks()?.iter().map(|t| t.track.title.as_str()).collect::<Vec<_>>(), ["Z"]);
        assert!(b.prefs()?.is_empty());
        // A play on B, then history cleared on A later: gone from B too.
        let zb = b.tracks()?[0].id;
        b.record_play(&Play { track_id: zb, started_at: 2_000, listened_ms: 1, completed: false })?;
        a.clear_history()?;
        b.merge(&snap(&a))?;
        assert!(b.plays()?.is_empty());
        Ok(())
    }

    #[test]
    fn live_editor_versions_follow_their_song() -> Result<()> {
        let a = Library::in_memory()?;
        let b = Library::in_memory()?;
        // Different row ids on each PC.
        b.upsert_track(&song("Other", "o1"))?;
        let x = a.upsert_track(&song("X", "x1"))?;
        let v = a.save_edit(None, Some(&format!("t:{x}")), "Slowed", "{\"speed\":0.8}", 100)?;
        a.activate_edit(&format!("t:{x}"), Some(v))?;
        a.save_edit(None, None, "Preset", "{}", 100)?;
        b.merge(&snap(&a))?;
        let xb = b.tracks()?.into_iter().find(|t| t.track.title == "X").unwrap().id;
        let edits = b.edits(Some(&format!("t:{xb}")))?;
        assert_eq!((edits[0].name.as_str(), edits[0].active), ("Slowed", true));
        assert_eq!(b.edits(None)?.len(), 1);
        a.delete_edit(v)?;
        b.merge(&snap(&a))?;
        assert!(b.edits(Some(&format!("t:{xb}")))?.is_empty());
        Ok(())
    }

    #[test]
    fn settings_newest_key_wins_local_ones_stay() -> Result<()> {
        let a = Library::in_memory()?;
        let b = Library::in_memory()?;
        a.save_ui_settings(&serde_json::json!({ "theme": "dark", "zoom": 110, "crossfade": 4 }), 10)?;
        b.save_ui_settings(&serde_json::json!({ "theme": "light", "zoom": 100, "crossfade": 0 }), 5)?;
        b.save_ui_settings(&serde_json::json!({ "theme": "light", "zoom": 100, "crossfade": 6 }), 20)?;
        b.merge(&snap(&a))?;
        a.merge(&snap(&b))?;
        for lib in [&a, &b] {
            let ui = lib.setting("ui")?.unwrap();
            assert_eq!((ui["theme"].as_str(), ui["crossfade"].as_i64()), (Some("dark"), Some(6)));
        }
        // Zoom is this PC's own.
        assert_eq!(a.setting("ui")?.unwrap()["zoom"], 110);
        assert_eq!(b.setting("ui")?.unwrap()["zoom"], 100);
        Ok(())
    }

    #[test]
    fn hidden_playlists_keep_pointing_at_the_same_playlist() -> Result<()> {
        let a = Library::in_memory()?;
        let b = Library::in_memory()?;
        b.edit_playlist(PlaylistEdit::Create { name: "B first".into() })?;
        let gym = a.edit_playlist(PlaylistEdit::Create { name: "Gym".into() })?.unwrap();
        a.save_ui_settings(&serde_json::json!({ "hiddenPlaylists": [format!("custom:{gym}"), "youtube:PL1"] }), 10)?;
        b.merge(&snap(&a))?;
        let gym_b = b.playlists()?.into_iter().find(|p| p.name == "Gym").unwrap().id;
        assert_ne!(gym_b, gym);
        assert_eq!(b.setting("ui")?.unwrap()["hiddenPlaylists"], serde_json::json!([format!("custom:{gym_b}"), "youtube:PL1"]));
        Ok(())
    }

    #[test]
    fn files_seal_with_the_password_and_refuse_downgrades() -> Result<()> {
        let lib = Library::in_memory()?;
        lib.upsert_track(&song("X", "x1"))?;
        let s = lib.snapshot(&"a".repeat(32), "PC", Accounts { spotify: true, youtube: false }, Some(Secrets { audd_token: Some("t".into()), ..Secrets::default() }))?;
        let (manifest, key) = Manifest::protected("correct horse")?;
        let sealed = encode(&s, Some(&key))?;
        assert!(!String::from_utf8_lossy(&sealed).contains("\"t\""));
        assert_eq!(decode(&sealed, Some(&manifest.unlock("correct horse")?))?, s);
        assert!(manifest.unlock("wrong").is_err());
        assert!(decode(&sealed, None).is_err());
        assert!(decode(&sealed, Some(&[7; 32])).is_err());
        let plain = encode(&s, None)?;
        assert_eq!(decode(&plain, None)?, s);
        assert!(decode(&plain, Some(&key)).is_err());
        assert!(decode(b"MASYNC\x00garbage", None).is_err());
        assert_eq!(unpack(&pack(&s)?)?, s);
        Ok(())
    }

    #[test]
    fn onedrive_from_its_variables() {
        let env = |k: &str| match k {
            "OneDrive" | "OneDriveConsumer" => Some(r"C:\Users\me\OneDrive".to_string()),
            "OneDriveCommercial" => Some(r"C:\Users\me\OneDrive - Work".to_string()),
            _ => None,
        };
        assert_eq!(onedrive_folders(env), [PathBuf::from(r"C:\Users\me\OneDrive"), PathBuf::from(r"C:\Users\me\OneDrive - Work")]);
        assert!(onedrive_folders(|_| None).is_empty());
        assert_eq!(device_file(&"ab".repeat(16)).unwrap(), format!("{}.musicsync", "ab".repeat(16)));
        assert!(device_file("../x").is_none());
        assert_eq!(new_device_id().len(), 32);
    }
}
