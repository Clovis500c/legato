import { fold } from '../../shared/format'
import { primaryArtist } from '../library/filter'
import type { Variety } from './score'

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

/** How sharply Shuffle follows the score, by variety (docs/recommendation.md): higher = the best songs come sooner. */
export const BETA: Record<Variety, number> = { alike: 1.2, balanced: 0.9, adventurous: 0.5 }

/** A song's weight from its z-score: never 0 (everything stays reachable), capped (one song never takes over). */
export const weightOf = (z: number, beta: number) => Math.min(30, Math.max(0.1, Math.exp(beta * z)))

/**
 * Weighted random order without replacement (Efraimidis-Spirakis): each song gets the key ln(u) / w, u in (0, 1], and the
 * songs are sorted by key, the largest first. `zs` = the songs' z-scores; returns indexes.
 */
export function weightedOrder(zs: readonly number[], beta: number, rand: () => number = Math.random): number[] {
  return zs
    .map((z, i) => [Math.log(1 - rand()) / weightOf(z, beta), i] as const)
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i)
}

/**
 * Shuffle shaped by the score: current first, the rest weighted-random by `zs` (the better a song scores, the sooner it
 * tends to come), then an artist never plays twice in a row while someone else is left, and `later` songs (heard lately,
 * rated 1-2) after all the others. Indexes into `artists`.
 */
export function shapedOrder(artists: readonly string[], current: number, later: (i: number) => boolean, zs: readonly number[], beta: number, rand: () => number = Math.random): number[] {
  const key = artists.map((a, i) => fold(primaryArtist(a)) || `#${i}`)
  const has = current >= 0 && current < key.length
  const rest = weightedOrder(zs, beta, rand).filter((i) => i !== current)
  const fresh = rest.filter((i) => !later(i))
  apart(fresh, has ? current : undefined, key)
  const late = rest.filter(later)
  apart(late, fresh.at(-1) ?? (has ? current : undefined), key)
  return has ? [current, ...fresh, ...late] : [...fresh, ...late]
}
