import type { LibraryTrack, Play } from '../../shared/api'
import { primaryArtist } from '../library/filter'

export type Period = '4w' | '6m' | 'year' | 'all'

/** First instant of a period (local time), ms. All = 0. */
export function periodStart(period: Period, now = new Date()): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  if (period === '4w') d.setDate(d.getDate() - 27)
  else if (period === '6m') d.setMonth(d.getMonth() - 6)
  else if (period === 'year') d.setMonth(0, 1)
  else return 0
  return d.getTime()
}

/** A play counts as a listen like the library's play stats: finished, or 30 s heard. */
const counts = (p: Play) => p.completed || p.listenedMs >= 30_000

export interface Ranked<T> {
  item: T
  listens: number
  ms: number
}

export interface Stats {
  ms: number
  listens: number
  songs: number
  artists: number
  topSongs: Ranked<LibraryTrack>[]
  topArtists: Ranked<{ name: string; cover: LibraryTrack }>[]
  topAlbums: Ranked<{ album: string; artist: string; cover: LibraryTrack }>[]
  /** Time heard by hour of day (0–23) and weekday (0 = Monday), ms. */
  byHour: number[]
  byWeekday: number[]
  /** Time heard per bucket: days (4 weeks), weeks (6 months), else months; `starts` = each bucket's start, ms. */
  timeline: { starts: number[]; ms: number[] }
  /** Days in a row with listening: the longest in the period, and the one running today. */
  bestStreak: number
  streak: number
  /** Artists first heard in this period (none before it in the history). */
  newArtists: number
}

const dayKey = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function buckets(period: Period, from: number, first: number, now: Date): number[] {
  const starts: number[] = []
  const d = new Date(period === 'all' ? first : from)
  d.setHours(0, 0, 0, 0)
  if (period === '4w') {
    for (; d <= now; d.setDate(d.getDate() + 1)) starts.push(d.getTime())
  } else if (period === '6m') {
    // Weeks from Monday.
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    for (; d <= now; d.setDate(d.getDate() + 7)) starts.push(d.getTime())
  } else {
    d.setDate(1)
    for (; d <= now; d.setMonth(d.getMonth() + 1)) starts.push(d.getTime())
  }
  return starts
}

/** Listening stats of a period from the whole play history (oldest first) and the library. */
export function statsOf(history: Play[], tracks: LibraryTrack[], period: Period, now = new Date()): Stats {
  const from = periodStart(period, now)
  const byId = new Map(tracks.map((t) => [t.id, t]))
  const songs = new Map<number, Ranked<LibraryTrack>>()
  const artists = new Map<string, Ranked<{ name: string; cover: LibraryTrack }>>()
  const albums = new Map<string, Ranked<{ album: string; artist: string; cover: LibraryTrack }>>()
  const seenBefore = new Set<string>()
  const byHour = Array(24).fill(0) as number[]
  const byWeekday = Array(7).fill(0) as number[]
  const days = new Set<number>()
  let ms = 0
  let listens = 0
  const kept: Play[] = []
  for (const p of history) {
    const at = p.startedAt * 1000
    const t = byId.get(p.trackId)
    if (at < from) {
      if (t) seenBefore.add(primaryArtist(t.artist))
      continue
    }
    kept.push(p)
    ms += p.listenedMs
    const listen = counts(p)
    if (listen) listens++
    const d = new Date(at)
    byHour[d.getHours()] += p.listenedMs
    byWeekday[(d.getDay() + 6) % 7] += p.listenedMs
    if (p.listenedMs > 0) days.add(dayKey(at))
    if (!t) continue
    const add = <T,>(m: Map<string | number, Ranked<T>>, key: string | number, item: T) => {
      const r = m.get(key) ?? { item, listens: 0, ms: 0 }
      r.ms += p.listenedMs
      if (listen) r.listens++
      m.set(key, r)
      return r
    }
    add(songs as Map<string | number, Ranked<LibraryTrack>>, t.id, t)
    const name = primaryArtist(t.artist)
    const a = add(artists as Map<string | number, Ranked<{ name: string; cover: LibraryTrack }>>, name, { name, cover: t })
    if (!a.item.cover.art && t.art) a.item.cover = t
    if (t.album) {
      const b = add(albums as Map<string | number, Ranked<{ album: string; artist: string; cover: LibraryTrack }>>, `${t.album}\u0000${name}`, { album: t.album, artist: name, cover: t })
      if (!b.item.cover.art && t.art) b.item.cover = t
    }
  }
  const rank = <T,>(m: Map<unknown, Ranked<T>>, n: number) => [...m.values()].sort((a, b) => b.listens - a.listens || b.ms - a.ms).slice(0, n)
  // Streaks: consecutive local days.
  const sorted = [...days].sort((a, b) => a - b)
  let best = 0
  let run = 0
  let prev = 0
  for (const day of sorted) {
    const next = new Date(prev)
    next.setDate(next.getDate() + 1)
    run = prev && next.getTime() === day ? run + 1 : 1
    best = Math.max(best, run)
    prev = day
  }
  let streak = 0
  const cursor = new Date(dayKey(now.getTime()))
  // Nothing yet today: yesterday's run still counts.
  if (!days.has(cursor.getTime())) cursor.setDate(cursor.getDate() - 1)
  while (days.has(cursor.getTime())) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  const starts = buckets(period, from, kept[0] ? kept[0].startedAt * 1000 : now.getTime(), now)
  const timeline = Array(starts.length).fill(0) as number[]
  for (const p of kept) {
    const i = starts.findLastIndex((s) => p.startedAt * 1000 >= s)
    if (i >= 0) timeline[i] += p.listenedMs
  }
  return {
    ms,
    listens,
    songs: songs.size,
    artists: artists.size,
    topSongs: rank(songs, 10),
    topArtists: rank(artists, 10).sort((a, b) => b.ms - a.ms),
    topAlbums: rank(albums, 6),
    byHour,
    byWeekday,
    timeline: { starts, ms: timeline },
    bestStreak: best,
    streak,
    newArtists: [...artists.keys()].filter((a) => !seenBefore.has(a)).length,
  }
}
