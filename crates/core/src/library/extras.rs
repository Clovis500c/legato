//! A song's extras: cached lyrics and their search, bookmarks, the analysis caches (silence, loudness, waveform, SponsorBlock), edits.

use super::*;

impl Library {
    /// Lyrics looked up before: Some((body, when)), body None = nothing found then.
    pub fn cached_lyrics(&self, key: &str) -> Result<Option<(Option<String>, i64)>> {
        Ok(self.db.query_row("SELECT body, fetched FROM lyrics WHERE key = ?1", [key], |r| Ok((r.get(0)?, r.get(1)?))).optional()?)
    }

    /// A moment of a library song kept, its note trimmed (200 characters at most). Within a second of one already there:
    /// that one, its note replaced when this one has one. False when the song is gone or has MAX_BOOKMARKS.
    pub fn add_bookmark(&self, track_id: i64, ms: i64, note: &str, now: i64) -> Result<bool> {
        let note: String = note.trim().chars().take(200).collect();
        let ms = ms.clamp(0, 24 * 3_600_000);
        let near: Option<i64> = self.db.query_row("SELECT id FROM bookmarks WHERE track_id = ?1 AND abs(ms - ?2) < 1000 ORDER BY abs(ms - ?2) LIMIT 1", params![track_id, ms], |r| r.get(0)).optional()?;
        if let Some(id) = near {
            if !note.is_empty() {
                self.db.execute("UPDATE bookmarks SET note = ?1 WHERE id = ?2", params![note, id])?;
            }
            return Ok(true);
        }
        let (exists, count): (bool, i64) = self.db.query_row("SELECT EXISTS (SELECT 1 FROM tracks WHERE id = ?1), (SELECT count(*) FROM bookmarks WHERE track_id = ?1)", [track_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        if !exists || count >= MAX_BOOKMARKS {
            return Ok(false);
        }
        self.db.execute("INSERT INTO bookmarks (track_id, ms, note, created) VALUES (?1, ?2, ?3, ?4)", params![track_id, ms, note, now])?;
        Ok(true)
    }

    /// A song's bookmarks, in its order.
    pub fn bookmarks(&self, track_id: i64) -> Result<Vec<Bookmark>> {
        let mut q = self.db.prepare_cached("SELECT id, ms, note FROM bookmarks WHERE track_id = ?1 ORDER BY ms, id")?;
        let rows = q.query_map([track_id], |r| Ok(Bookmark { id: r.get(0)?, track_id, ms: r.get(1)?, note: r.get(2)? }))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn delete_bookmark(&self, id: i64) -> Result<()> {
        self.db.execute("DELETE FROM bookmarks WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn save_lyrics(&self, key: &str, body: Option<&str>, fetched: i64) -> Result<()> {
        self.db.execute(
            "INSERT INTO lyrics (key, body, fetched) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET body = excluded.body, fetched = excluded.fetched",
            params![key, body, fetched],
        )?;
        Ok(())
    }

    /// Library songs whose lyrics, cached when they were shown, hold `phrase` (`lyrics::fold`ed), with the line it
    /// starts on; `limit` at most, in the library's order. Lyrics read from a song's own file aren't cached: not here.
    pub fn lyrics_search(&self, phrase: &str, limit: usize) -> Result<Vec<LyricHit>> {
        let mut found: HashMap<String, String> = HashMap::new();
        let mut q = self.db.prepare("SELECT key, body FROM lyrics WHERE body IS NOT NULL")?;
        for row in q.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (key, body) = row?;
            let Some(song) = lyrics::key_song(&key) else { continue };
            if found.contains_key(song) {
                continue;
            }
            if let Some(line) = serde_json::from_str::<Lyrics>(&body).ok().and_then(|l| lyrics::line_holding(&l, phrase)) {
                found.insert(song.to_string(), line);
            }
        }
        if found.is_empty() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        let mut q = self.db.prepare("SELECT id, artist, title FROM tracks ORDER BY id")?;
        for row in q.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))? {
            if out.len() >= limit {
                break;
            }
            let (id, artist, title) = row?;
            let key = lyrics::key(&artist, &title, None);
            if let Some(line) = lyrics::key_song(&key).and_then(|s| found.get(s)) {
                out.push(LyricHit { track_id: id, line: line.clone() });
            }
        }
        Ok(out)
    }

    /// Silence measured in a local file: Some((start_ms, end_ms, total_ms)) when it was measured with this `modified`
    /// time (a changed file is measured again). end_ms None = no silence worth cutting at the end.
    pub fn cached_silence(&self, path: &str, modified: i64) -> Result<Option<(u64, Option<u64>, u64)>> {
        Ok(self
            .db
            .query_row("SELECT start_ms, end_ms, total_ms FROM silence WHERE path = ?1 AND modified = ?2", params![path, modified], |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, Option<i64>>(1)?.map(|e| e as u64), r.get::<_, i64>(2)? as u64)))
            .optional()?)
    }

    pub fn save_silence(&self, path: &str, modified: i64, start_ms: u64, end_ms: Option<u64>, total_ms: u64) -> Result<()> {
        self.db.execute(
            "INSERT INTO silence (path, modified, start_ms, end_ms, total_ms) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (path) DO UPDATE SET modified = excluded.modified, start_ms = excluded.start_ms, end_ms = excluded.end_ms, total_ms = excluded.total_ms",
            params![path, modified, start_ms as i64, end_ms.map(|e| e as i64), total_ms as i64],
        )?;
        // A cache: the oldest rows (files long gone, mostly) go past this many.
        self.db.execute("DELETE FROM silence WHERE rowid <= (SELECT MAX(rowid) FROM silence) - ?1", [SILENCE_KEEP])?;
        Ok(())
    }

    /// Loudness measured in a local file: Some((LUFS, sample peak)) when it was measured with this `modified` time.
    /// LUFS None = silent throughout.
    pub fn cached_loudness(&self, path: &str, modified: i64) -> Result<Option<(Option<f32>, f32)>> {
        Ok(self.db.query_row("SELECT lufs, peak FROM loudness WHERE path = ?1 AND modified = ?2", params![path, modified], |r| Ok((r.get::<_, Option<f64>>(0)?.map(|l| l as f32), r.get::<_, f64>(1)? as f32))).optional()?)
    }

    pub fn save_loudness(&self, path: &str, modified: i64, lufs: Option<f32>, peak: f32) -> Result<()> {
        self.db.execute(
            "INSERT INTO loudness (path, modified, lufs, peak) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (path) DO UPDATE SET modified = excluded.modified, lufs = excluded.lufs, peak = excluded.peak",
            params![path, modified, lufs.map(f64::from), peak as f64],
        )?;
        self.db.execute("DELETE FROM loudness WHERE rowid <= (SELECT MAX(rowid) FROM loudness) - ?1", [SILENCE_KEEP])?;
        Ok(())
    }

    /// A local file's shape for the seek bar, when it was measured with this `modified` time.
    pub fn cached_waveform(&self, path: &str, modified: i64) -> Result<Option<Vec<u8>>> {
        Ok(self.db.query_row("SELECT shape FROM waveform WHERE path = ?1 AND modified = ?2", params![path, modified], |r| r.get(0)).optional()?)
    }

    pub fn save_waveform(&self, path: &str, modified: i64, shape: &[u8]) -> Result<()> {
        self.db.execute(
            "INSERT INTO waveform (path, modified, shape) VALUES (?1, ?2, ?3) ON CONFLICT (path) DO UPDATE SET modified = excluded.modified, shape = excluded.shape",
            params![path, modified, shape],
        )?;
        self.db.execute("DELETE FROM waveform WHERE rowid <= (SELECT MAX(rowid) FROM waveform) - ?1", [SILENCE_KEEP])?;
        Ok(())
    }

    /// SponsorBlock's answer for a video asked before: Some((JSON list of parts, when)); the empty list is an answer.
    pub fn cached_sponsor(&self, video: &str) -> Result<Option<(String, i64)>> {
        Ok(self.db.query_row("SELECT segments, fetched FROM sponsor WHERE video = ?1", [video], |r| Ok((r.get(0)?, r.get(1)?))).optional()?)
    }

    pub fn save_sponsor(&self, video: &str, segments: &str, fetched: i64) -> Result<()> {
        self.db.execute(
            "INSERT INTO sponsor (video, segments, fetched) VALUES (?1, ?2, ?3) ON CONFLICT (video) DO UPDATE SET segments = excluded.segments, fetched = excluded.fetched",
            params![video, segments, fetched],
        )?;
        // Answers are used for a week: older than a month are never read again.
        self.db.execute("DELETE FROM sponsor WHERE fetched < ?1", [fetched - SPONSOR_KEEP_S])?;
        Ok(())
    }

    /// Bytes the caches hold in the file, their indexes too (SQLite's `dbstat`): Settings › General › Storage.
    pub fn caches_bytes(&self) -> Result<u64> {
        let tables = CACHES.map(|t| format!("'{t}'")).join(", ");
        let sql = format!("SELECT COALESCE(SUM(payload), 0) FROM dbstat WHERE name IN (SELECT name FROM sqlite_master WHERE tbl_name IN ({tables}))");
        Ok(self.db.query_row(&sql, [], |r| r.get::<_, i64>(0))?.max(0) as u64)
    }

    /// Empties the caches, the file given back their room (VACUUM). The bytes they held.
    pub fn clear_caches(&self) -> Result<u64> {
        let held = self.caches_bytes()?;
        // Lyrics picked by hand are the user's choice, not a cache.
        let deletes: String = CACHES.iter().map(|t| if *t == "lyrics" { format!("DELETE FROM lyrics WHERE key NOT LIKE '{}%'; ", lyrics::PICK) } else { format!("DELETE FROM {t}; ") }).collect();
        self.db.execute_batch(&format!("BEGIN; {deletes}COMMIT; VACUUM;"))?;
        Ok(held)
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
}
