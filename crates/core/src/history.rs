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
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Play {
    pub track_id: i64,
    pub started_at: i64,
    pub listened_ms: u32,
    pub completed: bool,
}

/// What the recommendation reads about a library song (`taste_signals`; a song with none of it is left out: absent = zero).
/// `plays_*` = the sum of the plays' weights (`mixes::play_weight`, a skip counts below zero) each decayed by its age, with a
/// 30-day half-life (taste now) and a 180-day one (the long profile); `last_played` unix s, 0 = never; `skips_recent` = skips
/// (under 30 s, not finished) in the last `SKIP_DAYS` days; `liked` = in Liked Music; `less` / `never` = the song's pref.
#[derive(Debug, Clone, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TasteSignal {
    pub id: i64,
    pub plays_decayed: f64,
    pub plays_long: f64,
    pub last_played: i64,
    pub skips_recent: u32,
    pub liked: bool,
    pub less: bool,
    pub never: bool,
    /// Bit h set = played (finished or 30 s heard) at local hour h in the last 90 days: the time-of-day signal.
    pub hours: u32,
    /// The songs heard right before or after this one in a session (30 min apart at most, skips passed over), most often
    /// first, `NEAR` at most: what goes together for you (YouTube's "watched together", from this PC alone).
    pub near: Vec<i64>,
}

/// Songs kept in `TasteSignal::near`.
const NEAR: usize = 8;

/// How far back a skip still counts for the ranking.
const SKIP_DAYS: i64 = 30;
/// How far back the hours of the day a song is played at are kept.
const HOUR_DAYS: i64 = 90;

/// User control over mixes: Less = ranked lower, Never = left out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
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

    /// Plays started at or after `since` (unix s), oldest first. Home's Your week.
    pub fn plays_since(&self, since: i64) -> Result<Vec<Play>> {
        let mut stmt = self.db.prepare_cached("SELECT track_id, started_at, listened_ms, completed FROM plays WHERE started_at >= ?1 ORDER BY started_at, id")?;
        Ok(stmt.query_map([since], |r| Ok(Play { track_id: r.get(0)?, started_at: r.get(1)?, listened_ms: r.get(2)?, completed: r.get(3)? }))?.collect::<rusqlite::Result<_>>()?)
    }

    /// Per track: listens (full ones, or 30 s heard) and the last start. For "Most played" / "Recently played" sorts.
    /// Per song: listens, last start (unix s, 0 = never), your rating in half stars (0 = none).
    pub fn play_stats(&self) -> Result<HashMap<i64, (u32, i64, u8)>> {
        let mut stmt = self.db.prepare_cached("SELECT track_id, SUM(completed OR listened_ms >= 30000), MAX(started_at) FROM plays GROUP BY track_id")?;
        let mut out: HashMap<i64, (u32, i64, u8)> = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, (r.get::<_, u32>(1)?, r.get::<_, i64>(2)?, 0))))?.collect::<rusqlite::Result<_>>()?;
        let mut stmt = self.db.prepare_cached("SELECT track_id, stars FROM track_ratings WHERE stars > 0")?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, u8>(1)?)))? {
            let (id, stars) = row?;
            out.entry(id).or_default().2 = stars;
        }
        Ok(out)
    }

    /// Your rating of a song in half stars, 1..=10; 0 takes it off (kept with its time: Sync Mode carries it).
    pub fn set_rating(&self, track_id: i64, stars: u8) -> Result<()> {
        anyhow::ensure!(stars <= 10, "A rating is 0 to 5 stars");
        self.db.execute(
            "INSERT INTO track_ratings (track_id, stars, at) VALUES (?1, ?2, ?3) ON CONFLICT (track_id) DO UPDATE SET stars = excluded.stars, at = excluded.at",
            params![track_id, stars, crate::library::now_ms()],
        )?;
        Ok(())
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

    /// The signals of every song that has any, from the plays, the prefs and Liked Music, in one pass over the plays (no per-song
    /// call). `now` = unix seconds, `utc_offset` = local minus UTC in seconds (for `hours`). Same weights and decays as the mixes (`mixes::play_weight`, `decay`, `long_decay`).
    pub fn taste_signals(&self, now: i64, utc_offset: i64) -> Result<Vec<TasteSignal>> {
        let mut out: HashMap<i64, TasteSignal> = HashMap::new();
        let blank = |id| TasteSignal { id, plays_decayed: 0.0, plays_long: 0.0, last_played: 0, skips_recent: 0, liked: false, less: false, never: false, hours: 0, near: Vec::new() };
        let mut stmt = self.db.prepare_cached("SELECT p.track_id, p.started_at, p.listened_ms, p.completed, t.duration_ms FROM plays p JOIN tracks t ON t.id = p.track_id ORDER BY p.started_at")?;
        let rows = stmt.query_map([], |r| Ok((Play { track_id: r.get(0)?, started_at: r.get(1)?, listened_ms: r.get(2)?, completed: r.get(3)? }, r.get::<_, Option<u32>>(4)?)))?;
        // Song → song heard next to it → times; the last listen heard (finished or 30 s), with its start.
        let mut links: HashMap<i64, HashMap<i64, u32>> = HashMap::new();
        let mut prev: Option<(i64, i64)> = None;
        for row in rows {
            let (p, duration) = row?;
            if p.completed || p.listened_ms >= crate::mixes::SKIP_MS {
                if let Some((a, _)) = prev.filter(|(a, at)| *a != p.track_id && p.started_at - at <= crate::mixes::SESSION_GAP) {
                    *links.entry(a).or_default().entry(p.track_id).or_default() += 1;
                    *links.entry(p.track_id).or_default().entry(a).or_default() += 1;
                }
                prev = Some((p.track_id, p.started_at));
            }
            let s = out.entry(p.track_id).or_insert_with(|| blank(p.track_id));
            let w = crate::mixes::play_weight(&p, duration);
            s.plays_decayed += w * crate::mixes::decay(now - p.started_at);
            s.plays_long += w * crate::mixes::long_decay(now - p.started_at);
            s.last_played = s.last_played.max(p.started_at);
            if !p.completed && p.listened_ms < crate::mixes::SKIP_MS && p.started_at >= now - SKIP_DAYS * 86_400 {
                s.skips_recent += 1;
            }
            if (p.completed || p.listened_ms >= crate::mixes::SKIP_MS) && p.started_at >= now - HOUR_DAYS * 86_400 {
                s.hours |= 1 << ((p.started_at + utc_offset).rem_euclid(86_400) / 3600);
            }
        }
        for (id, pref) in self.prefs()? {
            let s = out.entry(id).or_insert_with(|| blank(id));
            (s.less, s.never) = (pref == Pref::Less, pref == Pref::Never);
        }
        for id in self.liked_tracks()? {
            out.entry(id).or_insert_with(|| blank(id)).liked = true;
        }
        for (id, next) in links {
            let mut next: Vec<(i64, u32)> = next.into_iter().collect();
            next.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
            out.entry(id).or_insert_with(|| blank(id)).near = next.into_iter().take(NEAR).map(|(n, _)| n).collect();
        }
        let mut all: Vec<_> = out.into_values().collect();
        all.sort_by_key(|s| s.id);
        Ok(all)
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

    /// Track ids in Liked Music, newest like first: YouTube Music's (each account, newest on top) and yours of that name
    /// (heart button, newest at the end). Liked in several: its newest spot.
    pub fn liked_tracks(&self) -> Result<Vec<i64>> {
        let mut stmt = self.db.prepare_cached(
            "SELECT p.id, p.custom, pt.track_id FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id
             WHERE (p.source = 'youtube' AND p.custom = 0 AND (p.source_id = 'LM' OR p.source_id LIKE 'LM~%')) OR (p.custom = 1 AND p.name = 'Liked Music')
             ORDER BY p.id, pt.position",
        )?;
        let rows: Vec<(i64, bool, i64)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
        let mut rank: HashMap<i64, usize> = HashMap::new();
        for list in rows.chunk_by(|a, b| a.0 == b.0) {
            let n = list.len();
            for (i, (_, custom, track)) in list.iter().enumerate() {
                let r = if *custom { n - 1 - i } else { i };
                rank.entry(*track).and_modify(|x| *x = (*x).min(r)).or_insert(r);
            }
        }
        let mut out: Vec<(usize, i64)> = rank.into_iter().map(|(t, r)| (r, t)).collect();
        out.sort_unstable();
        Ok(out.into_iter().map(|(_, t)| t).collect())
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
        assert_eq!(lib.plays_since(15)?.iter().map(|p| p.started_at).collect::<Vec<_>>(), [20]);
        // 1 s listen doesn't count, the full one does; last start is the latest.
        assert_eq!(lib.play_stats()?[&a], (1, 20, 0));
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
    fn taste_signals_cover_the_whole_library_in_one_pass() -> Result<()> {
        let now = 400 * 86_400;
        let lib = Library::in_memory()?;
        assert!(lib.taste_signals(now, 0)?.is_empty(), "empty library");
        let (a, b, c, d) = (track(&lib, "A", Source::Youtube, "a"), track(&lib, "B", Source::Youtube, "b"), track(&lib, "C", Source::Youtube, "c"), track(&lib, "D", Source::Youtube, "d"));
        // A: a full listen now, one 30 days ago (half the weight), two recent skips, an old one (90 days).
        for (at, ms, done) in [(now - 5, 200_000, true), (now - 30 * 86_400, 200_000, true), (now - 10, 5_000, false), (now - 86_400, 29_000, false), (now - 90 * 86_400, 1_000, false)] {
            lib.record_play(&Play { track_id: a, started_at: at, listened_ms: ms, completed: done })?;
        }
        lib.set_pref(b, Some(Pref::Never))?;
        lib.set_pref(c, Some(Pref::Less))?;
        let liked = lib.edit_playlist(PlaylistEdit::Create { name: "Liked Music".into() })?.unwrap();
        lib.edit_playlist(PlaylistEdit::Add { id: liked, track_ids: vec![d] })?;
        let got = lib.taste_signals(now, 0)?;
        let by = |id| got.iter().find(|s| s.id == id).unwrap();
        let s = by(a);
        assert_eq!((s.skips_recent, s.last_played), (2, now - 5));
        // 1 + 0.5 (30 days: half-life) - 0.8 - 0.31 - 0.11 (the 90-day skip, an eighth).
        assert!((s.plays_decayed - 0.277).abs() < 0.01, "{}", s.plays_decayed);
        // The long profile (half-life 180 days): 1 + 0.89 - 0.8 - 0.32 - 0.62.
        assert!((s.plays_long - 0.150).abs() < 0.01, "{}", s.plays_long);
        assert!(!s.never && !s.less && !s.liked);
        assert!(by(b).never && !by(b).less && by(b).skips_recent == 0);
        assert!(by(c).less && !by(c).never, "Less is not Never");
        assert!(by(d).liked && by(d).last_played == 0, "liked, never played");
        let e = track(&lib, "E", Source::Youtube, "e");
        assert!(lib.taste_signals(now, 0)?.iter().all(|s| s.id != e), "a song with no signal is left out: absent = zero");
        assert!(got.iter().all(|s| s.id != 9999), "unknown id");
        Ok(())
    }

    #[test]
    fn taste_signals_keep_the_local_hours_a_song_was_played_in_the_last_90_days() -> Result<()> {
        let lib = Library::in_memory()?;
        let a = track(&lib, "A", Source::Youtube, "a");
        let now = 200 * 86_400 + 12 * 3600;
        // 10:30 UTC two days ago, finished: with a +1 h offset that is local hour 11. A skip at 03:00 and a play 100 days ago leave no hour.
        for (at, ms, done) in [(now - 2 * 86_400 - 5_400, 200_000, true), (now - 86_400 - 9 * 3600, 5_000, false), (now - 100 * 86_400, 200_000, true)] {
            lib.record_play(&Play { track_id: a, started_at: at, listened_ms: ms, completed: done })?;
        }
        let s = lib.taste_signals(now, 3600)?.into_iter().find(|s| s.id == a).unwrap();
        assert_eq!(s.hours, 1 << 11);
        Ok(())
    }

    #[test]
    fn taste_signals_link_the_songs_heard_one_after_the_other() -> Result<()> {
        let lib = Library::in_memory()?;
        let [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map(|k| track(&lib, k, Source::Youtube, k));
        let now = 100 * 86_400;
        // A and B back and forth (4 links), A and C (2), then A, a skip of D, E: A goes with E, D with nobody. An hour later, B: no link to E.
        let heard = |id, at| Play { track_id: id, started_at: at, listened_ms: 200_000, completed: true };
        for p in [heard(a, 0), heard(b, 200), heard(a, 400), heard(b, 600), heard(a, 800), heard(c, 1000), heard(a, 1200), Play { track_id: d, started_at: 1400, listened_ms: 3_000, completed: false }, heard(e, 1420), heard(b, 1420 + 3600)] {
            lib.record_play(&Play { started_at: now - 10_000 + p.started_at, ..p })?;
        }
        let got = lib.taste_signals(now, 0)?;
        let near = |id| got.iter().find(|s| s.id == id).map(|s| s.near.clone()).unwrap();
        assert_eq!(near(a), [b, c, e], "most often first");
        assert_eq!(near(b), [a]);
        assert_eq!(near(e), [a]);
        assert!(near(d).is_empty(), "a skip goes with nothing");
        Ok(())
    }

    #[test]
    fn ratings_come_with_the_stats_and_outlive_cleared_history() -> Result<()> {
        let lib = Library::in_memory()?;
        let (a, b) = (track(&lib, "A", Source::Youtube, "a"), track(&lib, "B", Source::Youtube, "b"));
        lib.record_play(&Play { track_id: a, started_at: 20, listened_ms: 200_000, completed: true })?;
        lib.set_rating(a, 9)?;
        lib.set_rating(b, 4)?;
        let stats = lib.play_stats()?;
        assert_eq!((stats[&a], stats[&b]), ((1, 20, 9), (0, 0, 4)), "rated, never played");
        assert!(lib.set_rating(a, 11).is_err());
        // Not history: clearing it keeps them. Taken off: out of the stats.
        lib.clear_history()?;
        assert_eq!(lib.play_stats()?[&a], (0, 0, 9));
        lib.set_rating(b, 0)?;
        assert!(!lib.play_stats()?.contains_key(&b));
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

    #[test]
    fn liked_tracks_from_youtube_and_your_liked_music() -> Result<()> {
        let lib = Library::in_memory()?;
        let (a, b, c) = (track(&lib, "A", Source::Youtube, "a"), track(&lib, "B", Source::Youtube, "b"), track(&lib, "C", Source::Youtube, "c"));
        let ids = |t: i64| lib.tracks().unwrap().into_iter().find(|x| x.id == t).unwrap().track;
        lib.save_playlist(Source::Youtube, "LM~1", "Liked Music", &[ids(a)])?;
        lib.save_playlist(Source::Youtube, "PL", "Liked Music", &[ids(c)])?;
        let p = lib.edit_playlist(PlaylistEdit::Create { name: "Liked Music".into() })?.unwrap();
        lib.edit_playlist(PlaylistEdit::Add { id: p, track_ids: vec![b] })?;
        lib.edit_playlist(PlaylistEdit::Add { id: p, track_ids: vec![a] })?;
        // a: newest on YouTube (top) and here (end); b: second here.
        assert_eq!(lib.liked_tracks()?, [a, b], "a YouTube playlist merely named so doesn't count");
        Ok(())
    }
}
