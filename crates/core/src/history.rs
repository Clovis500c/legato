//! Listening history and per-track mix preferences. Local only, feeds `mixes`.

use crate::library::Library;
use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub(crate) const SCHEMA_V2: &str = "
CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  listened_ms INTEGER NOT NULL,
  completed INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plays_track ON plays(track_id);
CREATE TABLE IF NOT EXISTS track_prefs (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  pref TEXT NOT NULL
);
PRAGMA user_version = 2;
";

/// Kept plays: oldest dropped past this (bounded table, decay makes them weightless anyway).
const MAX_PLAYS: i64 = 50_000;

/// One listen. `started_at` = unix seconds.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Play {
    pub track_id: i64,
    pub started_at: i64,
    pub listened_ms: u32,
    pub completed: bool,
}

/// User control over mixes: Less = ranked lower, Never = left out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Pref {
    Less,
    Never,
}

impl Pref {
    fn as_str(self) -> &'static str {
        match self {
            Pref::Less => "less",
            Pref::Never => "never",
        }
    }
}

impl Library {
    pub fn record_play(&self, p: &Play) -> Result<()> {
        self.db.execute("INSERT INTO plays (track_id, started_at, listened_ms, completed) VALUES (?1, ?2, ?3, ?4)", params![p.track_id, p.started_at, p.listened_ms, p.completed])?;
        self.db.execute("DELETE FROM plays WHERE id <= (SELECT max(id) FROM plays) - ?1", [MAX_PLAYS])?;
        Ok(())
    }

    /// Oldest first.
    pub fn plays(&self) -> Result<Vec<Play>> {
        let mut stmt = self.db.prepare_cached("SELECT track_id, started_at, listened_ms, completed FROM plays ORDER BY started_at, id")?;
        Ok(stmt.query_map([], |r| Ok(Play { track_id: r.get(0)?, started_at: r.get(1)?, listened_ms: r.get(2)?, completed: r.get(3)? }))?.collect::<rusqlite::Result<_>>()?)
    }

    /// Per track: listens (full ones, or 30 s heard) and the last start. For "Most played" / "Recently played" sorts.
    pub fn play_stats(&self) -> Result<HashMap<i64, (u32, i64)>> {
        let mut stmt = self.db.prepare_cached("SELECT track_id, SUM(completed OR listened_ms >= 30000), MAX(started_at) FROM plays GROUP BY track_id")?;
        Ok(stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, (r.get::<_, u32>(1)?, r.get::<_, i64>(2)?))))?.collect::<rusqlite::Result<_>>()?)
    }

    /// None clears the preference.
    pub fn set_pref(&self, track_id: i64, pref: Option<Pref>) -> Result<()> {
        // Back to normal is kept as 'normal' (with its time): Sync Mode carries it to other PCs.
        let pref = pref.map_or("normal", Pref::as_str);
        self.db.execute(
            "INSERT INTO track_prefs (track_id, pref, at) VALUES (?1, ?2, ?3) ON CONFLICT (track_id) DO UPDATE SET pref = excluded.pref, at = excluded.at",
            params![track_id, pref, crate::library::now_ms()],
        )?;
        Ok(())
    }

    pub fn prefs(&self) -> Result<HashMap<i64, Pref>> {
        let mut stmt = self.db.prepare_cached("SELECT track_id, pref FROM track_prefs")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        Ok(rows.filter_map(Result::ok).filter_map(|(id, p)| Some((id, if p == "never" { Pref::Never } else if p == "less" { Pref::Less } else { return None }))).collect())
    }

    /// Reset: plays and preferences gone, library untouched.
    pub fn clear_history(&self) -> Result<()> {
        self.db.execute_batch("DELETE FROM plays; DELETE FROM track_prefs;")?;
        self.gone("history", "")?;
        // Whole-table delete skips the update hook (SQLite's truncate optimization).
        self.versions.touch("plays");
        Ok(())
    }

    /// Track ids of each custom playlist (taste signal: you picked them).
    pub fn custom_playlists(&self) -> Result<Vec<Vec<i64>>> {
        self.playlist_lists(true)
    }

    /// Track ids of each imported playlist (YouTube Music, Spotify): your saves there, a weaker signal.
    pub fn saved_playlists(&self) -> Result<Vec<Vec<i64>>> {
        self.playlist_lists(false)
    }

    fn playlist_lists(&self, custom: bool) -> Result<Vec<Vec<i64>>> {
        let mut stmt = self.db.prepare_cached("SELECT pt.playlist_id, pt.track_id FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id WHERE p.custom = ?1 ORDER BY pt.playlist_id, pt.position")?;
        let mut out: Vec<(i64, Vec<i64>)> = Vec::new();
        for row in stmt.query_map([custom], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
            let (pid, tid) = row?;
            match out.last_mut() {
                Some((p, ids)) if *p == pid => ids.push(tid),
                _ => out.push((pid, vec![tid])),
            }
        }
        Ok(out.into_iter().map(|(_, ids)| ids).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::PlaylistEdit;
    use crate::model::{Source, Track};
    use std::collections::BTreeMap;

    fn track(lib: &Library, title: &str, source: Source, id: &str) -> i64 {
        lib.upsert_track(&Track { title: title.into(), artist: "Artist".into(), ids: BTreeMap::from([(source, id.into())]), ..Default::default() }).unwrap()
    }

    #[test]
    fn records_plays_and_prefs() -> Result<()> {
        let lib = Library::in_memory()?;
        let a = track(&lib, "A", Source::Youtube, "a");
        lib.record_play(&Play { track_id: a, started_at: 20, listened_ms: 1000, completed: false })?;
        lib.record_play(&Play { track_id: a, started_at: 10, listened_ms: 200_000, completed: true })?;
        assert_eq!(lib.plays()?.iter().map(|p| p.started_at).collect::<Vec<_>>(), [10, 20]);
        // 1 s listen doesn't count, the full one does; last start is the latest.
        assert_eq!(lib.play_stats()?[&a], (1, 20));
        lib.set_pref(a, Some(Pref::Less))?;
        lib.set_pref(a, Some(Pref::Never))?;
        assert_eq!(lib.prefs()?[&a], Pref::Never);
        lib.set_pref(a, None)?;
        assert!(lib.prefs()?.is_empty());
        assert!(lib.record_play(&Play { track_id: 999, started_at: 1, listened_ms: 1, completed: true }).is_err(), "unknown track");
        lib.clear_history()?;
        assert!(lib.plays()?.is_empty());
        Ok(())
    }

    #[test]
    fn history_follows_merged_tracks() -> Result<()> {
        let lib = Library::in_memory()?;
        let song = |isrc: Option<&str>, ids: &[(Source, &str)]| Track { title: "Song".into(), artist: "Artist".into(), isrc: isrc.map(Into::into), ids: ids.iter().map(|(s, i)| (*s, i.to_string())).collect(), ..Default::default() };
        // Two rows (different ISRC), then a view linking both ids merges them into the lowest.
        let a = lib.upsert_track(&song(Some("AAAAA0000001"), &[(Source::Youtube, "y")]))?;
        let b = lib.upsert_track(&song(Some("BBBBB0000002"), &[(Source::Apple, "1")]))?;
        assert_ne!(a, b);
        lib.record_play(&Play { track_id: a, started_at: 1, listened_ms: 1, completed: true })?;
        lib.record_play(&Play { track_id: b, started_at: 2, listened_ms: 1, completed: true })?;
        lib.set_pref(b, Some(Pref::Less))?;
        lib.upsert_track(&song(None, &[(Source::Youtube, "y"), (Source::Apple, "1")]))?;
        assert_eq!(lib.plays()?.iter().map(|p| p.track_id).collect::<Vec<_>>(), [a, a]);
        assert_eq!(lib.prefs()?.into_iter().collect::<Vec<_>>(), [(a, Pref::Less)]);
        Ok(())
    }

    #[test]
    fn lists_custom_playlists_only() -> Result<()> {
        let lib = Library::in_memory()?;
        let (a, b) = (track(&lib, "A", Source::Youtube, "a"), track(&lib, "B", Source::Youtube, "b"));
        lib.save_playlist(Source::Youtube, "PL", "Imported", &[])?;
        let p = lib.edit_playlist(PlaylistEdit::Create { name: "Mine".into() })?.unwrap();
        lib.edit_playlist(PlaylistEdit::Add { id: p, track_ids: vec![b, a] })?;
        assert_eq!(lib.custom_playlists()?, [vec![b, a]]);
        Ok(())
    }
}
