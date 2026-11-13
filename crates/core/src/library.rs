use crate::local::LocalSong;
use crate::lyrics::{self, LyricHit, Lyrics};
use crate::matching::{match_key, same_track};
use crate::model::{Source, Track};
use crate::musicness::Musicness;
use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

// WAL + synchronous NORMAL: one disk flush per checkpoint, not per write (each play, like, edit); safe from
// corruption, a power cut may drop the last writes only. 16 MB page cache: whole-library reads stay in memory.
const SCHEMA: &str = "
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -16000;
PRAGMA temp_store = MEMORY;
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

/// Schema version this code writes (user_version after migrations).
pub const SCHEMA_VERSION: i64 = 22;

/// The library was made by a newer version of the app.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NewerLibrary(pub i64);

impl std::fmt::Display for NewerLibrary {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "This library was made by a newer version of Legato (schema {}, this one knows {SCHEMA_VERSION}). Update the app.", self.0)
    }
}

impl std::error::Error for NewerLibrary {}

/// Wall clock, unix ms (Sync Mode change times).
/// A song not found is searched again by an import after this long (ms): 30 days.
const SEARCH_AGAIN: i64 = 30 * 24 * 3_600_000;

/// Bookmarks a song keeps at most.
pub const MAX_BOOKMARKS: i64 = 50;

/// A moment inside a song to come back to, with an optional note.
#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Bookmark {
    pub id: i64,
    pub track_id: i64,
    pub ms: i64,
    pub note: String,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

const TRACK_COLS: &str = "t.id, t.title, t.artist, t.album, t.duration_ms, t.isrc, t.art, t.added, t.musicness, t.added_at, t.genre, t.year, (t.explicit = 1), t.bpm, t.key";

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

#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct LibraryTrack {
    pub id: i64,
    /// "Date added" rank: order the app met the track (services give no dates).
    pub added: i64,
    /// When this PC's library got it (unix s). None = before v11 (2026-10-23): unknown.
    #[serde(rename = "addedAt")]
    pub added_at: Option<i64>,
    /// A local file's genre and year (its tags, read at each scan). None for streamed songs: their services don't say.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub genre: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub year: Option<u32>,
    /// A local file's tempo (whole beats a minute) and key, as its tags say (v22).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub bpm: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub key: Option<String>,
    #[serde(flatten)]
    pub track: Track,
}

#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
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
#[derive(Debug, Deserialize, ts_rs::TS)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[ts(export)]
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

/// Row → track (`TRACK_COLS`, then the ids JSON object, optional).
fn to_track(r: &Row) -> rusqlite::Result<LibraryTrack> {
    let ids: Option<String> = r.get(15).ok();
    let musicness: Option<String> = r.get(8)?;
    Ok(LibraryTrack {
        id: r.get(0)?,
        added: r.get(7)?,
        added_at: r.get(9)?,
        genre: r.get(10)?,
        year: r.get(11)?,
        bpm: r.get(13)?,
        key: r.get(14)?,
        track: Track {
            title: r.get(1)?,
            artist: r.get(2)?,
            album: r.get(3)?,
            duration_ms: r.get(4)?,
            isrc: r.get(5)?,
            ids: ids.and_then(|j| serde_json::from_str::<BTreeMap<Source, String>>(&j).ok()).unwrap_or_default(),
            art: r.get(6)?,
            musicness: musicness.as_deref().map(|m| m.strip_prefix(USER).unwrap_or(m)).and_then(Musicness::parse),
            explicit: r.get(12)?,
        },
    })
}

/// Musicness text the user chose ("It's music" / "Not music"): beats any guess, kept through re-imports.
const USER: &str = "user:";

/// Rows written since the UI last read the library, whatever wrote them (`take_changes`): kind 0 = song (artist = the
/// channel it left, '' when its row still says it), 1 = playlist (its row or its songs). One line per row: bounded by
/// the library's size. Temp: this connection only, gone on close. DO NOTHING, not OR IGNORE: an outer statement's
/// conflict policy (an upsert's update aborts) overrides a trigger's OR clause, not its upsert.
const CHANGE_LOG: &str = "
CREATE TEMP TABLE IF NOT EXISTS changed (kind INTEGER NOT NULL, id INTEGER NOT NULL, artist TEXT NOT NULL, PRIMARY KEY (kind, id, artist)) WITHOUT ROWID;
CREATE TEMP TRIGGER IF NOT EXISTS song_in AFTER INSERT ON tracks BEGIN INSERT INTO changed VALUES (0, new.id, '') ON CONFLICT DO NOTHING; END;
CREATE TEMP TRIGGER IF NOT EXISTS song_set AFTER UPDATE ON tracks
  WHEN (old.title, old.artist, old.album, old.duration_ms, old.isrc, old.art, old.added, old.added_at, old.musicness, old.genre, old.year, old.explicit, old.bpm, old.key)
    IS NOT (new.title, new.artist, new.album, new.duration_ms, new.isrc, new.art, new.added, new.added_at, new.musicness, new.genre, new.year, new.explicit, new.bpm, new.key)
  BEGIN
    INSERT INTO changed VALUES (0, new.id, '') ON CONFLICT DO NOTHING;
    INSERT INTO changed SELECT 0, old.id, old.artist WHERE old.artist IS NOT new.artist ON CONFLICT DO NOTHING;
  END;
CREATE TEMP TRIGGER IF NOT EXISTS song_out AFTER DELETE ON tracks BEGIN INSERT INTO changed VALUES (0, old.id, old.artist) ON CONFLICT DO NOTHING; END;
-- Never INSERT OR REPLACE into these tables: the rows it drops fire no trigger.
CREATE TEMP TRIGGER IF NOT EXISTS id_in AFTER INSERT ON track_ids BEGIN INSERT INTO changed VALUES (0, new.track_id, '') ON CONFLICT DO NOTHING; END;
CREATE TEMP TRIGGER IF NOT EXISTS id_set AFTER UPDATE ON track_ids BEGIN INSERT INTO changed VALUES (0, old.track_id, ''), (0, new.track_id, '') ON CONFLICT DO NOTHING; END;
CREATE TEMP TRIGGER IF NOT EXISTS id_out AFTER DELETE ON track_ids BEGIN INSERT INTO changed VALUES (0, old.track_id, '') ON CONFLICT DO NOTHING; END;
CREATE TEMP TRIGGER IF NOT EXISTS list_in AFTER INSERT ON playlists BEGIN INSERT INTO changed VALUES (1, new.id, '') ON CONFLICT DO NOTHING; END;
CREATE TEMP TRIGGER IF NOT EXISTS list_set AFTER UPDATE ON playlists BEGIN INSERT INTO changed VALUES (1, old.id, ''), (1, new.id, '') ON CONFLICT DO NOTHING; END;
CREATE TEMP TRIGGER IF NOT EXISTS list_out AFTER DELETE ON playlists BEGIN INSERT INTO changed VALUES (1, old.id, '') ON CONFLICT DO NOTHING; END;
CREATE TEMP TRIGGER IF NOT EXISTS spot_in AFTER INSERT ON playlist_tracks BEGIN INSERT INTO changed VALUES (1, new.playlist_id, '') ON CONFLICT DO NOTHING; END;
CREATE TEMP TRIGGER IF NOT EXISTS spot_set AFTER UPDATE ON playlist_tracks BEGIN INSERT INTO changed VALUES (1, old.playlist_id, ''), (1, new.playlist_id, '') ON CONFLICT DO NOTHING; END;
CREATE TEMP TRIGGER IF NOT EXISTS spot_out AFTER DELETE ON playlist_tracks BEGIN INSERT INTO changed VALUES (1, old.playlist_id, '') ON CONFLICT DO NOTHING; END;
";

/// `musicness::talk_channels` key.
fn channel(artist: &str) -> String {
    artist.trim().to_lowercase()
}

fn ids_json(ids: impl IntoIterator<Item = i64>) -> String {
    serde_json::to_string(&ids.into_iter().collect::<Vec<_>>()).unwrap_or_else(|_| "[]".into())
}

/// What the UI's copy of the library lacks since its last read (`Library::take_changes`).
#[derive(Debug, Default, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "LibraryChanges")]
pub struct Changes {
    /// Whole rows: new or changed songs, and every song of their channels (musicness follows talk channels).
    pub tracks: Vec<LibraryTrack>,
    /// Out of the library list: removed, merged into another, last source gone.
    pub gone: Vec<i64>,
    pub playlists: Vec<LibraryPlaylist>,
    pub playlists_gone: Vec<i64>,
    /// Changed playlists' song ids, in order.
    pub orders: HashMap<i64, Vec<i64>>,
    /// Plays or mix preferences written since: play counts to read again.
    pub history: bool,
}

/// Local unified library. One track = one row, whatever number of sources.
pub struct Library {
    pub(crate) db: Connection,
    /// Bumped on every row written (update hook): cached answers check it.
    pub versions: std::sync::Arc<crate::cache::Versions>,
    /// History version at the last library read (`Changes::history`).
    history_read: std::sync::atomic::AtomicU64,
}

/// Live Editor edit: a song's (or a preset), its effects as JSON (music_dsp::Effects).
#[derive(Debug, Clone, PartialEq, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Edit {
    pub id: i64,
    pub song: Option<String>,
    pub name: String,
    pub effects: String,
    pub active: bool,
}

/// Whole consistent copy of an open library (`VACUUM INTO`), written aside then renamed: never a half file.
fn copy_to(db: &Connection, to: &Path) -> Result<()> {
    let part = to.with_extension("db.part");
    let _ = std::fs::remove_file(&part);
    db.execute("VACUUM INTO ?1", [part.to_string_lossy()])?;
    std::fs::rename(&part, to)?;
    Ok(())
}

/// Daily copy next to the library (`library-daily.db`), replaced when older than 20 h. Its own read connection: run it
/// off the main thread. True when a copy was made.
pub fn keep_daily_copy(path: &Path) -> Result<bool> {
    let to = path.with_file_name("library-daily.db");
    let fresh = std::fs::metadata(&to).and_then(|m| m.modified()).is_ok_and(|t| t.elapsed().is_ok_and(|age| age.as_secs() < 20 * 3600));
    if fresh || !path.exists() {
        return Ok(false);
    }
    copy_to(&Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?, &to)?;
    Ok(true)
}

/// Settings › General › Library backup: the whole library in one file (playlists, likes, history, Live Editor versions,
/// settings; sign-ins stay in the keychain). Its own read connection, like the daily copy.
pub fn back_up(path: &Path, to: &Path) -> Result<()> {
    copy_to(&Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?, to)
}

const NOT_A_BACKUP: &str = "Not a Legato library backup";

/// Silence and loudness rows kept (caches by path), and how long a SponsorBlock answer stays in its table, s.
const SILENCE_KEEP: i64 = 20_000;
const SPONSOR_KEEP_S: i64 = 30 * 86_400;
/// Tables the app fills again by itself: lyrics found, SponsorBlock's parts, local files measured (silences, loudness,
/// waveforms). Searching by a lyric line reads `lyrics`: cleared, it finds a song again once its lyrics come back.
const CACHES: [&str; 5] = ["lyrics", "sponsor", "silence", "loudness", "waveform"];

mod extras;
mod playlists;
mod tracks;

impl Library {
    /// Before migrating an existing library, keeps it as it was (`library-before-v<N>.db` next to it, the first one
    /// kept): an update with a bad migration must never cost the library (2026-10-21 incident).
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let db = Connection::open(path)?;
        let found: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        let tables: i64 = db.query_row("SELECT count(*) FROM sqlite_master WHERE type = 'table'", [], |r| r.get(0))?;
        let copy = path.with_file_name(format!("library-before-v{SCHEMA_VERSION}.db"));
        if found < SCHEMA_VERSION && tables > 0 && !copy.exists() {
            copy_to(&db, &copy)?;
        }
        Self::init(db)
    }

    /// A backup replaces this library, page by page (SQLite's backup), once it proves to be one: its tables, a schema
    /// this app knows. This one is kept beside it first (`library-before-restore.db`). Restart after: an older backup's
    /// migrations run at the next open, and nothing cached knows the new rows.
    pub fn restore(&mut self, from: &Path) -> Result<()> {
        let src = Connection::open_with_flags(from, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let tables: i64 = src.query_row("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name IN ('tracks', 'playlists', 'settings')", [], |r| r.get(0)).context(NOT_A_BACKUP)?;
        anyhow::ensure!(tables == 3, NOT_A_BACKUP);
        let found: i64 = src.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        anyhow::ensure!(found <= SCHEMA_VERSION, NewerLibrary(found));
        if let Some(path) = self.db.path().filter(|p| !p.is_empty()) {
            copy_to(&self.db, &Path::new(path).with_file_name("library-before-restore.db"))?;
        }
        rusqlite::backup::Backup::new(&src, &mut self.db)?.run_to_completion(1024, std::time::Duration::ZERO, None)?;
        Ok(())
    }

    pub fn in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(db: Connection) -> Result<Self> {
        // A library from a newer app: an older one must not write into it (it would mix two schemas). 2026-10-21:
        // the installed app and a newer dev build shared one library and damaged it.
        let found: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        anyhow::ensure!(found <= SCHEMA_VERSION, NewerLibrary(found));
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
        let mut lib = Self { db, versions: std::sync::Arc::new(crate::cache::Versions::default()), history_read: Default::default() };
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
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 11 {
            // v11: real "date added" (unix s) for songs from now on; older ones unknown (null), never guessed.
            lib.db.execute_batch("BEGIN; ALTER TABLE tracks ADD COLUMN added_at INTEGER; PRAGMA user_version = 11; COMMIT;")?;
        }
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 12 {
            // v12: measured silence at the start / end of local files, by path and modified time (not synced: a cache).
            lib.db.execute_batch("BEGIN; CREATE TABLE IF NOT EXISTS silence (path TEXT PRIMARY KEY, modified INTEGER NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER, total_ms INTEGER NOT NULL); PRAGMA user_version = 12; COMMIT;")?;
        }
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 13 {
            // v13: SponsorBlock's non-music parts per video (JSON list, the empty one too), with when it was asked (a cache, not synced).
            lib.db.execute_batch("BEGIN; CREATE TABLE IF NOT EXISTS sponsor (video TEXT PRIMARY KEY, segments TEXT NOT NULL, fetched INTEGER NOT NULL); PRAGMA user_version = 13; COMMIT;")?;
        }
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 14 {
            // v14: songs searched on YouTube, no version, with when (a cache, not synced: another PC can search for itself).
            lib.db.execute_batch("BEGIN; CREATE TABLE IF NOT EXISTS not_found (track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE, searched INTEGER NOT NULL); PRAGMA user_version = 14; COMMIT;")?;
        }
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 15 {
            // v15: loudness measured in local files (volume levelling), by path and modified time; lufs null = silent
            // throughout (a cache, not synced).
            lib.db.execute_batch("BEGIN; CREATE TABLE IF NOT EXISTS loudness (path TEXT PRIMARY KEY, modified INTEGER NOT NULL, lufs REAL, peak REAL NOT NULL); PRAGMA user_version = 15; COMMIT;")?;
        }
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 16 {
            // v16: your rating of a song, in half stars (1..=10; 0 = taken off, kept with its time for Sync Mode).
            lib.db.execute_batch("BEGIN; CREATE TABLE IF NOT EXISTS track_ratings (track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE, stars INTEGER NOT NULL, at INTEGER NOT NULL); PRAGMA user_version = 16; COMMIT;")?;
        }
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 17 {
            // v17: local files' shapes for the seek bar (`music_player::shape`), by path and modified time (a cache, not synced).
            lib.db.execute_batch("BEGIN; CREATE TABLE IF NOT EXISTS waveform (path TEXT PRIMARY KEY, modified INTEGER NOT NULL, shape BLOB NOT NULL); PRAGMA user_version = 17; COMMIT;")?;
        }
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 18 {
            // v18: bookmarks inside a song, a moment (ms) to come back to and an optional note (this PC only, not synced).
            lib.db.execute_batch("BEGIN; CREATE TABLE IF NOT EXISTS bookmarks (id INTEGER PRIMARY KEY, track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, ms INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS bookmarks_track ON bookmarks (track_id, ms); PRAGMA user_version = 18; COMMIT;")?;
        }
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 19 {
            // v19, library at scale: a song's playlist rows found without a whole scan (removed, merged, and SQLite's check
            // of each deleted song), plays read by date.
            lib.db.execute_batch("BEGIN; CREATE INDEX IF NOT EXISTS playlist_tracks_track ON playlist_tracks (track_id); CREATE INDEX IF NOT EXISTS plays_started ON plays (started_at); PRAGMA user_version = 19; COMMIT;")?;
        }
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 20 {
            // v20: local files' genre and year (their tags), filled by the next scan.
            lib.db.execute_batch("BEGIN; ALTER TABLE tracks ADD COLUMN genre TEXT; ALTER TABLE tracks ADD COLUMN year INTEGER; PRAGMA user_version = 20; COMMIT;")?;
        }
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 21 {
            // v21: a song marked explicit by a source (Settings › Hide explicit songs).
            lib.db.execute_batch("BEGIN; ALTER TABLE tracks ADD COLUMN explicit INTEGER NOT NULL DEFAULT 0; PRAGMA user_version = 21; COMMIT;")?;
        }
        if lib.db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? < 22 {
            // v22: local files' tempo and key (their tags), filled by the next scan.
            lib.db.execute_batch("BEGIN; ALTER TABLE tracks ADD COLUMN bpm INTEGER; ALTER TABLE tracks ADD COLUMN key TEXT; PRAGMA user_version = 22; COMMIT;")?;
        }
        lib.db.execute_batch(CHANGE_LOG)?;
        // Statements on logged tables compile their triggers too: kept, not rebuilt per call.
        lib.db.set_prepared_statement_cache_capacity(64);
        let v = lib.versions.clone();
        lib.db.update_hook(Some(move |_: rusqlite::hooks::Action, _: &str, table: &str, _: i64| v.touch(table)))?;
        Ok(lib)
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
        // The user's own word stays.
        let music = match old_music {
            Some(m) if m.starts_with(USER) => Some(m),
            m => Musicness::merge(m.as_deref().and_then(Musicness::parse), music).map(|m| m.as_str().to_string()),
        };
        // Nothing new (most syncs): row left unwritten.
        self.db
            .prepare_cached(
                "UPDATE tracks SET album = coalesce(album, ?1), duration_ms = coalesce(duration_ms, ?2), isrc = coalesce(isrc, ?3), art = ?4, musicness = ?5
                 WHERE id = ?6 AND (album, duration_ms, isrc, art, musicness) IS NOT (coalesce(album, ?1), coalesce(duration_ms, ?2), coalesce(isrc, ?3), ?4, ?5)",
            )?
            .execute(params![album, duration_ms, isrc, crate::model::pick_art(old, art), music, id])?;
        Ok(())
    }

    /// The user's word on a song a source marked explicit: `ok` = "not explicit" (stored as 2: a source saying explicit
    /// again doesn't undo it, `mark_explicit` only writes over 0), else back to 1. Other values untouched.
    pub fn set_explicit_ok(&self, ids: &[i64], ok: bool) -> Result<()> {
        let (from, to) = if ok { (1, 2) } else { (2, 1) };
        self.tx(|| {
            for id in ids {
                self.db.prepare_cached("UPDATE tracks SET explicit = ?1 WHERE id = ?2 AND explicit = ?3")?.execute(params![to, id, from])?;
            }
            Ok(())
        })
    }

    /// A source said explicit: it stays so (another source's silence doesn't clear it).
    fn mark_explicit(&self, id: i64) -> Result<()> {
        self.db.prepare_cached("UPDATE tracks SET explicit = 1 WHERE id = ?1 AND explicit = 0")?.execute([id])?;
        Ok(())
    }

    /// File path of a track's local source (cover served from its tags).
    pub fn local_path(&self, track_id: i64) -> Result<Option<String>> {
        Ok(self.db.query_row("SELECT source_id FROM track_ids WHERE source = 'local' AND track_id = ?1", [track_id], |r| r.get(0)).optional()?)
    }

    /// Songs a playlist still holds whose every source is gone (a local file moved or deleted): they can't play.
    pub fn sourceless(&self) -> Result<Vec<LibraryTrack>> {
        let mut stmt = self.db.prepare(&format!(
            "SELECT {TRACK_COLS}, NULL FROM tracks t
             WHERE NOT EXISTS (SELECT 1 FROM track_ids WHERE track_id = t.id) AND EXISTS (SELECT 1 FROM playlist_tracks WHERE track_id = t.id)
             ORDER BY t.artist COLLATE NOCASE, t.title COLLATE NOCASE, t.id"
        ))?;
        Ok(stmt.query_map([], to_track)?.collect::<rusqlite::Result<_>>()?)
    }

    /// Local songs: id, file, and whether a cover is stored for it.
    pub fn local_files(&self) -> Result<Vec<(i64, String, bool)>> {
        let mut stmt = self.db.prepare("SELECT i.track_id, i.source_id, t.art IS NOT NULL FROM track_ids i JOIN tracks t ON t.id = i.track_id WHERE i.source = 'local'")?;
        Ok(stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<_>>()?)
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
mod tests;
