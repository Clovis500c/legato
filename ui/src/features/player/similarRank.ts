import type { LibraryTrack } from '../../shared/api'
import { primaryArtist } from '../library/filter'

/**
 * "Then, similar songs" ranked by the whole queue, not the last song alone (plan-v2, the owner 2026-11-14): a taste
 * profile from what played and what is queued (the recent weigh more), what you rated high or low, then candidates scored
 * against it, with diversity (never one artist three times running, one in three or so picked from the middle of the
 * ranking, not the top). Pure: no network, no store; radio.ts gathers the candidates.
 */

export const VARIETIES = ['alike', 'balanced', 'adventurous'] as const
export type Variety = (typeof VARIETIES)[number]

/** Share of the picks taken from the middle of the ranking (adjacent songs) instead of its top. */
const ADJACENT: Record<Variety, number> = { alike: 0.1, balanced: 0.3, adventurous: 0.5 }

/** What the app knows of your taste: a 0-10 rating (0 = none) and a play count. */
export interface Taste {
  rating: (t: LibraryTrack) => number
  plays: (t: LibraryTrack) => number
}

/** A song to pick from: `rank` = its place in a radio's answer (0 first), none for a song of the library. */
export interface Candidate {
  track: LibraryTrack
  rank?: number
}

const FEATURE_WEIGHT = { artist: 3, album: 1.5, genre: 2, decade: 1, tempo: 0.8, key: 0.8 }

/** The features that make two songs alike: the main artist, the album, the genre, the decade, the tempo (by 10), the key. */
export function featuresOf(t: LibraryTrack): [string, number][] {
  const f: [string, number][] = [[`a:${primaryArtist(t.artist).toLowerCase()}`, FEATURE_WEIGHT.artist]]
  if (t.album) f.push([`al:${t.album.toLowerCase()}`, FEATURE_WEIGHT.album])
  if (t.genre) f.push([`g:${t.genre.toLowerCase()}`, FEATURE_WEIGHT.genre])
  if (t.year) f.push([`y:${Math.floor(t.year / 10)}`, FEATURE_WEIGHT.decade])
  if (t.bpm) f.push([`b:${Math.round(t.bpm / 10)}`, FEATURE_WEIGHT.tempo])
  if (t.key) f.push([`k:${t.key.toLowerCase()}`, FEATURE_WEIGHT.key])
  return f
}

/** How much a song of the queue counts: the last ones played most (0.8 less each step back), queued ones half as much, a high rating doubles it, a low one nearly drops it. */
function queueWeight(distance: number, rating: number): number {
  const base = distance <= 0 ? 0.8 ** -distance : 0.5 * 0.8 ** distance
  return base * (rating >= 8 ? 2 : rating >= 6 ? 1.3 : rating >= 1 && rating <= 2 ? 0.2 : 1)
}

/** Feature → weight, from the whole queue around `index`. */
export function profileOf(queue: LibraryTrack[], index: number, taste: Taste): Map<string, number> {
  const profile = new Map<string, number>()
  queue.forEach((t, i) => {
    const w = queueWeight(i - index, taste.rating(t))
    for (const [f, fw] of featuresOf(t)) profile.set(f, (profile.get(f) ?? 0) + w * fw)
  })
  return profile
}

/** A song's score against the profile: shared features, what you play and rate, a radio's own order. A low rating (1-2: skipped, disliked) sinks it. */
export function scoreOf(c: Candidate, profile: Map<string, number>, taste: Taste): number {
  let s = 0
  for (const [f, fw] of featuresOf(c.track)) s += (profile.get(f) ?? 0) * (fw / 3)
  const rating = taste.rating(c.track)
  s += 0.4 * Math.log1p(taste.plays(c.track)) + (rating >= 8 ? 6 : rating >= 6 ? 2.5 : 0) - (rating >= 1 && rating <= 2 ? 50 : 0)
  if (c.rank !== undefined) s += 2.5 / (1 + c.rank * 0.2)
  return s
}

const lowRated = (rating: number) => rating >= 1 && rating <= 2
const artistOf = (t: LibraryTrack) => primaryArtist(t.artist).toLowerCase()

/**
 * The next `max` songs: candidates (none already in the queue) ranked, taken one by one with a penalty on the artist of
 * the last two songs and on the album of the last one, every n-th one from the middle of the ranking instead of its top
 * (`variety`).
 */
export function pickSimilar(candidates: Candidate[], queue: LibraryTrack[], index: number, taste: Taste, variety: Variety, max: number): LibraryTrack[] {
  const profile = profileOf(queue, index, taste)
  const inQueue = new Set(queue.map((t) => t.id))
  const seen = new Set<number>()
  let pool = candidates
    // Rated 1-2: never, whatever else it shares with the queue (a score alone can climb back over any penalty).
    .filter((c) => !inQueue.has(c.track.id) && !seen.has(c.track.id) && !!seen.add(c.track.id) && !lowRated(taste.rating(c.track)))
    .map((c) => ({ c, s: scoreOf(c, profile, taste) }))
    .filter((x) => x.s > -10)
  const recent = queue.slice(Math.max(0, index - 1), index + 1)
  const out: LibraryTrack[] = []
  const f = ADJACENT[variety]
  while (out.length < max && pool.length) {
    const tail = [...recent, ...out].slice(-2)
    const adj = (x: (typeof pool)[number]) => x.s - 4 * tail.filter((t) => artistOf(t) === artistOf(x.c.track)).length - (tail.at(-1)?.album && tail.at(-1)!.album === x.c.track.album ? 2 : 0)
    // The last two by one artist: a third is out, not just lower (unless nothing else is left).
    const run = tail.length === 2 && artistOf(tail[0]) === artistOf(tail[1]) ? artistOf(tail[0]) : null
    const all = pool.map((x) => ({ x, v: adj(x) })).sort((a, b) => b.v - a.v)
    const others = run === null ? all : all.filter(({ x }) => artistOf(x.c.track) !== run)
    const ranked = others.length ? others : all
    const k = out.length
    // Slot k is an adjacent one when it crosses a multiple of 1/f: the middle third of what is left.
    const adjacent = Math.floor((k + 1) * f) > Math.floor(k * f)
    const at = adjacent ? Math.min(ranked.length - 1, Math.floor(ranked.length * 0.35)) : 0
    const chosen = ranked[at].x
    out.push(chosen.c.track)
    pool = pool.filter((x) => x !== chosen)
  }
  return out
}
