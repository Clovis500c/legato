use crate::matching::{match_key, same_track};
use crate::model::{Source, Track};
use crate::musicness::Musicness;
use anyhow::Result;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

const SCHEMA: &str = "
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  duration_ms INTEGER,
  isrc TEXT UNIQUE COLLATE NOCASE,
  match_key TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tracks_match_key ON tracks(match_key);
CREATE TABLE IF NOT EXISTS track_ids (
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  PRIMARY KEY (source, source_id)
);
CREATE INDEX IF NOT EXISTS track_ids_track ON track_ids(track_id);
CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (source, source_id)
);
CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  track_id INTEGER NOT NULL REFERENCES tracks(id),
  PRIMARY KEY (playlist_id, position)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
";

/// Wall clock, unix ms (Sync Mode change times).
pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

const TRACK_COLS: &str = "t.id, t.title, t.artist, t.album, t.duration_ms, t.isrc, t.art, t.added, t.musicness";

/// Liked Music: last like on top, always.
fn liked_music(source: Source, source_id: &str) -> bool {
    source == Source::Youtube && (source_id == "LM" || source_id.starts_with("LM~"))
}

/// Order a playlist's service shows before a sync proves otherwise. 2026-10-20: the user checked their imported YouTube
/// playlists come newest first too (new songs on top), so YouTube = newest first; other services grow at the bottom.
pub fn default_newest_first(source: Source) -> bool {
    source == Source::Youtube
}

/// New songs at the top (true) or the bottom (false) of a re-synced list, compared with the last mirror. None = can't
/// tell (nothing new, everything new, or new songs on both ends).
pub fn growth_side(was_there: &[bool]) -> Option<bool> {
    let new = was_there.iter().filter(|w| !**w).count();
    if new == 0 || new == was_there.len() {
        return None;
    }
    let top = was_there[..new].iter().all(|w| !w);
    let bottom = was_there[was_there.len() - new..].iter().all(|w| !w);
    (top != bottom).then_some(top)
}

/// v4: "date added" rank. Row ids follow import order, but Liked Music came in newest first: flip its tracks
/// inside the slots they hold. New rows take max + 1.
fn migrate_v4(db: &Connection) -> Result<()> {
    let tx = db.unchecked_transaction()?;
    tx.execute_batch("ALTER TABLE tracks ADD COLUMN added INTEGER NOT NULL DEFAULT 0; UPDATE tracks SET added = id; CREATE INDEX tracks_added ON tracks(added);")?;
    let lists: Vec<(i64, String, String)> =
        tx.prepare("SELECT id, source, source_id FROM playlists ORDER BY id")?.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
    let mut seen = std::collections::HashSet::new();
    let mut liked: Vec<i64> = Vec::new();
    for (id, source, source_id) in lists {
        if source != Source::Youtube.as_str() || !liked_music(Source::Youtube, &source_id) {
            continue;
        }
        let ids: Vec<i64> = tx.prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position DESC")?.query_map([id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        liked.extend(ids.into_iter().filter(|t| seen.insert(*t)));
    }
    let mut slots = liked.clone();
    slots.sort_unstable();
    for (slot, t) in slots.iter().zip(&liked) {
        tx.execute("UPDATE tracks SET added = ?1 WHERE id = ?2", [slot, t])?;
    }
    tx.execute_batch("PRAGMA user_version = 4;")?;
    tx.commit()?;
    Ok(())
}

/// v5: "date added" order per playlist. `newest_first` NULL = the source's default, set by a sync that sees where new
/// songs land, or by hand (`order_manual`). YouTube playlists now default to newest first: their ranks are flipped.
fn migrate_v5(lib: &Library) -> Result<()> {
    let tx = lib.db.unchecked_transaction()?;
    tx.execute_batch("ALTER TABLE playlists ADD COLUMN newest_first INTEGER; ALTER TABLE playlists ADD COLUMN order_manual INTEGER NOT NULL DEFAULT 0;")?;
    let flipped: Vec<i64> = {
        let mut stmt = tx.prepare("SELECT id, source_id FROM playlists WHERE custom = 0 AND source = 'youtube'")?;
        stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .filter_map(Result::ok)
            .filter(|(_, sid)| !liked_music(Source::Youtube, sid))
            .map(|(id, _)| id)
            .collect()
    };
    lib.rerank(&flipped)?;
    tx.execute_batch("PRAGMA user_version = 5;")?;
    tx.commit()?;
    Ok(())
}

/// v6: songs removed from the library by the user. A sync or a folder rescan must not bring them back; adding one again
/// by hand (search, link) clears its mark.
const SCHEMA_V6: &str = "
BEGIN;
CREATE TABLE IF NOT EXISTS removed (
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  PRIMARY KEY (source, source_id)
);
PRAGMA user_version = 6;
COMMIT;
";

/// v3: cover art per track. Bare YouTube videos get their frame now (no network); syncs and lookups bring real covers later.
const SCHEMA_V3: &str = "
ALTER TABLE tracks ADD COLUMN art TEXT;
UPDATE tracks SET art = (SELECT 'https://i.ytimg.com/vi/' || source_id || '/hqdefault.jpg' FROM track_ids WHERE track_id = tracks.id AND source = 'youtube' LIMIT 1);
PRAGMA user_version = 3;
";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LibraryTrack {
    pub id: i64,
    /// "Date added" rank: order the app met the track (services give no dates).
    pub added: i64,
    #[serde(flatten)]
    pub track: Track,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPlaylist {
    pub id: i64,
    pub source: Source,
    pub source_id: String,
    pub name: String,
    pub track_count: i64,
    /// Made in the app (editable). Imported ones mirror their service.
    pub custom: bool,
    /// Service order = newest first (new songs on top).
    pub newest_first: bool,
    /// That order was set by hand (else learned from syncs).
    pub order_manual: bool,
}

/// Edits on custom playlists. Duplicate also works on imported ones.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PlaylistEdit {
    Create { name: String },
    Rename { id: i64, name: String },
    Delete { id: i64 },
    Add { id: i64, track_ids: Vec<i64> },
    Remove { id: i64, position: usize },
    /// Every occurrence of a song (right-click › Remove from).
    RemoveTrack { id: i64, track_id: i64 },
    Move { id: i64, from: usize, to: usize },
    Duplicate { id: i64, name: String },
    /// Imported playlist: which end new songs land on ("date added" sorts). None = automatic (detected by syncs).
    SetOrder { id: i64, newest_first: Option<bool> },
}

/// Row → track. Column 7 = ids JSON object (optional).
fn to_track(r: &Row) -> rusqlite::Result<LibraryTrack> {
    let ids: Option<String> = r.get(9).ok();
    let musicness: Option<String> = r.get(8)?;
    Ok(LibraryTrack {
        id: r.get(0)?,
        added: r.get(7)?,
        track: Track {
            title: r.get(1)?,
            artist: r.get(2)?,
            album: r.get(3)?,
            duration_ms: r.get(4)?,
            isrc: r.get(5)?,
            ids: ids.and_then(|j| serde_json::from_str::<BTreeMap<Source, String>>(&j).ok()).unwrap_or_default(),
            art: r.get(6)?,
            musicness: musicness.as_deref().and_then(Musicness::parse),
        },
    })
}

/// Local unified library. One track = one row, whatever number of sources.
pub struct Library {
    pub(crate) db: Connection,
    /// Bumped on every row written (update hook): cached answers check it.
    pub versions: std::sync::Arc<crate::cache::Versions>,
}

/// Live Editor edit: a song's (or a preset), its effects as JSON (music_dsp::Effects).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Edit {
    pub id: i64,
    pub song: Option<String>,
    pub name: String,
    pub effects: String,
    pub active: bool,
}

impl Library {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::init(Connection::open(path)?)
    }

    pub fn in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(db: Connection) -> Result<Self> {
        db.execute_batch(SCHEMA)?;
        // Migrations, keyed on user_version.
        if db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 1 {
            db.execute_batch("ALTER TABLE playlists ADD COLUMN custom INTEGER NOT NULL DEFAULT 0; PRAGMA user_version = 1;")?;
        }
        if db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 2 {
            db.execute_batch(crate::history::SCHEMA_V2)?;
        }
        if db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 3 {
            db.execute_batch(&format!("BEGIN; {SCHEMA_V3} COMMIT;"))?;
        }
        if db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 4 {
            migrate_v4(&db)?;
        }
        let lib = Self { db, versions: std::sync::Arc::new(crate::cache::Versions::default()) };
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 5 {
            migrate_v5(&lib)?;
        }
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 6 {
            lib.db.execute_batch(SCHEMA_V6)?;
        }
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 7 {
            // v7: music or not, per track (YouTube imports bring talks and games along). NULL = not looked at.
            lib.db.execute_batch("BEGIN; ALTER TABLE tracks ADD COLUMN musicness TEXT; PRAGMA user_version = 7; COMMIT;")?;
        }
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 8 {
            // v8: lyrics looked up (lyrics.rs key), JSON or NULL = none found; spares the services, works offline.
            lib.db.execute_batch("BEGIN; CREATE TABLE IF NOT EXISTS lyrics (key TEXT PRIMARY KEY, body TEXT, fetched INTEGER NOT NULL); PRAGMA user_version = 8; COMMIT;")?;
        }
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 9 {
            // v9: Live Editor edits. song = 't:<track>' / 'yt:<video>' / 'f:<path>', NULL = preset for any song.
            // effects = JSON of numbers only (music_dsp::Effects), never audio.
            lib.db.execute_batch(
                "BEGIN;
                 CREATE TABLE IF NOT EXISTS edits (id INTEGER PRIMARY KEY, song TEXT, name TEXT NOT NULL, effects TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL);
                 CREATE INDEX IF NOT EXISTS edits_song ON edits (song);
                 PRAGMA user_version = 9;
                 COMMIT;",
            )?;
        }
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 10 {
            // v10: Sync Mode (syncmode.rs). When things changed (unix ms) and what was deleted, so two PCs can merge:
            // the newest change wins. Playlists made here get ids no other PC can make (were custom-<row id>).
            lib.db.execute_batch(
                "BEGIN;
                 ALTER TABLE playlists ADD COLUMN updated INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE removed ADD COLUMN at INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE track_prefs ADD COLUMN at INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE edits ADD COLUMN uid TEXT;
                 UPDATE edits SET uid = lower(hex(randomblob(8)));
                 UPDATE playlists SET source_id = 'custom-' || lower(hex(randomblob(8))) WHERE custom = 1;
                 CREATE TABLE IF NOT EXISTS sync_gone (kind TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (kind, key));
                 PRAGMA user_version = 10;
                 COMMIT;",
            )?;
        }
        let v = lib.versions.clone();
        lib.db.update_hook(Some(move |_: rusqlite::hooks::Action, _: &str, table: &str, _: i64| v.touch(table)))?;
        Ok(lib)
    }

    /// Insert or merge track (source id, then ISRC, then title+artist+duration). Return row id.
    /// Existing row for this track, without writing (search results: "already added").
    pub fn find(&self, t: &Track) -> Result<Option<i64>> {
        Ok(self.lookup(t)?.first().copied())
    }

    /// Rows matching by source id, then ISRC, then title+artist+duration.
    fn lookup(&self, t: &Track) -> Result<BTreeSet<i64>> {
        let mut found = BTreeSet::new();
        let mut by_id = self.db.prepare_cached("SELECT track_id FROM track_ids WHERE source = ?1 AND source_id = ?2")?;
        for (s, sid) in &t.ids {
            if let Some(id) = by_id.query_row(params![s.as_str(), sid], |r| r.get::<_, i64>(0)).optional()? {
                found.insert(id);
            }
        }
        if let Some(isrc) = &t.isrc {
            let id: Option<i64> = self.db.query_row("SELECT id FROM tracks WHERE isrc = ?1", [isrc], |r| r.get(0)).optional()?;
            found.extend(id);
        }
        if found.is_empty() {
            let mut stmt = self.db.prepare_cached(&format!("SELECT {TRACK_COLS} FROM tracks t WHERE match_key = ?1"))?;
            let probe = Track { ids: BTreeMap::new(), ..t.clone() };
            let hit = stmt.query_map([match_key(&t.title, &t.artist)], to_track)?.filter_map(Result::ok).find(|r| same_track(&r.track, &probe));
            found.extend(hit.map(|h| h.id));
        }
        Ok(found)
    }

    pub fn upsert_track(&self, t: &Track) -> Result<i64> {
        self.tx(|| {
            let mut found = self.lookup(t)?;
            let isrc = t.isrc.as_ref().map(|s| s.to_uppercase());
            let id = match found.pop_first() {
                None => {
                    self.db.execute(
                        "INSERT INTO tracks (title, artist, album, duration_ms, isrc, match_key, art, musicness, added)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, (SELECT coalesce(max(added), 0) + 1 FROM tracks))",
                        params![t.title, t.artist, t.album, t.duration_ms, isrc, match_key(&t.title, &t.artist), t.art, t.musicness.map(Musicness::as_str)],
                    )?;
                    self.db.last_insert_rowid()
                }
                Some(keep) => {
                    // Track may sit in several rows (seen on YouTube, then Spotify). Merge into lowest id.
                    for dupe in found {
                        let (album, dur, dupe_isrc, art, music) = self.db.query_row(
                            "SELECT album, duration_ms, isrc, art, musicness FROM tracks WHERE id = ?1",
                            [dupe],
                            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<u32>>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, Option<String>>(4)?)),
                        )?;
                        self.db.execute("UPDATE track_ids SET track_id = ?1 WHERE track_id = ?2", [keep, dupe])?;
                        self.db.execute("UPDATE playlist_tracks SET track_id = ?1 WHERE track_id = ?2", [keep, dupe])?;
                        self.db.execute("UPDATE plays SET track_id = ?1 WHERE track_id = ?2", [keep, dupe])?;
                        self.db.execute("UPDATE OR IGNORE track_prefs SET track_id = ?1 WHERE track_id = ?2", [keep, dupe])?;
                        self.db.execute("UPDATE tracks SET added = min(added, (SELECT added FROM tracks WHERE id = ?2)) WHERE id = ?1", [keep, dupe])?;
                        self.db.execute("DELETE FROM tracks WHERE id = ?1", [dupe])?;
                        self.fill(keep, album, dur, dupe_isrc, art, music.as_deref().and_then(Musicness::parse))?;
                    }
                    self.fill(keep, t.album.clone(), t.duration_ms, isrc, t.art.clone(), t.musicness)?;
                    keep
                }
            };

            let mut link = self.db.prepare_cached("INSERT OR REPLACE INTO track_ids (source, source_id, track_id) VALUES (?1, ?2, ?3)")?;
            for (s, sid) in &t.ids {
                link.execute(params![s.as_str(), sid, id])?;
            }
            Ok(id)
        })
    }

    /// Replace imported playlist content. A re-sync also learns which end new songs land on ("date added" order),
    /// unless the user set it by hand.
    pub fn save_playlist(&self, source: Source, source_id: &str, name: &str, tracks: &[Track]) -> Result<i64> {
        self.tx(|| {
            let before: Option<String> = self.db.query_row("SELECT name FROM playlists WHERE source = ?1 AND source_id = ?2", params![source.as_str(), source_id], |r| r.get(0)).optional()?;
            let id: i64 = self.db.query_row(
                "INSERT INTO playlists (source, source_id, name) VALUES (?1, ?2, ?3)
                 ON CONFLICT (source, source_id) DO UPDATE SET name = excluded.name RETURNING id",
                params![source.as_str(), source_id, name],
                |r| r.get(0),
            )?;
            let old_order = self.playlist_track_ids(id)?;
            let old: BTreeSet<i64> = old_order.iter().copied().collect();
            let mut flipped = false;
            if !old.is_empty() && !liked_music(source, source_id) {
                let was_there = tracks.iter().map(|t| Ok(self.find(t)?.is_some_and(|i| old.contains(&i)))).collect::<Result<Vec<_>>>()?;
                let (current, manual) = self.order_of(id)?;
                if let Some(seen) = growth_side(&was_there).filter(|s| !manual && *s != current) {
                    self.db.execute("UPDATE playlists SET newest_first = ?1 WHERE id = ?2", params![seen, id])?;
                    flipped = true;
                }
            }
            self.db.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", [id])?;
            // Removed from the library by the user: stays out.
            let kept: Vec<Track> = tracks.iter().filter(|t| !self.is_removed(t).unwrap_or(false)).cloned().collect();
            let tracks = kept.as_slice();
            // New rows created oldest first: "date added" holds for newest-first lists too.
            let newest = self.order_of(id)?.0;
            let oldest_first: Vec<&Track> = if newest { tracks.iter().rev().collect() } else { tracks.iter().collect() };
            let mut ids = oldest_first.into_iter().map(|t| self.upsert_track(t)).collect::<Result<Vec<_>>>()?;
            if newest {
                ids.reverse();
            }
            if before.as_deref() != Some(name) || ids != old_order || flipped {
                self.touch(id)?;
            }
            for (pos, track_id) in ids.into_iter().enumerate() {
                self.db.execute("INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?1, ?2, ?3)", params![id, pos as i64, track_id])?;
            }
            if flipped {
                self.rerank(&[id])?;
            }
            Ok(id)
        })
    }

    /// Imported playlist's "date added" order: (newest first, set by hand).
    fn order_of(&self, id: i64) -> Result<(bool, bool)> {
        let (source, set, manual): (String, Option<bool>, bool) =
            self.db.query_row("SELECT source, newest_first, order_manual FROM playlists WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        let source: Source = serde_json::from_value(source.into())?;
        Ok((set.unwrap_or_else(|| default_newest_first(source)), manual))
    }

    /// "Date added" ranks of the tracks a playlist brought in (first appearance, playlists in import order) follow its
    /// current order: the same ranks, handed out again oldest first. Call after a playlist's order changed.
    fn rerank(&self, playlists: &[i64]) -> Result<()> {
        if playlists.is_empty() {
            return Ok(());
        }
        let lists: Vec<i64> = self.db.prepare("SELECT id FROM playlists WHERE custom = 0 ORDER BY id")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        let mut seen = std::collections::HashSet::new();
        for id in lists {
            let mut mine: Vec<i64> = self.playlist_track_ids(id)?.into_iter().filter(|t| seen.insert(*t)).collect();
            if !playlists.contains(&id) {
                continue;
            }
            if self.order_of(id)?.0 {
                mine.reverse();
            }
            let mut slots = mine.iter().map(|t| self.db.query_row("SELECT added FROM tracks WHERE id = ?1", [t], |r| r.get::<_, i64>(0))).collect::<rusqlite::Result<Vec<_>>>()?;
            slots.sort_unstable();
            for (slot, t) in slots.iter().zip(&mine) {
                self.db.execute("UPDATE tracks SET added = ?1 WHERE id = ?2", [slot, t])?;
            }
        }
        Ok(())
    }

    pub fn tracks(&self) -> Result<Vec<LibraryTrack>> {
        let mut stmt = self.db.prepare_cached(&format!(
            "SELECT {TRACK_COLS}, json_group_object(i.source, i.source_id)
             FROM tracks t JOIN track_ids i ON i.track_id = t.id
             GROUP BY t.id ORDER BY t.artist COLLATE NOCASE, t.title COLLATE NOCASE"
        ))?;
        Ok(stmt.query_map([], to_track)?.collect::<rusqlite::Result<_>>()?)
    }

    pub fn playlists(&self) -> Result<Vec<LibraryPlaylist>> {
        let mut stmt = self.db.prepare_cached(
            "SELECT p.id, p.source, p.source_id, p.name, COUNT(pt.track_id), p.custom, p.newest_first, p.order_manual
             FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
             GROUP BY p.id ORDER BY p.name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |r| {
            let source: String = r.get(1)?;
            let source: Source = serde_json::from_value(source.into()).map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?;
            let source_id: String = r.get(2)?;
            Ok(LibraryPlaylist {
                id: r.get(0)?,
                source,
                newest_first: r.get::<_, Option<bool>>(6)?.unwrap_or_else(|| default_newest_first(source)),
                order_manual: r.get(7)?,
                source_id,
                name: r.get(3)?,
                track_count: r.get(4)?,
                custom: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn playlist_tracks(&self, playlist_id: i64) -> Result<Vec<LibraryTrack>> {
        let mut stmt = self.db.prepare_cached(&format!(
            "SELECT {TRACK_COLS}, (SELECT json_group_object(source, source_id) FROM track_ids WHERE track_id = t.id)
             FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
             WHERE pt.playlist_id = ?1 ORDER BY pt.position"
        ))?;
        Ok(stmt.query_map([playlist_id], to_track)?.collect::<rusqlite::Result<_>>()?)
    }

    /// Local files mirror a fresh scan: upsert all (links to known tracks), drop vanished paths and orphan rows.
    pub fn replace_local(&self, tracks: &[Track]) -> Result<usize> {
        self.tx(|| {
            let tracks: Vec<&Track> = tracks.iter().filter(|t| !self.is_removed(t).unwrap_or(false)).collect();
            let keep: BTreeSet<&str> = tracks.iter().filter_map(|t| t.ids.get(&Source::Local).map(String::as_str)).collect();
            for t in &tracks {
                self.upsert_track(t)?;
            }
            let old: Vec<String> = {
                let mut stmt = self.db.prepare("SELECT source_id FROM track_ids WHERE source = 'local'")?;
                stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?
            };
            for p in old.iter().filter(|p| !keep.contains(p.as_str())) {
                self.db.execute("DELETE FROM track_ids WHERE source = 'local' AND source_id = ?1", [p])?;
            }
            // Rows still in a playlist stay (FK), hidden from library until a source returns.
            self.db.execute("DELETE FROM tracks WHERE id NOT IN (SELECT track_id FROM track_ids) AND id NOT IN (SELECT track_id FROM playlist_tracks)", [])?;
            Ok(keep.len())
        })
    }

    /// Apply edit; returns new playlist id for Create / Duplicate.
    pub fn edit_playlist(&self, edit: PlaylistEdit) -> Result<Option<i64>> {
        self.tx(|| {
            Ok(match edit {
                PlaylistEdit::Create { name } => Some(self.new_custom(&name)?),
                PlaylistEdit::Rename { id, name } => {
                    self.ensure_custom(id)?;
                    self.db.execute("UPDATE playlists SET name = ?1 WHERE id = ?2", params![clean_name(&name)?, id])?;
                    self.touch(id)?;
                    None
                }
                PlaylistEdit::Delete { id } => {
                    self.ensure_custom(id)?;
                    let key: String = self.db.query_row("SELECT source || ':' || source_id FROM playlists WHERE id = ?1", [id], |r| r.get(0))?;
                    self.db.execute("DELETE FROM playlists WHERE id = ?1", [id])?;
                    self.gone("playlist", &key)?;
                    None
                }
                PlaylistEdit::Add { id, track_ids } => {
                    self.ensure_custom(id)?;
                    self.rewrite(id, |ids| ids.extend(track_ids))?;
                    None
                }
                PlaylistEdit::Remove { id, position } => {
                    self.ensure_custom(id)?;
                    self.rewrite(id, |ids| {
                        if position < ids.len() {
                            ids.remove(position);
                        }
                    })?;
                    None
                }
                PlaylistEdit::RemoveTrack { id, track_id } => {
                    self.ensure_custom(id)?;
                    self.rewrite(id, |ids| ids.retain(|t| *t != track_id))?;
                    None
                }
                PlaylistEdit::Move { id, from, to } => {
                    self.ensure_custom(id)?;
                    self.rewrite(id, |ids| {
                        if from < ids.len() && to < ids.len() {
                            let t = ids.remove(from);
                            ids.insert(to, t);
                        }
                    })?;
                    None
                }
                PlaylistEdit::SetOrder { id, newest_first } => {
                    let before = self.order_of(id)?.0;
                    self.db.execute("UPDATE playlists SET newest_first = ?1, order_manual = ?2 WHERE id = ?3", params![newest_first, newest_first.is_some(), id])?;
                    self.touch(id)?;
                    if self.order_of(id)?.0 != before {
                        self.rerank(&[id])?;
                    }
                    None
                }
                PlaylistEdit::Duplicate { id, name } => {
                    let ids = self.playlist_track_ids(id)?;
                    let copy = self.new_custom(&name)?;
                    self.rewrite(copy, |v| *v = ids)?;
                    Some(copy)
                }
            })
        })
    }

    /// A track's ids on one service (a song can have several uploads on YouTube).
    pub fn source_ids(&self, track_id: i64, source: Source) -> Result<Vec<String>> {
        let mut stmt = self.db.prepare_cached("SELECT source_id FROM track_ids WHERE track_id = ?1 AND source = ?2")?;
        Ok(stmt.query_map(params![track_id, source.as_str()], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?)
    }

    /// Imported playlist mirror after the service dropped a song (custom ones: `edit_playlist`).
    pub fn remove_from_imported(&self, id: i64, track_id: i64) -> Result<()> {
        self.tx(|| self.rewrite(id, |ids| ids.retain(|t| *t != track_id)))
    }

    /// Out of the library: out of every playlist here (custom ones, and imported mirrors: the services keep their own
    /// copies), history and marks gone, and remembered as removed so syncs and folder rescans leave it out.
    /// Files on disk are never touched.
    pub fn remove_track(&self, track_id: i64) -> Result<()> {
        self.tx(|| {
            self.db.execute("INSERT OR IGNORE INTO removed (source, source_id, at) SELECT source, source_id, ?2 FROM track_ids WHERE track_id = ?1", params![track_id, now_ms()])?;
            let lists: Vec<i64> = self.db.prepare("SELECT DISTINCT playlist_id FROM playlist_tracks WHERE track_id = ?1")?.query_map([track_id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
            for id in lists {
                self.rewrite(id, |ids| ids.retain(|t| *t != track_id))?;
            }
            self.db.execute("DELETE FROM tracks WHERE id = ?1", [track_id])?;
            Ok(())
        })
    }

    /// Removed by the user earlier (any of its ids).
    pub(crate) fn is_removed(&self, t: &Track) -> Result<bool> {
        let mut stmt = self.db.prepare_cached("SELECT 1 FROM removed WHERE source = ?1 AND source_id = ?2")?;
        for (s, id) in &t.ids {
            if stmt.exists(params![s.as_str(), id])? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Added again by hand (search, link): the removed mark goes.
    pub fn unremove(&self, t: &Track) -> Result<()> {
        let mut stmt = self.db.prepare_cached("DELETE FROM removed WHERE source = ?1 AND source_id = ?2")?;
        for (s, id) in &t.ids {
            if stmt.execute(params![s.as_str(), id])? > 0 {
                self.gone("removed", &format!("{}:{id}", s.as_str()))?;
            }
        }
        Ok(())
    }

    /// Every playlist's track ids in playlist order (covers picked client-side from the library rows).
    pub fn playlist_orders(&self) -> Result<std::collections::HashMap<i64, Vec<i64>>> {
        let mut stmt = self.db.prepare_cached("SELECT playlist_id, track_id FROM playlist_tracks ORDER BY playlist_id, position")?;
        let mut out: std::collections::HashMap<i64, Vec<i64>> = std::collections::HashMap::new();
        for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
            let (p, t) = row?;
            out.entry(p).or_default().push(t);
        }
        Ok(out)
    }

    /// Imported playlist mirror after the service accepted new tracks (custom ones: `edit_playlist`).
    pub fn append_to_imported(&self, id: i64, track_ids: &[i64]) -> Result<()> {
        // Newest-first lists (Liked Music, most YouTube playlists): on top, like the service shows it.
        let top = self.order_of(id)?.0;
        self.tx(|| {
            self.rewrite(id, |ids| {
                if top {
                    ids.splice(0..0, track_ids.iter().rev().copied());
                } else {
                    ids.extend(track_ids)
                }
            })
        })
    }

    fn new_custom(&self, name: &str) -> Result<i64> {
        let name = clean_name(name)?;
        // Random id: another PC's playlists (Sync Mode) never collide with this one's.
        self.db.execute(
            "INSERT INTO playlists (source, source_id, name, custom, updated) VALUES ('local', 'custom-' || lower(hex(randomblob(8))), ?1, 1, ?2)",
            params![name, now_ms()],
        )?;
        Ok(self.db.last_insert_rowid())
    }

    /// Changed now (Sync Mode: the newest change of a playlist wins).
    pub(crate) fn touch(&self, playlist_id: i64) -> Result<()> {
        self.db.execute("UPDATE playlists SET updated = ?2 WHERE id = ?1", params![playlist_id, now_ms()])?;
        Ok(())
    }

    /// Deleted now: remembered so other PCs delete it too instead of bringing it back.
    pub(crate) fn gone(&self, kind: &str, key: &str) -> Result<()> {
        self.db.execute("INSERT OR REPLACE INTO sync_gone (kind, key, at) VALUES (?1, ?2, ?3)", params![kind, key, now_ms()])?;
        Ok(())
    }

    fn ensure_custom(&self, id: i64) -> Result<()> {
        let custom: Option<bool> = self.db.query_row("SELECT custom FROM playlists WHERE id = ?1", [id], |r| r.get(0)).optional()?;
        anyhow::ensure!(custom.is_some(), "Playlist not found");
        anyhow::ensure!(custom == Some(true), "Imported playlist: edit it in its service, or duplicate it");
        Ok(())
    }

    fn playlist_track_ids(&self, id: i64) -> Result<Vec<i64>> {
        let mut stmt = self.db.prepare_cached("SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position")?;
        Ok(stmt.query_map([id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?)
    }

    /// Read order, mutate, write back. Small lists: simpler than shifting positions under the PK.
    fn rewrite(&self, id: i64, f: impl FnOnce(&mut Vec<i64>)) -> Result<()> {
        let old = self.playlist_track_ids(id)?;
        let mut ids = old.clone();
        f(&mut ids);
        if ids == old {
            return Ok(());
        }
        self.touch(id)?;
        self.db.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", [id])?;
        let mut ins = self.db.prepare_cached("INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?1, ?2, ?3)")?;
        for (pos, t) in ids.iter().enumerate() {
            ins.execute(params![id, pos as i64, t])?;
        }
        Ok(())
    }

    /// Lyrics looked up before: Some((body, when)), body None = nothing found then.
    pub fn cached_lyrics(&self, key: &str) -> Result<Option<(Option<String>, i64)>> {
        Ok(self.db.query_row("SELECT body, fetched FROM lyrics WHERE key = ?1", [key], |r| Ok((r.get(0)?, r.get(1)?))).optional()?)
    }

    pub fn save_lyrics(&self, key: &str, body: Option<&str>, fetched: i64) -> Result<()> {
        self.db.execute(
            "INSERT INTO lyrics (key, body, fetched) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET body = excluded.body, fetched = excluded.fetched",
            params![key, body, fetched],
        )?;
        Ok(())
    }

    /// A song's edits (`song` key) or the presets (None), oldest first (a stable list: playing one doesn't move it).
    pub fn edits(&self, song: Option<&str>) -> Result<Vec<Edit>> {
        let mut q = self.db.prepare("SELECT id, song, name, effects, active FROM edits WHERE song IS ?1 ORDER BY id")?;
        let rows = q.query_map([song], |r| Ok(Edit { id: r.get(0)?, song: r.get(1)?, name: r.get(2)?, effects: r.get(3)?, active: r.get::<_, i64>(4)? != 0 }))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// New edit (id None) or changed one. Returns its id.
    pub fn save_edit(&self, id: Option<i64>, song: Option<&str>, name: &str, effects: &str, now: i64) -> Result<i64> {
        match id {
            Some(id) => {
                self.db.execute("UPDATE edits SET name = ?2, effects = ?3, updated = ?4 WHERE id = ?1", params![id, name, effects, now])?;
                Ok(id)
            }
            None => {
                self.db.execute("INSERT INTO edits (song, name, effects, updated, uid) VALUES (?1, ?2, ?3, ?4, lower(hex(randomblob(8))))", params![song, name, effects, now])?;
                Ok(self.db.last_insert_rowid())
            }
        }
    }

    pub fn delete_edit(&self, id: i64) -> Result<()> {
        let uid: Option<String> = self.db.query_row("SELECT uid FROM edits WHERE id = ?1", [id], |r| r.get(0)).optional()?.flatten();
        self.db.execute("DELETE FROM edits WHERE id = ?1", [id])?;
        if let Some(uid) = uid {
            self.gone("edit", &uid)?;
        }
        Ok(())
    }

    /// The edit that plays with this song (None = the song as is).
    pub fn activate_edit(&self, song: &str, id: Option<i64>) -> Result<()> {
        let tx = self.db.unchecked_transaction()?;
        let now = now_ms() / 1000;
        tx.execute("UPDATE edits SET active = 0, updated = ?2 WHERE song = ?1 AND active = 1", params![song, now])?;
        if let Some(id) = id {
            tx.execute("UPDATE edits SET active = 1, updated = ?3 WHERE id = ?1 AND song = ?2", params![id, song, now])?;
        }
        tx.commit()?;
        Ok(())
    }

    /// JSON setting blob. Front owns schema and validates on load.
    pub fn setting(&self, key: &str) -> Result<Option<serde_json::Value>> {
        let raw: Option<String> = self.db.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?;
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn set_setting(&self, key: &str, value: &serde_json::Value) -> Result<()> {
        self.db.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            params![key, value.to_string()],
        )?;
        Ok(())
    }

    fn fill(&self, id: i64, album: Option<String>, duration_ms: Option<u32>, isrc: Option<String>, art: Option<String>, music: Option<Musicness>) -> Result<()> {
        let (old, old_music): (Option<String>, Option<String>) = self.db.query_row("SELECT art, musicness FROM tracks WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let music = Musicness::merge(old_music.as_deref().and_then(Musicness::parse), music);
        self.db.execute(
            "UPDATE tracks SET album = coalesce(album, ?1), duration_ms = coalesce(duration_ms, ?2), isrc = coalesce(isrc, ?3), art = ?4, musicness = ?5 WHERE id = ?6",
            params![album, duration_ms, isrc, crate::model::pick_art(old, art), music.map(Musicness::as_str), id],
        )?;
        Ok(())
    }

    /// File path of a track's local source (cover served from its tags).
    pub fn local_path(&self, track_id: i64) -> Result<Option<String>> {
        Ok(self.db.query_row("SELECT source_id FROM track_ids WHERE source = 'local' AND track_id = ?1", [track_id], |r| r.get(0)).optional()?)
    }

    // Savepoints = nestable tx (save_playlist calls upsert_track).
    pub(crate) fn tx<T>(&self, f: impl FnOnce() -> Result<T>) -> Result<T> {
        self.db.execute_batch("SAVEPOINT tx")?;
        match f() {
            Ok(v) => {
                self.db.execute_batch("RELEASE tx")?;
                Ok(v)
            }
            Err(e) => {
                self.db.execute_batch("ROLLBACK TO tx; RELEASE tx")?;
                Err(e)
            }
        }
    }
}

/// Trust boundary: names from UI.
fn clean_name(name: &str) -> Result<String> {
    let name = name.trim();
    anyhow::ensure!(!name.is_empty() && name.chars().count() <= 100, "Playlist name: 1 to 100 characters");
    Ok(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spotify() -> Track {
        Track {
            title: "Get Lucky (feat. Pharrell Williams)".into(),
            artist: "Daft Punk, Pharrell Williams".into(),
            album: Some("Random Access Memories".into()),
            duration_ms: Some(248_000),
            isrc: Some("USQX91300108".into()),
            ids: BTreeMap::from([(Source::Spotify, "2Foc5Q5nqNiosCNqttzHof".into())]),
            art: Some("https://i.scdn.co/image/ram".into()),
            musicness: None,
        }
    }

    fn youtube() -> Track {
        Track {
            title: "Get Lucky (Official Audio)".into(),
            artist: "Daft Punk".into(),
            duration_ms: Some(250_000),
            ids: BTreeMap::from([(Source::Youtube, "5NV6Rdv1a3I".into())]),
            ..Default::default()
        }
    }

    #[test]
    fn dedupes_by_isrc_across_sources() -> Result<()> {
        let lib = Library::in_memory()?;
        let a = lib.upsert_track(&spotify())?;
        let b = lib.upsert_track(&Track { isrc: Some("usqx91300108".into()), ..youtube() })?;
        assert_eq!(a, b);
        let all = lib.tracks()?;
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].track.ids.len(), 2);
        Ok(())
    }

    #[test]
    fn dedupes_by_fuzzy_without_isrc() -> Result<()> {
        let lib = Library::in_memory()?;
        lib.upsert_track(&spotify())?;
        lib.upsert_track(&youtube())?;
        assert_eq!(lib.tracks()?.len(), 1);
        Ok(())
    }

    #[test]
    fn keeps_different_isrc_apart() -> Result<()> {
        let lib = Library::in_memory()?;
        lib.upsert_track(&spotify())?;
        lib.upsert_track(&Track {
            isrc: Some("USQX91300999".into()),
            ids: BTreeMap::from([(Source::Spotify, "other".into())]),
            ..spotify()
        })?;
        assert_eq!(lib.tracks()?.len(), 2);
        Ok(())
    }

    #[test]
    fn merges_rows_when_match_links_them() -> Result<()> {
        let lib = Library::in_memory()?;
        // Long-intro clip: duration too far for fuzzy, stays separate…
        let clip = Track { duration_ms: Some(300_000), ..youtube() };
        lib.upsert_track(&spotify())?;
        lib.upsert_track(&clip)?;
        assert_eq!(lib.tracks()?.len(), 2);
        let pid = lib.save_playlist(Source::Youtube, "PL1", "Mix", std::slice::from_ref(&clip))?;
        // …until YouTube → Spotify match links both ids.
        let mut linked = clip.clone();
        linked.isrc = spotify().isrc;
        linked.ids.extend(spotify().ids);
        lib.upsert_track(&linked)?;
        let all = lib.tracks()?;
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].track.isrc.as_deref(), Some("USQX91300108"));
        assert_eq!(all[0].track.album.as_deref(), Some("Random Access Memories"));
        assert_eq!(lib.playlist_tracks(pid)?.iter().map(|t| t.id).collect::<Vec<_>>(), vec![all[0].id]);
        Ok(())
    }

    #[test]
    fn imported_mirror_takes_tracks_custom_edit_still_refuses() -> Result<()> {
        let lib = Library::in_memory()?;
        let pid = lib.save_playlist(Source::Youtube, "PL1", "Mix", &[youtube()])?;
        let other = lib.upsert_track(&spotify())?;
        lib.append_to_imported(pid, &[other])?;
        assert_eq!(lib.playlist_tracks(pid)?.len(), 2);
        assert!(lib.edit_playlist(PlaylistEdit::Add { id: pid, track_ids: vec![other] }).is_err());
        // YouTube playlist: newest on top.
        assert_eq!(lib.playlist_orders()?[&pid][0], other);
        Ok(())
    }

    fn song(n: u32) -> Track {
        Track { title: format!("Song {n}"), artist: format!("Artist {n}"), ids: BTreeMap::from([(Source::Youtube, format!("vid{n}"))]), ..Default::default() }
    }

    #[test]
    fn liked_music_comes_newest_first_date_added_follows() -> Result<()> {
        let lib = Library::in_memory()?;
        let old = lib.upsert_track(&song(9))?;
        let pid = lib.save_playlist(Source::Youtube, "LM", "Liked Music", &[song(1), song(2), song(3)])?;
        let order: Vec<i64> = lib.playlist_tracks(pid)?.iter().map(|t| t.id).collect();
        let added = |id: i64| lib.tracks().unwrap().into_iter().find(|t| t.id == id).unwrap().added;
        // Playlist keeps service order; newest like = newest row.
        assert!(added(order[0]) > added(order[1]) && added(order[1]) > added(order[2]) && added(order[2]) > added(old));
        assert!(lib.playlists()?[0].newest_first);
        // New like goes on top, like on YouTube.
        lib.append_to_imported(pid, &[old])?;
        assert_eq!(lib.playlist_orders()?[&pid][0], old);
        Ok(())
    }

    fn added_of(lib: &Library, pid: i64) -> Vec<i64> {
        let all = lib.tracks().unwrap();
        lib.playlist_tracks(pid).unwrap().iter().map(|t| all.iter().find(|a| a.id == t.id).unwrap().added).collect()
    }

    #[test]
    fn youtube_playlists_come_newest_first() -> Result<()> {
        let lib = Library::in_memory()?;
        let pid = lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(1), song(2), song(3)])?;
        // Top song = last added (2026-10-20 report: "added newest" showed the oldest).
        assert_eq!(added_of(&lib, pid), vec![3, 2, 1]);
        assert!(lib.playlists()?[0].newest_first);
        Ok(())
    }

    #[test]
    fn a_sync_learns_which_end_new_songs_land_on() -> Result<()> {
        let lib = Library::in_memory()?;
        let pid = lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(1), song(2), song(3)])?;
        // New song at the bottom: this playlist grows at the bottom after all.
        lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(1), song(2), song(3), song(4)])?;
        assert!(!lib.playlists()?[0].newest_first);
        assert_eq!(added_of(&lib, pid), vec![1, 2, 3, 4]);
        // And back: new one on top.
        lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(5), song(1), song(2), song(3), song(4)])?;
        assert!(lib.playlists()?[0].newest_first);
        assert_eq!(added_of(&lib, pid), vec![5, 4, 3, 2, 1]);
        Ok(())
    }

    #[test]
    fn order_set_by_hand_wins_over_syncs() -> Result<()> {
        let lib = Library::in_memory()?;
        let pid = lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(1), song(2)])?;
        lib.edit_playlist(PlaylistEdit::SetOrder { id: pid, newest_first: Some(false) })?;
        assert_eq!(added_of(&lib, pid), vec![1, 2]);
        lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(3), song(1), song(2)])?;
        assert!(!lib.playlists()?[0].newest_first);
        // Automatic again: next sync decides.
        lib.edit_playlist(PlaylistEdit::SetOrder { id: pid, newest_first: None })?;
        assert!(lib.playlists()?[0].newest_first);
        Ok(())
    }

    #[test]
    fn removed_songs_stay_out_of_syncs_until_added_again() -> Result<()> {
        let lib = Library::in_memory()?;
        let pid = lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(1), song(2)])?;
        let custom = lib.edit_playlist(PlaylistEdit::Create { name: "Mine".into() })?.unwrap();
        let gone = lib.playlist_tracks(pid)?.into_iter().find(|t| t.track.title == "Song 1").unwrap().id;
        lib.edit_playlist(PlaylistEdit::Add { id: custom, track_ids: vec![gone, gone] })?;
        lib.remove_track(gone)?;
        assert!(lib.tracks()?.iter().all(|t| t.id != gone));
        assert!(lib.playlist_tracks(custom)?.is_empty());
        // Next sync: still in the service's playlist, still out of the app.
        lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(1), song(2)])?;
        assert_eq!(lib.playlist_tracks(pid)?.iter().map(|t| t.track.title.as_str()).collect::<Vec<_>>(), ["Song 2"]);
        // Added again by hand: back on the next sync.
        lib.unremove(&song(1))?;
        lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(1), song(2)])?;
        assert_eq!(lib.playlist_tracks(pid)?.len(), 2);
        Ok(())
    }

    #[test]
    fn remove_track_takes_every_occurrence() -> Result<()> {
        let lib = Library::in_memory()?;
        let a = lib.upsert_track(&song(1))?;
        let b = lib.upsert_track(&song(2))?;
        let id = lib.edit_playlist(PlaylistEdit::Create { name: "Mine".into() })?.unwrap();
        lib.edit_playlist(PlaylistEdit::Add { id, track_ids: vec![a, b, a] })?;
        lib.edit_playlist(PlaylistEdit::RemoveTrack { id, track_id: a })?;
        assert_eq!(lib.playlist_orders()?[&id], vec![b]);
        // Imported mirror: through its own call, once the service dropped it.
        let pid = lib.save_playlist(Source::Youtube, "PL1", "Mix", &[song(1), song(2), song(1)])?;
        assert!(lib.edit_playlist(PlaylistEdit::RemoveTrack { id: pid, track_id: a }).is_err());
        lib.remove_from_imported(pid, a)?;
        assert_eq!(lib.playlist_orders()?[&pid], vec![b]);
        assert_eq!(lib.source_ids(a, Source::Youtube)?, ["vid1"]);
        Ok(())
    }

    #[test]
    fn music_or_not_is_kept_and_a_music_label_wins() -> Result<()> {
        let lib = Library::in_memory()?;
        let talk = Track { musicness: Some(Musicness::NotMusic), ..song(1) };
        let id = lib.upsert_track(&talk)?;
        let get = |id| lib.tracks().unwrap().into_iter().find(|t| t.id == id).unwrap().track.musicness;
        assert_eq!(get(id), Some(Musicness::NotMusic));
        // Seen again without a word: kept. Seen as a song somewhere: music.
        lib.upsert_track(&song(1))?;
        assert_eq!(get(id), Some(Musicness::NotMusic));
        lib.upsert_track(&Track { musicness: Some(Musicness::Music), ..song(1) })?;
        assert_eq!(get(id), Some(Musicness::Music));
        lib.upsert_track(&Track { musicness: Some(Musicness::NotMusic), ..song(1) })?;
        assert_eq!(get(id), Some(Musicness::Music));
        Ok(())
    }

    #[test]
    fn growth_side_needs_new_songs_on_one_end() {
        assert_eq!(growth_side(&[false, true, true]), Some(true));
        assert_eq!(growth_side(&[true, true, false]), Some(false));
        assert_eq!(growth_side(&[false, true, false]), None);
        assert_eq!(growth_side(&[true, true]), None);
        assert_eq!(growth_side(&[false, false]), None);
        assert_eq!(growth_side(&[]), None);
    }

    #[test]
    fn v5_flips_youtube_playlists_inside_their_slots() -> Result<()> {
        let db = Connection::open_in_memory()?;
        db.execute_batch(SCHEMA)?;
        db.execute_batch("ALTER TABLE playlists ADD COLUMN custom INTEGER NOT NULL DEFAULT 0;")?;
        db.execute_batch(crate::history::SCHEMA_V2)?;
        db.execute_batch(SCHEMA_V3)?;
        db.execute_batch("ALTER TABLE tracks ADD COLUMN added INTEGER NOT NULL DEFAULT 0; PRAGMA user_version = 4;")?;
        for id in 1..=5 {
            db.execute("INSERT INTO tracks (id, title, artist, match_key, added) VALUES (?1, 't', 'a', ?1, ?1)", [id])?;
        }
        // Spotify playlist first (keeps its order), then a YouTube one imported as if it grew at the bottom.
        db.execute_batch(
            "INSERT INTO playlists (id, source, source_id, name) VALUES (1, 'spotify', 'p1', 'S'), (2, 'youtube', 'PL1', 'Mix');
             INSERT INTO playlist_tracks VALUES (1, 0, 1), (1, 1, 2), (2, 0, 3), (2, 1, 4), (2, 2, 5), (2, 3, 1);",
        )?;
        let lib = Library::init(db)?;
        let added: Vec<i64> = (1..=5).map(|id| lib.db.query_row("SELECT added FROM tracks WHERE id = ?1", [id], |r| r.get(0)).unwrap()).collect();
        // Track 1 belongs to the Spotify import (first seen there): untouched. 3, 4, 5 flipped in their slots.
        assert_eq!(added, vec![1, 2, 5, 4, 3]);
        Ok(())
    }

    #[test]
    fn v4_flips_liked_music_inside_its_slots() -> Result<()> {
        let db = Connection::open_in_memory()?;
        db.execute_batch(SCHEMA)?;
        db.execute_batch("ALTER TABLE playlists ADD COLUMN custom INTEGER NOT NULL DEFAULT 0;")?;
        db.execute_batch(crate::history::SCHEMA_V2)?;
        db.execute_batch(SCHEMA_V3)?;
        for id in 1..=4 {
            db.execute("INSERT INTO tracks (id, title, artist, match_key) VALUES (?1, 't', 'a', ?1)", [id])?;
        }
        db.execute_batch(
            "INSERT INTO playlists (id, source, source_id, name) VALUES (1, 'youtube', 'LM', 'Liked'), (2, 'youtube', 'PL1', 'Mix');
             INSERT INTO playlist_tracks VALUES (1, 0, 1), (1, 1, 2), (1, 2, 3), (2, 0, 4);",
        )?;
        let lib = Library::init(db)?;
        let added: Vec<i64> = (1..=4).map(|id| lib.db.query_row("SELECT added FROM tracks WHERE id = ?1", [id], |r| r.get(0)).unwrap()).collect();
        assert_eq!(added, vec![3, 2, 1, 4]);
        Ok(())
    }

    #[test]
    fn replaces_playlist_content() -> Result<()> {
        let lib = Library::in_memory()?;
        lib.save_playlist(Source::Spotify, "p1", "Old", &[spotify(), youtube()])?;
        let id = lib.save_playlist(Source::Spotify, "p1", "New", &[spotify()])?;
        assert_eq!(
            lib.playlists()?,
            vec![LibraryPlaylist { id, source: Source::Spotify, source_id: "p1".into(), name: "New".into(), track_count: 1, custom: false, newest_first: false, order_manual: false }]
        );
        Ok(())
    }

    #[test]
    fn local_scan_links_known_tracks_and_prunes_vanished_files() -> Result<()> {
        let lib = Library::in_memory()?;
        lib.upsert_track(&spotify())?;
        let file = |p: &str, title: &str, isrc: Option<&str>| Track {
            title: title.into(),
            artist: "Daft Punk".into(),
            duration_ms: Some(248_500),
            isrc: isrc.map(Into::into),
            ids: BTreeMap::from([(Source::Local, p.into())]),
            ..Default::default()
        };
        let lucky = file("C:/m/a.flac", "Get Lucky", Some("USQX91300108"));
        assert_eq!(lib.replace_local(&[lucky.clone(), file("C:/m/b.flac", "Contact", None)])?, 2);
        let all = lib.tracks()?;
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|t| t.track.ids.len() == 2), "file linked to Spotify track");
        lib.replace_local(std::slice::from_ref(&lucky))?;
        let all = lib.tracks()?;
        assert_eq!(all.len(), 1, "vanished file's orphan row removed");
        assert_eq!(all[0].track.ids.len(), 2);
        Ok(())
    }

    #[test]
    fn find_does_not_write() -> Result<()> {
        let lib = Library::in_memory()?;
        let id = lib.upsert_track(&spotify())?;
        assert_eq!(lib.find(&youtube())?, Some(id), "fuzzy match");
        assert_eq!(lib.find(&Track { title: "Other".into(), ..youtube() })?, None);
        assert_eq!(lib.tracks()?.len(), 1);
        Ok(())
    }

    #[test]
    fn custom_playlist_lifecycle() -> Result<()> {
        let lib = Library::in_memory()?;
        let a = lib.upsert_track(&spotify())?;
        let b = lib.upsert_track(&Track { title: "Nightcall".into(), artist: "Kavinsky".into(), ..youtube() })?;
        let id = lib.edit_playlist(PlaylistEdit::Create { name: "  Road trip ".into() })?.unwrap();
        lib.edit_playlist(PlaylistEdit::Add { id, track_ids: vec![a, b, a] })?;
        lib.edit_playlist(PlaylistEdit::Move { id, from: 2, to: 0 })?;
        lib.edit_playlist(PlaylistEdit::Remove { id, position: 1 })?;
        assert_eq!(lib.playlist_tracks(id)?.iter().map(|t| t.id).collect::<Vec<_>>(), vec![a, b]);
        lib.edit_playlist(PlaylistEdit::Rename { id, name: "Route".into() })?;
        let p = lib.playlists()?.into_iter().find(|p| p.id == id).unwrap();
        assert_eq!((p.name.as_str(), p.track_count, p.custom), ("Route", 2, true));
        lib.edit_playlist(PlaylistEdit::Delete { id })?;
        assert!(lib.playlists()?.is_empty());
        Ok(())
    }

    #[test]
    fn imported_playlists_are_read_only_but_duplicable() -> Result<()> {
        let lib = Library::in_memory()?;
        let id = lib.save_playlist(Source::Spotify, "p1", "Likes", &[spotify(), youtube()])?;
        assert!(lib.edit_playlist(PlaylistEdit::Rename { id, name: "X".into() }).is_err());
        assert!(lib.edit_playlist(PlaylistEdit::Delete { id }).is_err());
        assert!(lib.edit_playlist(PlaylistEdit::Create { name: " ".into() }).is_err());
        let copy = lib.edit_playlist(PlaylistEdit::Duplicate { id, name: "Likes perso".into() })?.unwrap();
        assert_eq!(lib.playlist_tracks(copy)?.len(), lib.playlist_tracks(id)?.len());
        // Re-sync replaces import, copy stays.
        lib.save_playlist(Source::Spotify, "p1", "Likes", &[])?;
        assert_eq!(lib.playlist_tracks(copy)?.len(), 2);
        Ok(())
    }

    #[test]
    fn settings_roundtrip_and_overwrite() -> Result<()> {
        let lib = Library::in_memory()?;
        assert_eq!(lib.setting("ui")?, None);
        lib.set_setting("ui", &serde_json::json!({ "theme": "paper" }))?;
        lib.set_setting("ui", &serde_json::json!({ "theme": "graphite" }))?;
        assert_eq!(lib.setting("ui")?, Some(serde_json::json!({ "theme": "graphite" })));
        Ok(())
    }

    #[test]
    fn edits_per_song_presets_and_one_active() -> Result<()> {
        let lib = Library::in_memory()?;
        let a = lib.save_edit(None, Some("t:1"), "Slowed", "{\"speed\":0.8}", 1)?;
        let b = lib.save_edit(None, Some("t:1"), "8D", "{}", 2)?;
        lib.save_edit(None, None, "My preset", "{}", 3)?;
        assert_eq!(lib.edits(Some("t:1"))?.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["Slowed", "8D"]);
        assert_eq!(lib.edits(None)?.len(), 1);
        lib.activate_edit("t:1", Some(a))?;
        lib.activate_edit("t:1", Some(b))?;
        let active: Vec<i64> = lib.edits(Some("t:1"))?.into_iter().filter(|e| e.active).map(|e| e.id).collect();
        assert_eq!(active, [b]);
        // Another song's id can't be made active here.
        lib.activate_edit("t:2", Some(b))?;
        assert!(lib.edits(Some("t:1"))?.iter().any(|e| e.active));
        lib.save_edit(Some(a), None, "Slowed more", "{\"speed\":0.7}", 4)?;
        assert_eq!(lib.edits(Some("t:1"))?[0].name, "Slowed more");
        lib.delete_edit(b)?;
        assert_eq!(lib.edits(Some("t:1"))?.len(), 1);
        Ok(())
    }

    #[test]
    fn lyrics_cache_keeps_finds_and_misses() -> Result<()> {
        let lib = Library::in_memory()?;
        assert_eq!(lib.cached_lyrics("a|b|200")?, None);
        lib.save_lyrics("a|b|200", None, 10)?;
        assert_eq!(lib.cached_lyrics("a|b|200")?, Some((None, 10)));
        lib.save_lyrics("a|b|200", Some("{}"), 20)?;
        assert_eq!(lib.cached_lyrics("a|b|200")?, Some((Some("{}".into()), 20)));
        Ok(())
    }

    #[test]
    fn v3_backfills_youtube_frames_then_real_covers_win() -> Result<()> {
        // v2 database: no art column yet.
        let db = Connection::open_in_memory()?;
        db.execute_batch(SCHEMA)?;
        db.execute_batch("ALTER TABLE playlists ADD COLUMN custom INTEGER NOT NULL DEFAULT 0;")?;
        db.execute_batch(crate::history::SCHEMA_V2)?;
        let yt = youtube();
        db.execute("INSERT INTO tracks (id, title, artist, duration_ms, match_key) VALUES (1, ?1, ?2, ?3, ?4)", params![yt.title, yt.artist, yt.duration_ms, match_key(&yt.title, &yt.artist)])?;
        db.execute_batch("INSERT INTO track_ids VALUES ('youtube', '5NV6Rdv1a3I', 1);")?;
        let lib = Library::init(db)?;
        let art = || -> Result<Option<String>> { Ok(lib.tracks()?[0].track.art.clone()) };
        assert_eq!(art()?, Some(crate::model::youtube_art("5NV6Rdv1a3I")));
        lib.upsert_track(&spotify())?;
        assert_eq!(art()?, spotify().art, "real cover replaces video frame");
        lib.upsert_track(&Track { art: Some(crate::model::youtube_art("other")), ..youtube() })?;
        assert_eq!(art()?, spotify().art, "frame never replaces a cover");
        Ok(())
    }

    #[test]
    fn rolls_back_on_error() -> Result<()> {
        let lib = Library::in_memory()?;
        lib.db.execute_batch("CREATE TRIGGER boom BEFORE INSERT ON tracks WHEN NEW.title = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END;")?;
        let bad = Track { title: "boom".into(), ..youtube() };
        assert!(lib.save_playlist(Source::Spotify, "p1", "X", &[spotify(), bad]).is_err());
        assert!(lib.playlists()?.is_empty());
        assert!(lib.tracks()?.is_empty());
        Ok(())
    }

    #[test]
    fn writes_bump_the_right_version() -> Result<()> {
        let lib = Library::in_memory()?;
        let (l, h) = (lib.versions.library(), lib.versions.history());
        let id = lib.edit_playlist(PlaylistEdit::Create { name: "Mine".into() })?.unwrap();
        assert!(lib.versions.library() > l);
        assert_eq!(lib.versions.history(), h);
        lib.set_setting("x", &serde_json::json!(1))?;
        let l = lib.versions.library();
        lib.edit_playlist(PlaylistEdit::Rename { id, name: "Ours".into() })?;
        assert!(lib.versions.library() > l);
        lib.clear_history()?;
        assert!(lib.versions.history() > h);
        Ok(())
    }
}
