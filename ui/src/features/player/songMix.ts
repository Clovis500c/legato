import type { LibraryTrack } from '../../shared/api'
import type { PickWhy } from './pickWhy'
import { artistOf, lowRated, rankPicks, type Candidate, type Taste, type Variety } from './score'

/**
 * "Start a mix from this song" (docs/recommendation.md): 30 songs, the seed first, of the same style (its artist, genre or decade, or its
 * YouTube Music radio; the whole library when that is thin), scored with the seed's features counting double, then laid out as an arc, not a pile: settle (the most alike),
 * widen (the less alike, a dose of the new), return (alike again). Where both tempos are known a step moves at most `MAX_STEP` bpm and
 * avoids a clashing key; every third song is a favourite when there are some. Pure: the caller gathers candidates and signals, `rand` is
 * injected. Loaded at the click (a chunk of its own), not at launch.
 */
export const MIX_LEN = 30
/** The most the tempo may move between two songs. */
export const MAX_STEP = 12
/** The candidates ranked for the arc (the best of the neighbourhood). */
const POOL = 120
/** A favourite slot looks this far down the ranked songs. */
const FAV_REACH = 8

/** Pitch class of a key's major equivalent (a minor key counts as its relative major): 'Am' and 'C' are 0, 'G' and 'Em' 7. Null: not read. */
function fifths(key: string | null | undefined): number | null {
  const m = key?.trim().match(/^([A-G])([#b♯♭]?)\s*(m|min|minor)?$/i)
  if (!m) return null
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase() as 'C']
  const pc = (base + (/[#♯]/.test(m[2]) ? 1 : /[b♭]/.test(m[2]) ? -1 : 0) + (m[3] ? 3 : 0) + 12) % 12
  return (pc * 7) % 12
}

/** Two keys clash when both are known and sit more than a step apart on the circle of fifths (same, relative and neighbouring keys do not). */
export function keyClash(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = fifths(a)
  const y = fifths(b)
  if (x === null || y === null) return false
  const d = Math.abs(x - y)
  return Math.min(d, 12 - d) > 1
}

const tempoOk = (a: LibraryTrack, b: LibraryTrack) => !a.bpm || !b.bpm || Math.abs(a.bpm - b.bpm) <= MAX_STEP

export interface MixInput {
  seed: LibraryTrack
  candidates: Candidate[]
  taste: Taste
  variety: Variety
  rand: () => number
  library?: LibraryTrack[]
  hour?: number
  /** Filled with each pick's reason, by song id (pickWhy.ts). */
  why?: Map<number, PickWhy>
}

export function mixFromSong({ seed, candidates, taste, variety, rand, library, hour, why }: MixInput): LibraryTrack[] {
  const artist = artistOf(seed)
  const decade = seed.year ? Math.floor(seed.year / 10) : null
  const genre = seed.genre?.toLowerCase()
  const near = (c: Candidate) => c.rank !== undefined || artistOf(c.track) === artist || (!!genre && c.track.genre?.toLowerCase() === genre) || (decade !== null && !!c.track.year && Math.floor(c.track.year / 10) === decade)
  const open = candidates.filter((c) => c.track.id !== seed.id && !lowRated(taste.rating(c.track)) && !taste.never(c.track) && taste.skips(c.track) === 0)
  // Songs without a genre or year (most imports) have no style to share: a thin neighbourhood is widened to the whole library, where the score still favours the seed's own features.
  const styled = open.filter(near)
  const pool = styled.length >= 2 * MIX_LEN ? styled : open
  // The seed twice in the queue: its features count double in the session profile.
  const ranked = rankPicks({ candidates: pool, queue: [seed, seed], index: 1, taste, variety, max: Math.min(POOL, pool.length), rand, library, hour, perArtist: (a) => (a === artist ? 4 : 3), why })
  const fav = (t: LibraryTrack) => taste.rating(t) >= 8 || !!taste.liked?.(t)
  const out = [seed]
  const left = [...ranked]
  while (out.length < MIX_LEN && left.length) {
    const prev = out.at(-1)!
    // Part of the arc by place: settle (the first third), widen (the second, skipping the very best), return.
    const part = Math.floor(((out.length - 1) * 3) / (MIX_LEN - 1))
    const from = part === 1 ? Math.min(15, Math.max(0, left.length - (MIX_LEN - out.length))) : 0
    const window = left.slice(from)
    const favSlot = (out.length + 1) % 3 === 0
    let ok = window.filter((t) => tempoOk(prev, t) && !keyClash(prev.key, t.key))
    if (!ok.length) ok = window.filter((t) => tempoOk(prev, t))
    if (!ok.length) ok = [...window].sort((a, b) => Math.abs((a.bpm ?? prev.bpm ?? 0) - (prev.bpm ?? 0)) - Math.abs((b.bpm ?? prev.bpm ?? 0) - (prev.bpm ?? 0))).slice(0, 1)
    // Only among the next few by rank: further down, a favourite is of another style (the owner, 2026-11-17).
    const pick = (favSlot && ok.slice(0, FAV_REACH).find(fav)) || ok[0]
    out.push(pick)
    left.splice(left.indexOf(pick), 1)
  }
  return out
}
