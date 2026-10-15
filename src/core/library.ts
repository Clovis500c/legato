import { DatabaseSync } from 'node:sqlite'
import { matchKey, sameTrack } from './match'
import type { Source, Track } from './types'

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  duration_ms INTEGER,
  isrc TEXT UNIQUE,
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
`

interface TrackRow {
  id: number
  title: string
  artist: string
  album: string | null
  duration_ms: number | null
  isrc: string | null
  ids?: string
}

export interface LibraryTrack extends Track {
  id: number
}

export interface LibraryPlaylist {
  id: number
  source: Source
  sourceId: string
  name: string
  trackCount: number
}

function toTrack(r: TrackRow): LibraryTrack {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    album: r.album ?? undefined,
    durationMs: r.duration_ms ?? undefined,
    isrc: r.isrc ?? undefined,
    ids: r.ids ? JSON.parse(r.ids) : {},
  }
}

/** Bibliothèque unifiée locale. Un morceau = une ligne, quel que soit le nombre de services où il existe. */
export class Library {
  private db: DatabaseSync

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path)
    this.db.exec(SCHEMA)
  }

  close() {
    this.db.close()
  }

  /** Insère ou fusionne un morceau (par id de source, puis ISRC, puis titre+artiste+durée). Renvoie son id. */
  upsertTrack(t: Track): number {
    return this.tx(() => {
      const found = new Set<number>()
      const byId = this.db.prepare('SELECT track_id AS id FROM track_ids WHERE source = ? AND source_id = ?')
      for (const [source, sourceId] of Object.entries(t.ids)) {
        const r = byId.get(source, sourceId!) as { id: number } | undefined
        if (r) found.add(r.id)
      }
      if (t.isrc) {
        const r = this.db.prepare('SELECT id FROM tracks WHERE isrc = ? COLLATE NOCASE').get(t.isrc) as { id: number } | undefined
        if (r) found.add(r.id)
      }
      if (!found.size) {
        const rows = this.db.prepare('SELECT * FROM tracks WHERE match_key = ?').all(matchKey(t)) as unknown as TrackRow[]
        const hit = rows.find((r) => sameTrack(toTrack(r), { ...t, ids: {} }))
        if (hit) found.add(hit.id)
      }

      let id: number
      if (!found.size) {
        id = Number(
          this.db
            .prepare('INSERT INTO tracks (title, artist, album, duration_ms, isrc, match_key) VALUES (?, ?, ?, ?, ?, ?)')
            .run(t.title, t.artist, t.album ?? null, t.durationMs ?? null, t.isrc?.toUpperCase() ?? null, matchKey(t))
            .lastInsertRowid,
        )
      } else {
        // Le morceau peut être déjà présent en plusieurs lignes (ex. vu sur YouTube puis sur Spotify) : on les fusionne.
        const [keep, ...dupes] = [...found].sort((a, b) => a - b)
        id = keep
        for (const d of dupes) {
          const row = this.db.prepare('SELECT * FROM tracks WHERE id = ?').get(d) as unknown as TrackRow
          this.db.prepare('UPDATE track_ids SET track_id = ? WHERE track_id = ?').run(keep, d)
          this.db.prepare('UPDATE playlist_tracks SET track_id = ? WHERE track_id = ?').run(keep, d)
          this.db.prepare('DELETE FROM tracks WHERE id = ?').run(d)
          this.fill(keep, row.album, row.duration_ms, row.isrc)
        }
        this.fill(keep, t.album ?? null, t.durationMs ?? null, t.isrc?.toUpperCase() ?? null)
      }

      const link = this.db.prepare('INSERT OR REPLACE INTO track_ids (source, source_id, track_id) VALUES (?, ?, ?)')
      for (const [source, sourceId] of Object.entries(t.ids)) if (sourceId) link.run(source, sourceId, id)
      return id
    })
  }

  /** Remplace le contenu d'une playlist importée d'un service. */
  savePlaylist(source: Source, sourceId: string, name: string, tracks: Track[]): number {
    return this.tx(() => {
      const { id } = this.db
        .prepare(
          'INSERT INTO playlists (source, source_id, name) VALUES (?, ?, ?) ON CONFLICT (source, source_id) DO UPDATE SET name = excluded.name RETURNING id',
        )
        .get(source, sourceId, name) as { id: number }
      this.db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(id)
      const add = this.db.prepare('INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?, ?, ?)')
      tracks.forEach((t, i) => add.run(id, i, this.upsertTrack(t)))
      return id
    })
  }

  tracks(): LibraryTrack[] {
    const rows = this.db
      .prepare(
        `SELECT t.*, json_group_object(i.source, i.source_id) AS ids
         FROM tracks t JOIN track_ids i ON i.track_id = t.id
         GROUP BY t.id ORDER BY t.artist COLLATE NOCASE, t.title COLLATE NOCASE`,
      )
      .all() as unknown as TrackRow[]
    return rows.map(toTrack)
  }

  playlists(): LibraryPlaylist[] {
    return this.db
      .prepare(
        `SELECT p.id, p.source, p.source_id AS sourceId, p.name, COUNT(pt.track_id) AS trackCount
         FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
         GROUP BY p.id ORDER BY p.name COLLATE NOCASE`,
      )
      .all() as unknown as LibraryPlaylist[]
  }

  playlistTracks(playlistId: number): LibraryTrack[] {
    const rows = this.db
      .prepare(
        `SELECT t.*, (SELECT json_group_object(source, source_id) FROM track_ids WHERE track_id = t.id) AS ids
         FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = ? ORDER BY pt.position`,
      )
      .all(playlistId) as unknown as TrackRow[]
    return rows.map(toTrack)
  }

  private fill(id: number, album: string | null, durationMs: number | null, isrc: string | null) {
    this.db
      .prepare(
        'UPDATE tracks SET album = coalesce(album, ?), duration_ms = coalesce(duration_ms, ?), isrc = coalesce(isrc, ?) WHERE id = ?',
      )
      .run(album, durationMs, isrc, id)
  }

  // Savepoints : transactions imbriquables (savePlaylist appelle upsertTrack).
  private tx<T>(fn: () => T): T {
    this.db.exec('SAVEPOINT tx')
    try {
      const out = fn()
      this.db.exec('RELEASE tx')
      return out
    } catch (e) {
      this.db.exec('ROLLBACK TO tx; RELEASE tx')
      throw e
    }
  }
}
