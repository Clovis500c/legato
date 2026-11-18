import type { LibraryTrack } from '../../shared/api'
import { fold } from '../../shared/format'
import { primaryArtist } from '../library/filter'
import type { Taste, Variety } from './score'

/** Heard this recently (s): smart shuffle plays the song after the others. */
export const RECENT_S = 24 * 3600

/** Fisher–Yates, in place. */
function mix<T>(xs: T[], rand: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[xs[i], xs[j]] = [xs[j], xs[i]]
  }
  return xs
}

/** Same artist twice in a row (`key` = the artists' keys by index): a song a little further on comes in, where it makes no new pair. In place. */
function apart(out: number[], prev: number | undefined, key: readonly string[]) {
  const same = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && key[a] === key[b]
  const at = (k: number) => (k < 0 ? prev : out[k])
  const clean = (k: number) => !same(at(k - 1), out[k]) && !same(out[k], out[k + 1])
  for (let k = 0; k < out.length; k++) {
    if (!same(at(k - 1), out[k])) continue
    // Further on first, then (at the end of the list, nothing is left ahead) back.
    const near = [...Array.from({ length: Math.min(out.length, k + 50) - k - 1 }, (_, d) => k + 1 + d), ...Array.from({ length: Math.min(k, 50) }, (_, d) => k - 1 - d)]
    for (const m of near) {
      ;[out[k], out[m]] = [out[m], out[k]]
      if (clean(k) && clean(m)) break
      ;[out[k], out[m]] = [out[m], out[k]]
    }
  }
}

/**
 * Smart shuffle (Settings › Playback) over list indexes: current first; each artist's songs spread through the rest
 * (its own random offset, one song every 1/k of the way, a little jitter), then a pass so an artist never plays twice in
 * a row while someone else is left; songs heard lately (`recent`) after all the others, spread the same way.
 */
export function smartOrder(artists: readonly string[], current: number, recent: (i: number) => boolean, rand = Math.random): number[] {
  // Nameless songs: strangers to each other.
  const key = artists.map((a, i) => fold(primaryArtist(a)) || `#${i}`)
  const spread = (xs: number[], prev: number | undefined): number[] => {
    const by = new Map<string, number[]>()
    for (const i of xs) {
      const songs = by.get(key[i])
      if (songs) songs.push(i)
      else by.set(key[i], [i])
    }
    const placed: [number, number][] = []
    for (const songs of by.values()) {
      const step = 1 / songs.length
      const start = rand() * step
      mix(songs, rand).forEach((i, j) => placed.push([start + j * step + (rand() - 0.5) * step * 0.2, i]))
    }
    const out = placed.sort((a, b) => a[0] - b[0]).map(([, i]) => i)
    apart(out, prev, key)
    return out
  }
  const has = current >= 0 && current < key.length
  const rest = key.map((_, i) => i).filter((i) => i !== current)
  const fresh = spread(
    rest.filter((i) => !recent(i)),
    has ? current : undefined,
  )
  const later = spread(rest.filter(recent), fresh.at(-1) ?? (has ? current : undefined))
  return has ? [current, ...fresh, ...later] : [...fresh, ...later]
}

/** How sharply Shuffle follows your marks, by variety (docs/recommendation.md › Shuffle): the power the marks' factor is raised to. */
export const SHARP: Record<Variety, number> = { alike: 1.4, balanced: 1, adventurous: 0.6 }

/** Days a song rests once heard: its weight comes back as 1 - 0.9 e^(-days / REST_DAYS) (heard today 0.1, 3 days ago 0.67, a week 0.91). */
export const REST_DAYS = 3

/**
 * A song's weight in Shuffle, never 0: how rested it is (never heard or long ago: 1) times your marks (a like, a rating, each recent
 * skip, Less), the marks raised to the variety's sharpness. No play count and no artist taste: a playlist rotates instead of
 * opening on the same favourites every time (the owner, 2026-11-17).
 */
export function shuffleWeight(t: LibraryTrack, taste: Taste, now: number, sharp = 1): number {
  const last = taste.lastPlayed?.(t) ?? 0
  const rest = last > 0 ? 1 - 0.9 * Math.exp(-Math.max(0, now - last) / 86_400 / REST_DAYS) : 1
  const rating = taste.rating(t)
  const marks = (taste.liked?.(t) ? 2 : 1) * (rating >= 8 ? 1.8 : rating >= 6 ? 1.3 : 1) * 0.6 ** Math.min(4, taste.skips(t)) * (taste.less?.(t) ? 0.4 : 1)
  return Math.max(0.01, rest * marks ** sharp)
}

/**
 * Weighted random order without replacement (Efraimidis-Spirakis): each song gets the key ln(u) / w, u in (0, 1], and the
 * songs are sorted by key, the largest first. Returns indexes.
 */
export function weightedOrder(weights: readonly number[], rand: () => number = Math.random): number[] {
  return weights
    .map((w, i) => [Math.log(1 - rand()) / w, i] as const)
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i)
}

/** Songs looked at ahead for one whose artist is far enough. */
const LOOK = 60

/**
 * `order` with each artist's songs kept apart: at least `gap` others between two of theirs, about 0.7 of an even spread over
 * `order` (at most 10), so an artist you play a lot comes back now and then, not every other song. Each place takes the first
 * song of the next `LOOK` whose artist is far enough, else the one nearest to it (the end of a list may have nothing else).
 */
function spaced(order: readonly number[], key: readonly string[], prev: number | undefined): number[] {
  const count = new Map<string, number>()
  for (const i of order) count.set(key[i], (count.get(key[i]) ?? 0) + 1)
  const gap = (a: string) => Math.min(10, Math.max(1, Math.floor((0.7 * order.length) / count.get(a)!)))
  const last = new Map<string, number>()
  if (prev !== undefined) last.set(key[prev], -1)
  const taken = new Uint8Array(order.length)
  const out: number[] = []
  let head = 0
  for (let at = 0; at < order.length; at++) {
    while (taken[head]) head++
    let pick = head
    let best = -Infinity
    for (let j = head, seen = 0; j < order.length && seen < LOOK; j++) {
      if (taken[j]) continue
      seen++
      const room = at - (last.get(key[order[j]]) ?? -Infinity) - gap(key[order[j]])
      if (room > best) [best, pick] = [room, j]
      if (room > 0) break
    }
    taken[pick] = 1
    out.push(order[pick])
    last.set(key[order[pick]], at)
  }
  return out
}

/**
 * Shuffle shaped by `weights` (`shuffleWeight`): current first, the rest weighted-random (the more rested and liked, the sooner it
 * tends to come), each artist kept apart, and `later` songs (heard in the last day, rated 1-2) after all the others. Indexes into
 * `artists`.
 */
export function shapedOrder(artists: readonly string[], current: number, later: (i: number) => boolean, weights: readonly number[], rand: () => number = Math.random): number[] {
  const key = artists.map((a, i) => fold(primaryArtist(a)) || `#${i}`)
  const has = current >= 0 && current < key.length
  const rest = weightedOrder(weights, rand).filter((i) => i !== current)
  const fresh = spaced(
    rest.filter((i) => !later(i)),
    key,
    has ? current : undefined,
  )
  const late = spaced(rest.filter(later), key, fresh.at(-1) ?? (has ? current : undefined))
  return has ? [current, ...fresh, ...late] : [...fresh, ...late]
}

/** Songs a skip keeps out of what comes next. */
export const STEER = 10

/**
 * After an early skip (docs/recommendation.md › In the session): the next `STEER` songs after place `at` carry none of the `same`
 * ones (the skipped song's artist), which move just past them in their order; `all` (that artist skipped twice this session): all
 * of theirs go to the end. Songs you queued (`mine`) stay put; every song stays once.
 */
export function steered(order: readonly number[], at: number, same: (i: number) => boolean, mine: ReadonlySet<number>, all: boolean): number[] {
  const out = order.slice(0, at + 1)
  const moved: number[] = []
  let kept = 0
  for (const i of order.slice(at + 1)) {
    if (same(i) && !mine.has(i) && (all || kept < STEER)) moved.push(i)
    else {
      out.push(i)
      if (++kept === STEER && !all) out.push(...moved.splice(0))
    }
  }
  return [...out, ...moved]
}
