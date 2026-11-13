import type { LibraryTrack } from '../../shared/api'
import { shuffled } from './radioMix'

/** Songs a session needs at least. */
const MIN_SONGS = 8
const MAX_SONGS = 100
/** A workout is 120 BPM and above (the tempo tag of local files, like the Mixes page's "Up tempo"). */
const WORKOUT_BPM = 120
/** Longer than this is a mix or a set, not a song to run to. */
const LONG_MS = 10 * 60_000

export type SessionKind = 'focus' | 'workout'
type Stats = Record<number, [number, number, number?]>

/** Minutes typed for a session: 5 to 240, else none. */
export function parseMinutes(text: string): number | null {
  const n = Math.round(Number(text.trim().replace(',', '.')))
  return Number.isFinite(n) && n >= 5 && n <= 240 ? n : null
}

/**
 * The songs of a session, in a random order. Focus: the songs you have played, the most played first. Workout: the local files
 * tagged 120 BPM or more. Never explicit when `hideExplicit`, never over 10 minutes. Under MIN_SONGS: none (a session of a
 * handful of songs would repeat).
 */
export function sessionSongs(kind: SessionKind, tracks: LibraryTrack[], stats: Stats, hideExplicit: boolean, random: () => number = Math.random): LibraryTrack[] {
  const ok = (t: LibraryTrack) => !(hideExplicit && t.explicit) && (t.durationMs ?? 0) < LONG_MS
  const plays = (t: LibraryTrack) => stats[t.id]?.[0] ?? 0
  const pool = kind === 'workout' ? tracks.filter((t) => ok(t) && (t.bpm ?? 0) >= WORKOUT_BPM) : tracks.filter((t) => ok(t) && plays(t) > 0).sort((a, b) => plays(b) - plays(a)).slice(0, MAX_SONGS)
  return pool.length < MIN_SONGS ? [] : shuffled(pool.slice(0, MAX_SONGS), random)
}

