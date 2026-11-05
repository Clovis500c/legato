import type { LibraryTrack, Play } from '../../shared/api'
import { statsOf, type Ranked, type Stats } from './stats'

/** A recap: a whole year, or one of its months (0 = January). */
export interface RecapSpan {
  year: number
  month: number | null
}

/** Listening a span needs for a recap: an hour of music. */
export const RECAP_MIN_MS = 60 * 60_000

/** [from, to) of a span, local time, ms. */
export function spanRange({ year, month }: RecapSpan): [number, number] {
  return month === null ? [new Date(year, 0, 1).getTime(), new Date(year + 1, 0, 1).getTime()] : [new Date(year, month, 1).getTime(), new Date(year, month + 1, 1).getTime()]
}

/** Spans with enough listening for a recap, newest first: each year, then its months. */
export function recapSpans(history: Play[]): RecapSpan[] {
  const heard = new Map<string, number>()
  for (const p of history) {
    const d = new Date(p.startedAt * 1000)
    for (const key of [`${d.getFullYear()}`, `${d.getFullYear()}-${d.getMonth()}`]) heard.set(key, (heard.get(key) ?? 0) + p.listenedMs)
  }
  // The year first, then its months from the last.
  const order = (s: RecapSpan) => (s.month === null ? -1 : 11 - s.month)
  return [...heard]
    .filter(([, ms]) => ms >= RECAP_MIN_MS)
    .map(([key]) => {
      const [year, month] = key.split('-').map(Number)
      return { year, month: month ?? null }
    })
    .sort((a, b) => b.year - a.year || order(a) - order(b))
}

export type Personality = 'onRepeat' | 'loyal' | 'explorer' | 'nightOwl' | 'earlyBird' | 'eclectic'

export interface Recap {
  span: RecapSpan
  stats: Stats
  /** A year's months: each one's most played song, null when none was heard through. Empty for a month. */
  months: (Ranked<LibraryTrack> | null)[]
  /** Hour of the day (0–23) heard the most. */
  topHour: number
  personality: Personality
  /** The share behind it (0–1): the top song's listens, the top artist's time, new artists, night or morning time.
   *  Eclectic: the top artist's time. */
  share: number
}

const NIGHT = [22, 23, 0, 1, 2, 3]
const MORNING = [5, 6, 7, 8]

/** A listening personality from simple rules, the first that fits. */
export function personalityOf(s: Stats): { personality: Personality; share: number } {
  if (!s.ms) return { personality: 'eclectic', share: 0 }
  const part = (hours: number[]) => hours.reduce((a, h) => a + s.byHour[h], 0) / s.ms
  const song = s.topSongs[0]
  const artist = s.topArtists[0] ? s.topArtists[0].ms / s.ms : 0
  if (song && s.listens >= 20 && song.listens / s.listens >= 0.1) return { personality: 'onRepeat', share: song.listens / s.listens }
  if (artist >= 0.25) return { personality: 'loyal', share: artist }
  if (s.artists >= 10 && s.newArtists / s.artists >= 0.5) return { personality: 'explorer', share: s.newArtists / s.artists }
  if (part(NIGHT) >= 0.35) return { personality: 'nightOwl', share: part(NIGHT) }
  if (part(MORNING) >= 0.35) return { personality: 'earlyBird', share: part(MORNING) }
  return { personality: 'eclectic', share: artist }
}

/** A span's recap from the whole play history (oldest first): Stats' own numbers over its dates. */
export function recapOf(history: Play[], tracks: LibraryTrack[], span: RecapSpan): Recap {
  const [from, to] = spanRange(span)
  const stats = statsOf(history, tracks, 'all', new Date(to - 1), [from, to])
  const year = span.month === null ? history.filter((p) => p.startedAt * 1000 >= from && p.startedAt * 1000 < to) : []
  const months =
    span.month === null
      ? Array.from({ length: 12 }, (_, month) => {
          const [a, b] = spanRange({ year: span.year, month })
          const top = statsOf(year, tracks, 'all', new Date(b - 1), [a, b]).topSongs[0]
          return top?.listens ? top : null
        })
      : []
  return { span, stats, months, topHour: stats.byHour.indexOf(Math.max(...stats.byHour)), ...personalityOf(stats) }
}
