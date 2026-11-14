import { hueOf } from '../../shared/hue'
import type { LibraryTrack } from '../../shared/api'
import { trackArt } from '../../shared/art'

/** Pure side of the playlist banners (Steam's "Browse by category" look: tilted strips of covers under a colour wash and the name). No `window`: imported by tests. */

/** Covers in a tile: enough strips to read as a collage, few enough to stay recognisable. */
export const STRIPS = 5

/** Songs looked at for covers: a playlist of thousands with none stops early. */
export const LOOK_AT = 200

const maps = new WeakMap<LibraryTrack[], Map<number, LibraryTrack>>()

/** The library by id, made once per library list and shared by every tile (not one map of every song per tile). */
export function byIdOf(tracks: LibraryTrack[]): Map<number, LibraryTrack> {
  let m = maps.get(tracks)
  if (!m) maps.set(tracks, (m = new Map(tracks.map((t) => [t.id, t]))))
  return m
}

/** The songs whose covers make the collage: in the playlist's order, one per distinct picture, up to `n`. */
export function bannerCovers(ids: number[] | undefined, byId: Map<number, LibraryTrack>, n = STRIPS): LibraryTrack[] {
  const out: LibraryTrack[] = []
  const seen = new Set<string>()
  for (const id of (ids ?? []).slice(0, LOOK_AT)) {
    const t = byId.get(id)
    const art = t && trackArt(t)[0]
    if (!t || !art || seen.has(art)) continue
    seen.add(art)
    out.push(t)
    if (out.length === n) break
  }
  return out
}

export { hueOf, initialOf } from '../../shared/hue'

const clamp = (v: number) => Math.round(Math.max(0, Math.min(255, v)))

/** The covers' colour taken down until white text on it reads (each channel at 40 %: 5.7:1 at the brightest, a bit deeper on dark themes). */
export function deepOf(rgb: [number, number, number], dark: boolean): string {
  return `rgb(${rgb.map((v) => clamp(v * (dark ? 0.34 : 0.4))).join(' ')})`
}

/** The wash over the collage, from the covers' average colour (or the name's hue without one): clear at the top, deep under the name so white text reads. */
export function washOf(rgb: [number, number, number] | null, name: string, dark: boolean): string {
  const hsl = (l: number) => `hsl(${hueOf(name)} 55% ${l}%)`
  const deep = rgb ? deepOf(rgb, dark) : hsl(dark ? 20 : 26)
  const light = rgb ? `rgb(${rgb.map((v) => clamp(v)).join(' ')} / 0.3)` : hsl(dark ? 36 : 42)
  return `linear-gradient(to bottom, ${light}, ${deep})`
}

/** The page a scroller is on, from its position: `left` is `scrollLeft` (negative or inverted in right-to-left, the sign is dropped). Always within 0..pages-1. */
export function pageOf(left: number, width: number, total: number): { page: number; pages: number } {
  if (width <= 0 || total <= width) return { page: 0, pages: 1 }
  const pages = Math.ceil(total / width)
  return { page: Math.max(0, Math.min(pages - 1, Math.round(Math.abs(left) / width))), pages }
}
