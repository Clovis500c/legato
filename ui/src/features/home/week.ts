import type { LibraryTrack, Play } from '../../shared/api'
import { primaryArtist } from '../library/filter'

/** Home's Your week: the last 7 days of listening, from the play history. */
export interface Week {
  /** Start of each day (local midnight), oldest first, today last. */
  starts: Date[]
  /** Time heard per day, ms. */
  days: number[]
  total: number
  /** The 7 days before. */
  before: number
  topArtist?: { name: string; ms: number; cover: LibraryTrack }
  topSong?: { track: LibraryTrack; plays: number }
}

/** A play counts as a listen like the library's play stats: finished, or 30 s heard. */
const counts = (p: Play) => p.completed || p.listenedMs >= 30_000

export function weekOf(plays: Play[], tracks: LibraryTrack[], now = new Date()): Week {
  const starts = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    // setDate keeps local midnight across a clock change.
    d.setDate(d.getDate() - (6 - i))
    return d
  })
  const first = starts[0].getTime()
  const weekBefore = new Date(starts[0])
  weekBefore.setDate(weekBefore.getDate() - 7)
  const byId = new Map(tracks.map((t) => [t.id, t]))
  const days = Array(7).fill(0) as number[]
  let before = 0
  const artistMs = new Map<string, { ms: number; cover: LibraryTrack }>()
  const songPlays = new Map<number, { n: number; ms: number }>()
  for (const p of plays) {
    const at = p.startedAt * 1000
    if (at < first) {
      if (at >= weekBefore.getTime()) before += p.listenedMs
      continue
    }
    const day = starts.findLastIndex((s) => at >= s.getTime())
    if (day < 0) continue
    days[day] += p.listenedMs
    const t = byId.get(p.trackId)
    if (!t) continue
    const name = primaryArtist(t.artist)
    const a = artistMs.get(name) ?? { ms: 0, cover: t }
    a.ms += p.listenedMs
    if (!a.cover.art && t.art) a.cover = t
    artistMs.set(name, a)
    if (counts(p)) {
      const s = songPlays.get(t.id) ?? { n: 0, ms: 0 }
      songPlays.set(t.id, { n: s.n + 1, ms: s.ms + p.listenedMs })
    }
  }
  const artist = [...artistMs].sort((a, b) => b[1].ms - a[1].ms)[0]
  const song = [...songPlays].sort((a, b) => b[1].n - a[1].n || b[1].ms - a[1].ms)[0]
  return {
    starts,
    days,
    total: days.reduce((s, d) => s + d, 0),
    before,
    topArtist: artist && { name: artist[0], ms: artist[1].ms, cover: artist[1].cover },
    topSong: song && { track: byId.get(song[0])!, plays: song[1].n },
  }
}
