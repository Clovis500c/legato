//! Playlists: listed, each one's songs, local and server ones replaced, edits, removals, likes kept.

use super::*;

impl Library {
    pub fn playlists(&self) -> Result<Vec<LibraryPlaylist>> {
        self.playlist_rows(None)
    }

    /// All playlists or `only` these ids (JSON array), in the sidebar's order.
    pub(super) fn playlist_rows(&self, only: Option<&str>) -> Result<Vec<LibraryPlaylist>> {
        let filter = if only.is_some() { "WHERE p.id IN (SELECT value FROM json_each(?1))" } else { "" };
        let mut stmt = self.db.prepare_cached(&format!(
            "SELECT p.id, p.source, p.source_id, p.name, COUNT(pt.track_id), p.custom, p.newest_first, p.order_manual
             FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id {filter}
             GROUP BY p.id ORDER BY p.name COLLATE NOCASE, p.id"
        ))?;
        let rows = stmt.query_map(rusqlite::params_from_iter(only), |r| {
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
        let rows: Vec<LibraryTrack> = stmt.query_map([playlist_id], to_track)?.collect::<rusqlite::Result<_>>()?;
        // Judged among its channels only: a playlist opens in time with its own size, not the library's.
        let group = ids_json(self.channel_members(&rows.iter().map(|t| channel(&t.track.artist)).collect())?);
        self.judged(rows, Some(&group))
    }

    /// Local files mirror a fresh scan: upsert all (links to known tracks), drop vanished paths and orphan rows.
    pub fn replace_local(&self, songs: &[LocalSong]) -> Result<usize> {
        self.tx(|| {
            let songs: Vec<&LocalSong> = songs.iter().filter(|s| !self.is_removed(&s.track).unwrap_or(false)).collect();
            let keep: BTreeSet<&str> = songs.iter().filter_map(|s| s.track.ids.get(&Source::Local).map(String::as_str)).collect();
            for s in &songs {
                let id = self.upsert_track(&s.track)?;
                self.set_genre_year(id, s.genre.as_deref(), s.year)?;
                self.set_tempo_key(id, s.bpm, s.key.as_deref())?;
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

    /// A server's songs mirror its latest sync (`server.rs`): upsert all in one write (links to the same songs from other
    /// sources), drop this server's ids it no longer has, then rows left with no source and no playlist. Other servers'
    /// ids stay. `whole` false (some albums failed to come): upsert only, nothing dropped (a song missing from a partial
    /// read isn't gone, and its plays, ratings and bookmarks would go with its row). Returns this server's songs here.
    pub fn replace_server(&self, key: &str, tracks: &[Track], whole: bool) -> Result<usize> {
        let prefix = format!("{key}:");
        self.tx(|| {
            let tracks: Vec<&Track> = tracks.iter().filter(|t| !self.is_removed(t).unwrap_or(false)).collect();
            let keep: BTreeSet<&str> = tracks.iter().filter_map(|t| t.ids.get(&Source::Server).map(String::as_str)).filter(|id| id.starts_with(&prefix)).collect();
            for t in &tracks {
                self.upsert_track(t)?;
            }
            let old: Vec<String> = {
                let mut stmt = self.db.prepare("SELECT source_id FROM track_ids WHERE source = 'server' AND substr(source_id, 1, ?2) = ?1")?;
                stmt.query_map(params![prefix, prefix.len() as i64], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?
            };
            if !whole {
                return Ok(old.len());
            }
            for id in old.iter().filter(|id| !keep.contains(id.as_str())) {
                self.db.execute("DELETE FROM track_ids WHERE source = 'server' AND source_id = ?1", [id])?;
            }
            self.db.execute("DELETE FROM tracks WHERE id NOT IN (SELECT track_id FROM track_ids) AND id NOT IN (SELECT track_id FROM playlist_tracks)", [])?;
            Ok(keep.len())
        })
    }

    /// A server's imported playlists that it no longer has (`keep` = its playlists' library ids now) go, rows left
    /// without a source with them. Signed out: `keep` empty, every one goes.
    pub fn drop_server_playlists(&self, key: &str, keep: &[String]) -> Result<()> {
        let prefix = format!("{key}:");
        self.tx(|| {
            let mine: Vec<(i64, String)> = {
                let mut stmt = self.db.prepare("SELECT id, source_id FROM playlists WHERE source = 'server' AND custom = 0 AND substr(source_id, 1, ?2) = ?1")?;
                stmt.query_map(params![prefix, prefix.len() as i64], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?
            };
            for (id, sid) in mine.iter().filter(|(_, sid)| !keep.contains(sid)) {
                self.db.execute("DELETE FROM playlists WHERE id = ?1", [id])?;
                self.gone("playlist", &format!("server:{sid}"))?;
            }
            self.db.execute("DELETE FROM tracks WHERE id NOT IN (SELECT track_id FROM track_ids) AND id NOT IN (SELECT track_id FROM playlist_tracks)", [])?;
            Ok(())
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

    /// A playlist made here that a service now holds too (`createPlaylist` on a music server): from now on it is that
    /// service's, mirrored, so the next sync finds it by its id instead of importing a second copy.
    pub fn adopt_playlist(&self, id: i64, source: Source, source_id: &str) -> Result<()> {
        let source = serde_json::to_value(source)?;
        let n = self.db.execute("UPDATE playlists SET source = ?1, source_id = ?2, custom = 0, updated = ?3 WHERE id = ?4 AND custom = 1", params![source.as_str(), source_id, now_ms(), id])?;
        anyhow::ensure!(n == 1, "Not a playlist made here");
        Ok(())
    }

    /// Your own "Liked Music": what a like waits in, or all of them with no YouTube Music. Made when first needed.
    pub fn keep_in_own_likes(&self, ids: &[i64]) -> Result<i64> {
        let own = match self.playlists()?.into_iter().find(|p| p.custom && p.name == "Liked Music") {
            Some(p) => p.id,
            None => self.edit_playlist(PlaylistEdit::Create { name: "Liked Music".into() })?.context("Liked Music not created")?,
        };
        let there: BTreeSet<i64> = self.playlist_track_ids(own)?.into_iter().collect();
        let todo: Vec<i64> = ids.iter().copied().filter(|t| !there.contains(t)).collect();
        if !todo.is_empty() {
            self.edit_playlist(PlaylistEdit::Add { id: own, track_ids: todo })?;
        }
        Ok(own)
    }

    /// A service's likes into the one Liked Music (user's choice 2026-10-31). Not there yet on YouTube Music's: into your own,
    /// and at the next sync the ones with a YouTube version are liked on the account and move over (`push_own_likes`).
    /// Returns the list to open. Songs removed from the library stay out.
    pub fn add_likes(&self, tracks: &[Track]) -> Result<i64> {
        let youtube = self.playlists()?.into_iter().find(|p| p.source == Source::Youtube && !p.custom && p.source_id == "LM").map(|p| p.id);
        let there: BTreeSet<i64> = youtube.map_or(Ok(Vec::new()), |id| self.playlist_track_ids(id))?.into_iter().collect();
        let kept: Vec<&Track> = tracks.iter().filter(|t| !self.is_removed(t).unwrap_or(false)).collect();
        let ids = self.tx(|| kept.iter().map(|t| self.upsert_track(t)).collect::<Result<Vec<_>>>())?;
        let mut seen = BTreeSet::new();
        let todo: Vec<i64> = ids.into_iter().filter(|id| !there.contains(id) && seen.insert(*id)).collect();
        match youtube {
            Some(id) if todo.is_empty() => Ok(id),
            Some(id) => self.keep_in_own_likes(&todo).map(|_| id),
            None => self.keep_in_own_likes(&todo),
        }
    }

    pub(super) fn new_custom(&self, name: &str) -> Result<i64> {
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

    pub(super) fn ensure_custom(&self, id: i64) -> Result<()> {
        let custom: Option<bool> = self.db.query_row("SELECT custom FROM playlists WHERE id = ?1", [id], |r| r.get(0)).optional()?;
        anyhow::ensure!(custom.is_some(), "Playlist not found");
        anyhow::ensure!(custom == Some(true), "Imported playlist: edit it in its service, or duplicate it");
        Ok(())
    }

    pub(super) fn playlist_track_ids(&self, id: i64) -> Result<Vec<i64>> {
        let mut stmt = self.db.prepare_cached("SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position")?;
        Ok(stmt.query_map([id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?)
    }

    /// Read order, mutate, write back. Small lists: simpler than shifting positions under the PK.
    pub(super) fn rewrite(&self, id: i64, f: impl FnOnce(&mut Vec<i64>)) -> Result<()> {
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
}
