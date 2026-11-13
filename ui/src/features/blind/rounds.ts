import type { LibraryTrack } from '../../shared/api'
import { shuffled } from '../player/radioMix'

/** Songs asked in a game, and what a game needs in the library. */
export const ROUNDS = 10
const MIN_POOL = 8
/** A snippet plays this long; it starts at 30 % of the song (the intro and the outro give too much away). */
export const SNIPPET_MS = 20_000
const CHOICES = 4

export interface Round {
  song: LibraryTrack
  /** The answers shown, the right one among them: library songs, other titles. */
  choices: LibraryTrack[]
}

const key = (t: LibraryTrack) => `${t.title.trim().toLowerCase()}|${t.artist.trim().toLowerCase()}`

/**
 * A game: `rounds` songs of the library that can play and last a minute at least, one version each, each with the right answer
 * among four. Fewer than MIN_POOL songs: no game (the answers would repeat).
 */
export function pickRounds(tracks: LibraryTrack[], rounds = ROUNDS, random: () => number = Math.random): Round[] {
  const seen = new Set<string>()
  const pool = shuffled(
    tracks.filter((t) => t.musicness !== 'notMusic' && (t.durationMs ?? 0) >= 60_000 && (t.ids.youtube || t.ids.local || t.ids.server || t.ids.apple) && !seen.has(key(t)) && seen.add(key(t))),
    random,
  )
  if (pool.length < MIN_POOL) return []
  return pool.slice(0, rounds).map((song) => ({ song, choices: shuffled([song, ...shuffled(pool.filter((t) => t !== song), random).slice(0, CHOICES - 1)], random) }))
}

/** Where the snippet starts: 30 % in, and early enough for the whole snippet. */
export const snippetStart = (durationMs: number): number => Math.max(0, Math.min(Math.round(durationMs * 0.3), durationMs - SNIPPET_MS - 5_000))
