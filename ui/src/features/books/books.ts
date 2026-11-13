import type { LibraryTrack } from '../../shared/api'
import { pointFor, type Points } from '../player/resumePoints'

/** A file this long is a book whatever its tags say. */
export const BOOK_MS = 2 * 3_600_000
const GENRE = /audio\s?book|spoken|hörbuch|livre audio/i

/** The library's books: files of this PC (or a server) tagged as an audiobook or spoken word, or two hours long and more. Longest first. */
export function pickBooks(tracks: LibraryTrack[]): LibraryTrack[] {
  return tracks
    .filter((t) => (t.ids.local || t.ids.server) && !t.ids.youtube && t.durationMs && (t.durationMs >= BOOK_MS || (GENRE.test(t.genre ?? '') && t.durationMs >= 10 * 60_000)))
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
}

/** Where a book was left (from the resume points, key `t:<id>`): milliseconds and the share of the book, or null when it is not started. */
export function progress(points: Points, t: LibraryTrack): { ms: number; share: number } | null {
  const ms = t.durationMs ? pointFor(points, `t:${t.id}`, t.durationMs) : null
  return ms === null || !t.durationMs ? null : { ms, share: ms / t.durationMs }
}
