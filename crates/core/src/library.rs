use crate::matching::{match_key, same_track};
use crate::model::{Source, Track};
use anyhow::Result;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;
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
";

const TRACK_COLS: &str = "t.id, t.title, t.artist, t.album, t.duration_ms, t.isrc";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LibraryTrack {
    pub id: i64,
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
}

/// Row → track. Column 6 = ids JSON object (optional).
fn to_track(r: &Row) -> rusqlite::Result<LibraryTrack> {
    let ids: Option<String> = r.get(6).ok();
    Ok(LibraryTrack {
        id: r.get(0)?,
        track: Track {
            title: r.get(1)?,
            artist: r.get(2)?,
            album: r.get(3)?,
            duration_ms: r.get(4)?,
            isrc: r.get(5)?,
            ids: ids.and_then(|j| serde_json::from_str::<BTreeMap<Source, String>>(&j).ok()).unwrap_or_default(),
        },
    })
}

/// Local unified library. One track = one row, whatever number of sources.
pub struct Library {
    db: Connection,
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
        Ok(Self { db })
    }

    /// Insert or merge track (source id, then ISRC, then title+artist+duration). Return row id.
    pub fn upsert_track(&self, t: &Track) -> Result<i64> {
        self.tx(|| {
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

            let isrc = t.isrc.as_ref().map(|s| s.to_uppercase());
            let id = match found.pop_first() {
                None => {
                    self.db.execute(
                        "INSERT INTO tracks (title, artist, album, duration_ms, isrc, match_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![t.title, t.artist, t.album, t.duration_ms, isrc, match_key(&t.title, &t.artist)],
                    )?;
                    self.db.last_insert_rowid()
                }
                Some(keep) => {
                    // Track may sit in several rows (seen on YouTube, then Spotify). Merge into lowest id.
                    for dupe in found {
                        let (album, dur, dupe_isrc) = self.db.query_row(
                            "SELECT album, duration_ms, isrc FROM tracks WHERE id = ?1",
                            [dupe],
                            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<u32>>(1)?, r.get::<_, Option<String>>(2)?)),
                        )?;
                        self.db.execute("UPDATE track_ids SET track_id = ?1 WHERE track_id = ?2", [keep, dupe])?;
                        self.db.execute("UPDATE playlist_tracks SET track_id = ?1 WHERE track_id = ?2", [keep, dupe])?;
                        self.db.execute("DELETE FROM tracks WHERE id = ?1", [dupe])?;
                        self.fill(keep, album, dur, dupe_isrc)?;
                    }
                    self.fill(keep, t.album.clone(), t.duration_ms, isrc)?;
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

    /// Replace imported playlist content.
    pub fn save_playlist(&self, source: Source, source_id: &str, name: &str, tracks: &[Track]) -> Result<i64> {
        self.tx(|| {
            let id: i64 = self.db.query_row(
                "INSERT INTO playlists (source, source_id, name) VALUES (?1, ?2, ?3)
                 ON CONFLICT (source, source_id) DO UPDATE SET name = excluded.name RETURNING id",
                params![source.as_str(), source_id, name],
                |r| r.get(0),
            )?;
            self.db.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", [id])?;
            for (pos, t) in tracks.iter().enumerate() {
                let track_id = self.upsert_track(t)?;
                self.db.execute("INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?1, ?2, ?3)", params![id, pos as i64, track_id])?;
            }
            Ok(id)
        })
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
            "SELECT p.id, p.source, p.source_id, p.name, COUNT(pt.track_id)
             FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
             GROUP BY p.id ORDER BY p.name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |r| {
            let source: String = r.get(1)?;
            Ok(LibraryPlaylist {
                id: r.get(0)?,
                source: serde_json::from_value(source.into()).map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?,
                source_id: r.get(2)?,
                name: r.get(3)?,
                track_count: r.get(4)?,
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

    fn fill(&self, id: i64, album: Option<String>, duration_ms: Option<u32>, isrc: Option<String>) -> Result<()> {
        self.db.execute(
            "UPDATE tracks SET album = coalesce(album, ?1), duration_ms = coalesce(duration_ms, ?2), isrc = coalesce(isrc, ?3) WHERE id = ?4",
            params![album, duration_ms, isrc, id],
        )?;
        Ok(())
    }

    // Savepoints = nestable tx (save_playlist calls upsert_track).
    fn tx<T>(&self, f: impl FnOnce() -> Result<T>) -> Result<T> {
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
    fn replaces_playlist_content() -> Result<()> {
        let lib = Library::in_memory()?;
        lib.save_playlist(Source::Spotify, "p1", "Old", &[spotify(), youtube()])?;
        let id = lib.save_playlist(Source::Spotify, "p1", "New", &[spotify()])?;
        assert_eq!(
            lib.playlists()?,
            vec![LibraryPlaylist { id, source: Source::Spotify, source_id: "p1".into(), name: "New".into(), track_count: 1 }]
        );
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
}
