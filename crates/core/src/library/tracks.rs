//! Songs: found, added and merged, their versions, the rows the interface reads, the change log, a song's details.

use super::*;

impl Library {
    /// Insert or merge track (source id, then ISRC, then title+artist+duration). Return row id.
    /// Existing row for this track, without writing (search results: "already added").
    pub fn find(&self, t: &Track) -> Result<Option<i64>> {
        Ok(self.lookup(t)?.first().copied())
    }

    /// This song's YouTube version when the library has one: the same row `upsert_track` would pick, no search needed.
    pub fn known_youtube(&self, t: &Track) -> Result<Option<String>> {
        let mut video = self.db.prepare_cached("SELECT source_id FROM track_ids WHERE track_id = ?1 AND source = ?2")?;
        for row in self.lookup(t)? {
            if let Some(id) = video.query_row(params![row, Source::Youtube.as_str()], |r| r.get(0)).optional()? {
                return Ok(Some(id));
            }
        }
        Ok(None)
    }

    /// A song's YouTube version found after its list was saved. Removed by the user: stays out.
    pub fn add_version(&self, t: &Track) -> Result<()> {
        if !self.is_removed(t)? {
            self.upsert_track(t)?;
        }
        Ok(())
    }

    /// Searched on YouTube, no version: on the list of songs not found, and left alone for a while.
    pub fn mark_not_found(&self, t: &Track) -> Result<()> {
        if let Some(row) = self.find(t)? {
            self.db.prepare_cached("INSERT OR REPLACE INTO not_found (track_id, searched) VALUES (?1, ?2)")?.execute(params![row, now_ms()])?;
        }
        Ok(())
    }

    /// Searched lately with nothing found: an import doesn't ask again. After `SEARCH_AGAIN`, it does: YouTube gets new songs.
    pub fn not_found_lately(&self, t: &Track) -> Result<bool> {
        let mut when = self.db.prepare_cached("SELECT searched FROM not_found WHERE track_id = ?1")?;
        for row in self.lookup(t)? {
            if when.query_row([row], |r| r.get::<_, i64>(0)).optional()?.is_some_and(|at| now_ms() - at < SEARCH_AGAIN) {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Songs not found: the rows still with nothing to play them from.
    pub fn not_found(&self) -> Result<Vec<i64>> {
        let mut stmt = self.db.prepare_cached(
            "SELECT n.track_id FROM not_found n WHERE NOT EXISTS (SELECT 1 FROM track_ids i WHERE i.track_id = n.track_id AND i.source IN ('youtube', 'local'))",
        )?;
        Ok(stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?)
    }

    /// Rows matching by source id, then ISRC, then title+artist+duration.
    pub(super) fn lookup(&self, t: &Track) -> Result<BTreeSet<i64>> {
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
                    self.db.prepare_cached(
                        "INSERT INTO tracks (title, artist, album, duration_ms, isrc, match_key, art, musicness, explicit, added, added_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, (SELECT coalesce(max(added), 0) + 1 FROM tracks), CAST(strftime('%s', 'now') AS INTEGER))",
                    )?
                    .execute(params![t.title, t.artist, t.album, t.duration_ms, isrc, match_key(&t.title, &t.artist), t.art, t.musicness.map(Musicness::as_str), t.explicit])?;
                    self.db.last_insert_rowid()
                }
                Some(keep) => {
                    // Track may sit in several rows (seen on YouTube, then Spotify). Merge into lowest id.
                    for dupe in found {
                        self.absorb(keep, dupe)?;
                    }
                    self.fill(keep, t.album.clone(), t.duration_ms, isrc, t.art.clone(), t.musicness)?;
                    if t.explicit {
                        self.mark_explicit(keep)?;
                    }
                    keep
                }
            };

            // Not OR REPLACE: a known id stays unwritten (and out of the change log), a moved one is an update.
            let mut link = self.db.prepare_cached(
                "INSERT INTO track_ids (source, source_id, track_id) VALUES (?1, ?2, ?3)
                 ON CONFLICT (source, source_id) DO UPDATE SET track_id = excluded.track_id WHERE track_id != excluded.track_id",
            )?;
            for (s, sid) in &t.ids {
                link.execute(params![s.as_str(), sid, id])?;
            }
            Ok(id)
        })
    }

    /// `dupe` folded into `keep`: its ids, playlist spots, plays and preference move over, its details fill gaps.
    pub(super) fn absorb(&self, keep: i64, dupe: i64) -> Result<()> {
        let (album, dur, dupe_isrc, art, music, explicit) = self.db.query_row(
            "SELECT album, duration_ms, isrc, art, musicness, explicit FROM tracks WHERE id = ?1",
            [dupe],
            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<u32>>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, Option<String>>(4)?, r.get::<_, i64>(5)? == 1)),
        )?;
        self.db.execute("UPDATE track_ids SET track_id = ?1 WHERE track_id = ?2", [keep, dupe])?;
        self.db.execute("UPDATE playlist_tracks SET track_id = ?1 WHERE track_id = ?2", [keep, dupe])?;
        self.db.execute("UPDATE plays SET track_id = ?1 WHERE track_id = ?2", [keep, dupe])?;
        self.db.execute("UPDATE OR IGNORE track_prefs SET track_id = ?1 WHERE track_id = ?2", [keep, dupe])?;
        self.db.execute("UPDATE OR IGNORE track_ratings SET track_id = ?1 WHERE track_id = ?2", [keep, dupe])?;
        self.db.execute("UPDATE OR IGNORE not_found SET track_id = ?1 WHERE track_id = ?2", [keep, dupe])?;
        self.db.execute("UPDATE bookmarks SET track_id = ?1 WHERE track_id = ?2", [keep, dupe])?;
        self.db.execute(
            "UPDATE tracks SET added = min(added, (SELECT added FROM tracks WHERE id = ?2)),
               added_at = coalesce(min(added_at, (SELECT added_at FROM tracks WHERE id = ?2)), added_at, (SELECT added_at FROM tracks WHERE id = ?2))
             WHERE id = ?1",
            [keep, dupe],
        )?;
        self.db.execute("DELETE FROM tracks WHERE id = ?1", [dupe])?;
        if explicit {
            self.mark_explicit(keep)?;
        }
        self.fill(keep, album, dur, dupe_isrc, art, music.as_deref().and_then(Musicness::parse))
    }

    /// Duplicates finder: `others` become `keep` (one song with every source, playlist spot and play).
    pub fn merge_tracks(&self, keep: i64, others: &[i64]) -> Result<()> {
        self.tx(|| {
            let exists = |id: i64| self.db.query_row("SELECT 1 FROM tracks WHERE id = ?1", [id], |_| Ok(())).optional().map(|r| r.is_some());
            anyhow::ensure!(exists(keep)?, "Song not found");
            for &dupe in others {
                if dupe != keep && exists(dupe)? {
                    self.absorb(keep, dupe)?;
                }
            }
            Ok(())
        })
    }

    /// A version picked by hand for `keep` (Songs not found): the picked song's ids join that row, a row of its own folded
    /// in, so the playlists holding `keep` play it and it leaves the list. Its names stay the imported ones.
    pub fn set_version(&self, keep: i64, picked: &Track) -> Result<()> {
        self.tx(|| {
            anyhow::ensure!(self.db.query_row("SELECT 1 FROM tracks WHERE id = ?1", [keep], |_| Ok(())).optional()?.is_some(), "Song not found");
            let other = self.upsert_track(picked)?;
            if other != keep {
                self.absorb(keep, other)?;
            }
            self.db.execute("DELETE FROM not_found WHERE track_id = ?1", [keep])?;
            Ok(())
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
            // Same songs in the same order (most syncs): rows left as they are.
            if ids != old_order {
                self.db.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", [id])?;
                for (pos, track_id) in ids.into_iter().enumerate() {
                    self.db.execute("INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?1, ?2, ?3)", params![id, pos as i64, track_id])?;
                }
            }
            if flipped {
                self.rerank(&[id])?;
            }
            Ok(id)
        })
    }

    /// Imported playlist's "date added" order: (newest first, set by hand).
    pub(super) fn order_of(&self, id: i64) -> Result<(bool, bool)> {
        let (source, set, manual): (String, Option<bool>, bool) =
            self.db.query_row("SELECT source, newest_first, order_manual FROM playlists WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        let source: Source = serde_json::from_value(source.into())?;
        Ok((set.unwrap_or_else(|| default_newest_first(source)), manual))
    }

    /// "Date added" ranks of the tracks a playlist brought in (first appearance, playlists in import order) follow its
    /// current order: the same ranks, handed out again oldest first. Call after a playlist's order changed.
    pub(super) fn rerank(&self, playlists: &[i64]) -> Result<()> {
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
        let rows = self.track_rows(None)?;
        self.judged(rows, None)
    }

    /// One song's row, its ids. None: gone.
    pub fn track(&self, id: i64) -> Result<Option<LibraryTrack>> {
        Ok(self.track_rows(Some(&ids_json([id])))?.into_iter().next())
    }

    /// Library list rows (songs with a source) in its order, all or `only` these ids (JSON array).
    pub(super) fn track_rows(&self, only: Option<&str>) -> Result<Vec<LibraryTrack>> {
        let filter = if only.is_some() { "WHERE t.id IN (SELECT value FROM json_each(?1))" } else { "" };
        // id last: one order, the UI places new rows the same way (libraryPatch.ts).
        let mut stmt = self.db.prepare_cached(&format!(
            "SELECT {TRACK_COLS}, json_group_object(i.source, i.source_id)
             FROM tracks t JOIN track_ids i ON i.track_id = t.id {filter}
             GROUP BY t.id ORDER BY t.artist COLLATE NOCASE, t.title COLLATE NOCASE, t.id"
        ))?;
        Ok(stmt.query_map(rusqlite::params_from_iter(only), to_track)?.collect::<rusqlite::Result<_>>()?)
    }

    /// Music or not for every track, by today's rules (musicness.rs `judge`, talk channels), the user's choice first.
    /// Stored words stay as imported: better rules apply to old imports without a migration. ~15 ms for 3,000 tracks.
    pub fn music_words(&self) -> Result<HashMap<i64, Musicness>> {
        self.words_of(None)
    }

    /// `music_words` of `only` these ids (JSON array). Exact for whole channels only (`channel_members`).
    pub(super) fn words_of(&self, only: Option<&str>) -> Result<HashMap<i64, Musicness>> {
        let filter = if only.is_some() { "WHERE t.id IN (SELECT value FROM json_each(?1))" } else { "" };
        let mut stmt = self.db.prepare_cached(&format!(
            "SELECT t.id, t.title, t.artist, t.duration_ms, t.musicness,
                    EXISTS (SELECT 1 FROM track_ids i WHERE i.track_id = t.id AND i.source != 'youtube')
             FROM tracks t {filter}"
        ))?;
        struct Seen {
            id: i64,
            title: String,
            artist: String,
            duration_ms: Option<u32>,
            stored: Option<String>,
            other_source: bool,
        }
        let rows: Vec<Seen> = stmt
            .query_map(rusqlite::params_from_iter(only), |r| Ok(Seen { id: r.get(0)?, title: r.get(1)?, artist: r.get(2)?, duration_ms: r.get(3)?, stored: r.get(4)?, other_source: r.get(5)? }))?
            .collect::<rusqlite::Result<_>>()?;
        let mut out = HashMap::with_capacity(rows.len());
        let mut doubts = Vec::new();
        for t in &rows {
            let word = match t.stored.as_deref() {
                Some(m) if m.starts_with(USER) => Musicness::parse(&m[USER.len()..]),
                // Local files, Spotify, Apple: songs.
                m if t.other_source => m.and_then(Musicness::parse).or(Some(Musicness::Music)),
                m => {
                    let w = crate::musicness::judge(m.and_then(Musicness::parse), &crate::musicness::Clues { title: &t.title, channel: &t.artist, duration_ms: t.duration_ms, ..Default::default() });
                    if w == Musicness::Unsure {
                        doubts.push((t.id, t.artist.as_str()));
                    }
                    Some(w)
                }
            };
            if let Some(w) = word {
                out.insert(t.id, w);
            }
        }
        let talk = crate::musicness::talk_channels(rows.iter().filter_map(|t| out.get(&t.id).map(|w| (t.artist.as_str(), *w))));
        for (id, artist) in doubts {
            if talk.contains(&artist.trim().to_lowercase()) {
                out.insert(id, Musicness::NotMusic);
            }
        }
        Ok(out)
    }

    /// Rows with today's musicness (`music_words`), judged among `group` (JSON ids: every song of their channels), or
    /// the whole library.
    pub(super) fn judged(&self, mut rows: Vec<LibraryTrack>, group: Option<&str>) -> Result<Vec<LibraryTrack>> {
        let words = self.words_of(group)?;
        for t in &mut rows {
            t.track.musicness = words.get(&t.id).copied().or(t.track.musicness);
        }
        Ok(rows)
    }

    /// Ids of every song (library list or not) of these channels: what `words_of` needs to judge them exactly.
    pub(super) fn channel_members(&self, channels: &std::collections::HashSet<String>) -> Result<Vec<i64>> {
        if channels.is_empty() {
            return Ok(Vec::new());
        }
        let mut stmt = self.db.prepare_cached("SELECT id, artist FROM tracks")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        let mut out = Vec::new();
        for row in rows {
            let (id, artist) = row?;
            if channels.contains(&channel(&artist)) {
                out.push(id);
            }
        }
        Ok(out)
    }

    /// The UI read the whole library: changes logged until now are in it.
    pub fn forget_changes(&self) -> Result<()> {
        self.db.execute("DELETE FROM changed", [])?;
        self.history_read.store(self.versions.history(), std::sync::atomic::Ordering::Relaxed);
        Ok(())
    }

    /// What changed since the last read (this one or `forget_changes`), log emptied once it is all read. None = more
    /// than `max` songs to send: read it whole (log kept until then).
    pub fn take_changes(&self, max: usize) -> Result<Option<Changes>> {
        let logged: Vec<(i64, i64, String)> = self.db.prepare_cached("SELECT kind, id, artist FROM changed")?.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
        let (lists, songs): (Vec<_>, Vec<_>) = logged.into_iter().partition(|(kind, ..)| *kind == 1);
        if songs.len() > max {
            return Ok(None);
        }
        let songs_json = ids_json(songs.iter().map(|(_, id, _)| *id));
        // Channels before (logged) and now: a song in or out can turn its whole channel to talk or back.
        let mut channels: std::collections::HashSet<String> = songs.iter().filter(|(.., a)| !a.is_empty()).map(|(.., a)| channel(a)).collect();
        let mut now = self.db.prepare_cached("SELECT artist FROM tracks WHERE id IN (SELECT value FROM json_each(?1))")?;
        for artist in now.query_map([&songs_json], |r| r.get::<_, String>(0))? {
            channels.insert(channel(&artist?));
        }
        let group = self.channel_members(&channels)?;
        if group.len() > max {
            return Ok(None);
        }
        let group = ids_json(group);
        let tracks = self.judged(self.track_rows(Some(&group))?, Some(&group))?;
        let shown: BTreeSet<i64> = tracks.iter().map(|t| t.id).collect();
        let gone = songs.iter().map(|(_, id, _)| *id).filter(|id| !shown.contains(id)).collect::<BTreeSet<_>>().into_iter().collect();
        let lists: BTreeSet<i64> = lists.into_iter().map(|(_, id, _)| id).collect();
        let playlists = self.playlist_rows(Some(&ids_json(lists.iter().copied())))?;
        let orders = playlists.iter().map(|p| Ok((p.id, self.playlist_track_ids(p.id)?))).collect::<Result<_>>()?;
        let playlists_gone = lists.into_iter().filter(|id| !playlists.iter().any(|p| p.id == *id)).collect();
        let history = self.history_read.load(std::sync::atomic::Ordering::Relaxed) != self.versions.history();
        self.forget_changes()?;
        Ok(Some(Changes { tracks, gone, playlists, playlists_gone, orders, history }))
    }

    /// A local file's tags rewritten by the user (Edit song info): its row follows (rescans only fill gaps).
    /// Local songs whose tags give no tempo or no key: id and file.
    pub fn untimed_local(&self) -> Result<Vec<(i64, String)>> {
        let mut stmt = self.db.prepare("SELECT i.track_id, i.source_id FROM track_ids i JOIN tracks t ON t.id = i.track_id WHERE i.source = 'local' AND (t.bpm IS NULL OR t.key IS NULL) ORDER BY i.track_id")?;
        Ok(stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?)
    }

    /// A guessed tempo (from the sound, Settings › Playback › Estimate tempo): only where no tag gave one, never over it.
    pub fn guess_tempo(&self, id: i64, bpm: u32) -> Result<()> {
        self.db.prepare_cached("UPDATE tracks SET bpm = ?1 WHERE id = ?2 AND bpm IS NULL")?.execute(params![bpm, id])?;
        Ok(())
    }

    /// A guessed key (from the sound, with the tempo guess): only where no tag gave one, never over it.
    pub fn guess_key(&self, id: i64, key: &str) -> Result<()> {
        self.db.prepare_cached("UPDATE tracks SET key = ?1 WHERE id = ?2 AND key IS NULL")?.execute(params![key, id])?;
        Ok(())
    }

    /// A local file's tempo and key, as its tags say now (a scan). Unchanged: nothing written.
    pub fn set_tempo_key(&self, id: i64, bpm: Option<u32>, key: Option<&str>) -> Result<()> {
        self.db.prepare_cached("UPDATE tracks SET bpm = ?1, key = ?2 WHERE id = ?3 AND (bpm, key) IS NOT (?1, ?2)")?.execute(params![bpm, key, id])?;
        Ok(())
    }

    /// A local file's genre and year, as its tags say now (a scan, Edit song info). Unchanged: nothing written.
    pub fn set_genre_year(&self, id: i64, genre: Option<&str>, year: Option<u32>) -> Result<()> {
        self.db.prepare_cached("UPDATE tracks SET genre = ?1, year = ?2 WHERE id = ?3 AND (genre, year) IS NOT (?1, ?2)")?.execute(params![genre, year, id])?;
        Ok(())
    }

    pub fn set_details(&self, id: i64, title: &str, artist: &str, album: Option<&str>) -> Result<()> {
        let n = self.db.execute("UPDATE tracks SET title = ?1, artist = ?2, album = ?3, match_key = ?4 WHERE id = ?5", params![title, artist, album, match_key(title, artist), id])?;
        anyhow::ensure!(n == 1, "Song not found");
        Ok(())
    }

    /// The user says these are music (true) or not (false), above any guess. None = back to the guess.
    pub fn set_music(&self, ids: &[i64], music: Option<bool>) -> Result<()> {
        self.tx(|| {
            for id in ids {
                match music {
                    Some(m) => {
                        let word = if m { Musicness::Music } else { Musicness::NotMusic };
                        self.db.execute("UPDATE tracks SET musicness = ?1 WHERE id = ?2", params![format!("{USER}{}", word.as_str()), id])?;
                    }
                    None => {
                        self.db.execute("UPDATE tracks SET musicness = NULL WHERE id = ?1 AND musicness LIKE 'user:%'", [id])?;
                    }
                }
            }
            Ok(())
        })
    }
}
