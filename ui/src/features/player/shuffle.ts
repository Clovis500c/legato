import { fold } from '../../shared/format'
import { primaryArtist } from '../library/filter'

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
    const same = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && key[a] === key[b]
    const at = (k: number) => (k < 0 ? prev : out[k])
    const clean = (k: number) => !same(at(k - 1), out[k]) && !same(out[k], out[k + 1])
    // Same artist twice in a row: a song a little further on comes in, where it makes no new pair.
    for (let k = 0; k < out.length; k++) {
      if (!same(at(k - 1), out[k])) continue
      for (let m = k + 1; m < Math.min(out.length, k + 50); m++) {
        ;[out[k], out[m]] = [out[m], out[k]]
        if (clean(k) && clean(m)) break
        ;[out[k], out[m]] = [out[m], out[k]]
      }
    }
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
