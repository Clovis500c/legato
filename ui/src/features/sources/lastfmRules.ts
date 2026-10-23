import type { LibraryTrack, Scrobble } from '../../shared/api'

/** Last.fm's rule: longer than 30 s, heard for half of it or 4 minutes (connectors lastfm.rs `counts`). */
export function scrobbles(durationMs: number | null, listenedMs: number): boolean {
  return durationMs ? durationMs > 30_000 && listenedMs >= Math.min(durationMs / 2, 240_000) : listenedMs >= 240_000
}

export const toScrobble = (t: Pick<LibraryTrack, 'artist' | 'title' | 'album' | 'durationMs'>, timestamp: number): Scrobble => ({
  artist: t.artist,
  track: t.title,
  album: t.album,
  durationS: t.durationMs ? Math.round(t.durationMs / 1000) : null,
  timestamp,
})
