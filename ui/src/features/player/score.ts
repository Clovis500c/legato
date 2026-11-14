import type { LibraryTrack } from '../../shared/api'
import { primaryArtist } from '../library/filter'

/**
 * The one taste model behind what Up next adds after it runs out (and, next, Shuffle and mixes from a song): docs/recommendation.md.
 * Candidates are scored (the queue's session profile and the library's long profile, what you play, rate and skip), the scores
 * standardised, then picked with a dose of exploration and a greedy diversity re-rank with caps per artist and album.
 * Pure: no store, no network, no `Math.random` (an injected `rand`); the callers gather the candidates and the signals.
 */

export const VARIETIES = ['alike', 'balanced', 'adventurous'] as const
export type Variety = (typeof VARIETIES)[number]

/** Every number of the model, in one table. All first guesses, never heard by ear. */
export const K = {
  /** Feature weights: the main artist, the album, the genre, the decade, the tempo (by 10 bpm), the key. */
  feature: { artist: 3, album: 1.5, genre: 2, decade: 1, tempo: 0.8, key: 0.8 },
  /** Share of the slots that go to explore picks (a floor above 0 whatever the setting). */
  dose: { alike: 0.1, balanced: 0.2, adventurous: 0.35 } as Record<Variety, number>,
  /** The queue's weight in the profile against the long profile (when there is one). */
  session: 0.7,
  /** One song adds at most this many plays' worth to the long profile; a feature's weight saturates (tanh) at this scale. */
  songCap: 3,
  longScale: 20,
  sessionScale: 4,
  /** Affinity (0..1 over the candidates) is brought to this scale so the points below stay meaningful beside it. */
  affinity: 8,
  logPlays: 0.4,
  rating: { high: 6, good: 2.5 },
  like: 3,
  /** A skip in the last 30 days costs this much, up to `skipCap` in all. */
  skip: 1.5,
  skipCap: 6,
  /** Less: the positive score is cut to this share. Heard in the last 20 h: the same, with `coolFactor`. */
  less: 0.3,
  coolHours: 20,
  coolFactor: 0.6,
  /** A radio's answer: the first song counts this much, the later ones less. */
  radio: 1.5,
  /** Diversity: score minus this x the similarity to each of the last 4 picks. */
  mmr: 0.3,
  /** The hours a song was played at (last 90 days) near now add up to `bonus` of its affinity, once there are `minPlays` plays of history. */
  timeOfDay: { bonus: 0.1, span: 2, minPlays: 100 },
  /** Caps in any 10 picks. */
  perArtist: 2,
  perAlbum: 2,
  window: 10,
  /** An explore pick: middle affinity (z between these), few plays. */
  explore: { low: -0.5, high: 1.2, plays: 2 },
} as const

/** What the app knows of a song's taste: all but the first four are optional (absent = none). */
export interface Taste {
  /** 0-10 rating in half stars, 0 = none. */
  rating: (t: LibraryTrack) => number
  /** Listens (finished or 30 s heard). */
  plays: (t: LibraryTrack) => number
  /** Skips in the last 30 days. */
  skips: (t: LibraryTrack) => number
  /** "Never in mixes". */
  never: (t: LibraryTrack) => boolean
  less?: (t: LibraryTrack) => boolean
  liked?: (t: LibraryTrack) => boolean
  /** Sum of the plays' weights, decayed (30-day half-life): the long profile. */
  decayed?: (t: LibraryTrack) => number
  /** Unix s of the last listen, 0 = never. */
  lastPlayed?: (t: LibraryTrack) => number
  /** Bit h = played at local hour h in the last 90 days. */
  hours?: (t: LibraryTrack) => number
}

/** The hours within `K.timeOfDay.span` of `hour` (0-23), as a bit mask, wrapping midnight. */
export function hourWindow(hour: number): number {
  let m = 0
  for (let d = -K.timeOfDay.span; d <= K.timeOfDay.span; d++) m |= 1 << (((hour + d) % 24 + 24) % 24)
  return m
}

const bits = (n: number) => {
  let c = 0
  for (; n; n &= n - 1) c++
  return c
}

/** A song to pick from: `rank` = its place in a radio's answer (0 first), none for a song of the library. */
export interface Candidate {
  track: LibraryTrack
  rank?: number
}

/** The features that make two songs alike: the main artist, the album, the genre, the decade, the tempo (by 10), the key. */
export function featuresOf(t: LibraryTrack): [string, number][] {
  const hit = cache.get(t)
  if (hit) return hit
  const f = computeFeatures(t)
  cache.set(t, f)
  return f
}

/** By track object: the store replaces a song it edits, and a 10 000-song pass asks each one several times. */
const cache = new WeakMap<LibraryTrack, [string, number][]>()

function computeFeatures(t: LibraryTrack): [string, number][] {
  const f: [string, number][] = [[`a:${primaryArtist(t.artist).toLowerCase()}`, K.feature.artist]]
  if (t.album) f.push([`al:${t.album.toLowerCase()}`, K.feature.album])
  if (t.genre) f.push([`g:${t.genre.toLowerCase()}`, K.feature.genre])
  if (t.year) f.push([`y:${Math.floor(t.year / 10)}`, K.feature.decade])
  if (t.bpm) f.push([`b:${Math.round(t.bpm / 10)}`, K.feature.tempo])
  if (t.key) f.push([`k:${t.key.toLowerCase()}`, K.feature.key])
  return f
}

const lowRated = (rating: number) => rating >= 1 && rating <= 2
const artistOf = (t: LibraryTrack) => primaryArtist(t.artist).toLowerCase()

/** How much a song of the queue counts: the last ones played most (0.8 less each step back), queued ones half as much, a high rating doubles it, a low one nearly drops it. */
function queueWeight(distance: number, rating: number): number {
  const base = distance <= 0 ? 0.8 ** -distance : 0.5 * 0.8 ** distance
  return base * (rating >= 8 ? 2 : rating >= 6 ? 1.3 : lowRated(rating) ? 0.2 : 1)
}

/** Feature → weight in 0..1 (tanh: it saturates), from the whole queue around `index`: the session profile. */
export function profileOf(queue: LibraryTrack[], index: number, taste: Pick<Taste, 'rating'>): Map<string, number> {
  const raw = new Map<string, number>()
  queue.forEach((t, i) => {
    const w = queueWeight(i - index, taste.rating(t))
    for (const [f, fw] of featuresOf(t)) raw.set(f, (raw.get(f) ?? 0) + w * fw)
  })
  return saturate(raw, K.sessionScale)
}

/** The long profile: every library song's decayed plays (one song at most `songCap`), saturated so no feature, and no one liked song, takes over. */
export function longProfile(tracks: LibraryTrack[], decayed: (t: LibraryTrack) => number): Map<string, number> {
  const raw = new Map<string, number>()
  for (const t of tracks) {
    const w = Math.min(K.songCap, decayed(t))
    if (w <= 0) continue
    for (const [f, fw] of featuresOf(t)) raw.set(f, (raw.get(f) ?? 0) + w * fw)
  }
  return saturate(raw, K.longScale)
}

function saturate(raw: Map<string, number>, scale: number): Map<string, number> {
  return new Map([...raw].map(([f, v]) => [f, Math.tanh(v / scale)]))
}

/** How much of the song's features the profiles hold: 0..~3 (the feature weights over 3). */
function affinityOf(features: [string, number][], session: Map<string, number>, long: Map<string, number> | null): number {
  let s = 0
  for (const [f, fw] of features) s += (fw / 3) * (long ? K.session * (session.get(f) ?? 0) + (1 - K.session) * (long.get(f) ?? 0) : (session.get(f) ?? 0))
  return s
}

/** Everything about a candidate the picks need. */
interface Scored {
  c: Candidate
  /** Its features, its main artist (lower case), computed once. */
  f: [string, number][]
  artist: string
  /** Standardised score. */
  z: number
  /** Standardised affinity alone (to find the explore picks). */
  za: number
}

function standardise(xs: number[]): number[] {
  if (!xs.length) return []
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
  return xs.map((x) => (sd > 1e-9 ? (x - mean) / sd : 0))
}

/** Score = affinity + preference (plays, rating, like) - skips, cut for Less and for what was just heard, then standardised over the candidates. */
export function scoreAll(candidates: Candidate[], session: Map<string, number>, long: Map<string, number> | null, taste: Taste, now: number, hour: number | null = null): Scored[] {
  const feats = candidates.map((c) => featuresOf(c.track))
  const aff = feats.map((f) => affinityOf(f, session, long))
  // The hours the songs were played at: up to `bonus` more affinity for the ones played around this hour.
  const win = hour === null || !taste.hours ? 0 : hourWindow(hour)
  if (win) candidates.forEach((c, i) => (aff[i] *= 1 + (K.timeOfDay.bonus * bits((taste.hours?.(c.track) ?? 0) & win)) / (2 * K.timeOfDay.span + 1)))
  let top = 0
  for (const a of aff) if (a > top) top = a
  const raw = candidates.map((c, i) => {
    const t = c.track
    const rating = taste.rating(t)
    let s = top > 0 ? (aff[i] / top) * K.affinity : 0
    s += K.logPlays * Math.log1p(taste.plays(t)) + (rating >= 8 ? K.rating.high : rating >= 6 ? K.rating.good : 0) + (taste.liked?.(t) ? K.like : 0)
    s -= Math.min(K.skipCap, K.skip * taste.skips(t))
    if (c.rank !== undefined) s += K.radio / (1 + c.rank * 0.2)
    if (s > 0 && taste.less?.(t)) s *= K.less
    const last = taste.lastPlayed?.(t) ?? 0
    if (s > 0 && last > 0 && now - last < K.coolHours * 3600) s *= K.coolFactor
    return s
  })
  const z = standardise(raw)
  const za = standardise(aff)
  return candidates.map((c, i) => ({ c, f: feats[i], artist: artistOf(c.track), z: z[i], za: za[i] }))
}

/** How many of `max` slots go to explore picks: the dose of the variety, never none from 5 slots up. */
export function exploreSlots(variety: Variety, max: number): number {
  const n = Math.round(K.dose[variety] * max)
  return max >= 5 ? Math.max(1, n) : n
}

/** Songs kept for the picks: this many by score and as many explore candidates. */
const KEEP = 300

/** An explore candidate: middle affinity, few plays. */
const isMid = (x: Scored, taste: Taste) => x.za >= K.explore.low && x.za <= K.explore.high && taste.plays(x.c.track) <= K.explore.plays

/** Weighted draw: index into `weights` (all > 0). */
function draw(weights: number[], rand: () => number): number {
  let r = rand() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) < 0) return i
  return weights.length - 1
}

/** Shared weight of a song's features with a pick's (`keys`), over its own. */
function similarity(a: [string, number][], keys: Set<string>): number {
  let shared = 0
  let total = 0
  for (const [f, w] of a) {
    total += w
    if (keys.has(f)) shared += w
  }
  return total ? shared / total : 0
}

export interface RankInput {
  candidates: Candidate[]
  queue: LibraryTrack[]
  index: number
  taste: Taste
  variety: Variety
  max: number
  rand: () => number
  /** The library's songs, for the long profile (none: the queue alone). */
  library?: LibraryTrack[]
  /** Unix s. */
  now?: number
  /** Local hour 0-23 for the time-of-day signal; none = off (callers give it only past `K.timeOfDay.minPlays` plays). */
  hour?: number
}

/**
 * The next `max` songs: nothing already queued, nothing rated 1-2 or "Never in mixes"; the best by score, except the explore slots
 * (weighted draws among middle-affinity songs with few plays); each pick minus its similarity to the last four, with caps of
 * `perArtist` songs per artist and `perAlbum` per album in any `window` picks, and never the same artist twice in a row while
 * another is left (the caps give way last-first when nothing else is left).
 */
export function rankPicks({ candidates, queue, index, taste, variety, max, rand, library, now = Date.now() / 1000, hour }: RankInput): LibraryTrack[] {
  const inQueue = new Set(queue.map((t) => t.id))
  const seen = new Set<number>()
  const eligible = candidates.filter((c) => !inQueue.has(c.track.id) && !seen.has(c.track.id) && !!seen.add(c.track.id) && !lowRated(taste.rating(c.track)) && !taste.never(c.track))
  const decayed = taste.decayed
  const long = library && decayed ? longProfile(library, decayed) : null
  let pool = scoreAll(eligible, profileOf(queue, index, taste), long && long.size ? long : null, taste, now, hour ?? null)
  // Only the best by score and some explore candidates can be picked: the rest of a 10 000-song library is not walked at each pick.
  const byZ = [...pool].sort((a, b) => b.z - a.z)
  const mids = byZ.slice(KEEP).filter((x) => isMid(x, taste)).slice(0, KEEP)
  pool = [...byZ.slice(0, KEEP), ...mids]
  const slots = exploreSlots(variety, max)
  // The explore slots are spread through the picks, never the first.
  const explore = new Set(Array.from({ length: slots }, (_, j) => Math.round(((j + 1) * max) / (slots + 1))))
  const recent = queue.slice(Math.max(0, index - 1), index + 1)
  const out: LibraryTrack[] = []
  while (out.length < max && pool.length) {
    const lastN = out.slice(-(K.window - 1))
    const lastArtists = lastN.map(artistOf)
    const chosenTail = out.slice(-4)
    const prev = out.at(-1) ?? recent.at(-1)
    const prevArtist = prev && artistOf(prev)
    const fits = (x: Scored, rules: number) => {
      const t = x.c.track
      if (rules >= 1 && prev && prevArtist === x.artist) return false
      if (rules >= 2 && lastArtists.filter((a) => a === x.artist).length >= K.perArtist) return false
      return !(rules >= 3 && !!t.album && lastN.filter((o) => o.album === t.album).length >= K.perAlbum)
    }
    let open = pool
    for (const rules of [3, 2, 1, 0]) {
      open = pool.filter((x) => fits(x, rules))
      if (open.length) break
    }
    let chosen: Scored
    const mid = explore.has(out.length) ? open.filter((x) => isMid(x, taste)) : []
    if (mid.length) {
      chosen = mid[draw(mid.map((x) => Math.max(0.1, 1 + x.za)), rand)]
    } else {
      const tail = chosenTail.map((o) => new Set(featuresOf(o).map(([f]) => f)))
      const adj = (x: Scored) => x.z - K.mmr * tail.reduce((s, keys) => s + similarity(x.f, keys), 0)
      chosen = open.reduce((best, x) => (adj(x) > adj(best) ? x : best))
    }
    out.push(chosen.c.track)
    pool = pool.filter((x) => x !== chosen)
  }
  return out
}

/** The z-scores of the songs of `list` against the whole `library`'s long profile (Shuffle: no queue yet, so no session profile). */
export function libraryScores(list: LibraryTrack[], library: LibraryTrack[], taste: Taste, now = Date.now() / 1000): number[] {
  const long = taste.decayed ? longProfile(library, taste.decayed) : null
  return scoreAll(list.map((track) => ({ track })), new Map(), long && long.size ? long : null, taste, now).map((x) => x.z)
}
