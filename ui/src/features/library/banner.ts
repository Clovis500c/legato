import { hueOf } from '../../shared/hue'
import type { LibraryTrack } from '../../shared/api'
import { trackArt } from '../../shared/art'

/** Pure side of the playlist banners (Steam's "Browse by category" look: tilted strips of covers under a colour wash and the name). No `window`: imported by tests. */

/** Distinct covers a wall is made of (a bigger playlist's first ones): enough to read as a wall, few enough to fetch. */
export const WALL = 48

/** Songs looked at for covers: a playlist of thousands with none stops early. */
export const LOOK_AT = 1000

/** A number from a playlist's id: the same playlist always gets the same wall (no `Math.random` in a render). */
export function seedOf(id: string | number): number {
  id = String(id)
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}

const maps = new WeakMap<LibraryTrack[], Map<number, LibraryTrack>>()

/** The library by id, made once per library list and shared by every tile (not one map of every song per tile). */
export function byIdOf(tracks: LibraryTrack[]): Map<number, LibraryTrack> {
  let m = maps.get(tracks)
  if (!m) maps.set(tracks, (m = new Map(tracks.map((t) => [t.id, t]))))
  return m
}

/**
 * The songs whose covers make the collage: one per distinct picture, up to `n`, taken evenly along the WHOLE playlist (a
 * 1 400-song one shows its end as much as its start; the first songs are often one album), the start of the even steps
 * moved by `seed`, then the songs in between in order, `LOOK_AT` looked at in all.
 */
export function bannerCovers(ids: number[] | undefined, byId: Map<number, LibraryTrack>, n = WALL, seed = 0): LibraryTrack[] {
  const all = ids ?? []
  const order: number[] = []
  const used = new Set<number>()
  // `n` evenly spaced songs first (all distinct covers: the whole list is shown), then 4n if some share a cover.
  for (const take of [Math.min(all.length, n), Math.min(all.length, 4 * n)])
    for (let i = 0; i < take; i++) {
      const at = Math.floor(((i + (seed % 97) / 97) * all.length) / take)
      if (!used.has(at)) order.push(at)
      used.add(at)
    }
  for (let i = 0; i < all.length && order.length < LOOK_AT; i++) if (!used.has(i)) order.push(i)
  const out: LibraryTrack[] = []
  const seen = new Set<string>()
  for (const at of order.slice(0, LOOK_AT)) {
    const t = byId.get(all[at])
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

/**
 * The wash over the wall, from the covers' average colour (or the name's hue without one): clear at one end, deep where the
 * text is so white text reads. `bottom`: a tile, the name at the bottom. `start`: a page's header, the text at the start side
 * (the left; the header mirrors it in right-to-left), the covers showing through on the far side.
 */
export function washOf(rgb: [number, number, number] | null, name: string, dark: boolean, to: 'bottom' | 'start' = 'bottom'): string {
  const hsl = (l: number) => `hsl(${hueOf(name)} 55% ${l}%)`
  const deep = rgb ? deepOf(rgb, dark) : hsl(dark ? 20 : 26)
  const light = rgb ? `rgb(${rgb.map((v) => clamp(v)).join(' ')} / 0.3)` : hsl(dark ? 36 : 42)
  return to === 'bottom' ? `linear-gradient(to bottom, ${light}, ${deep})` : `linear-gradient(to right, ${deep} 0%, ${deep} 38%, ${light} 100%)`
}

/**
 * The wall's cells: `rows` rows of `cols` covers, each an index into `n` covers; odd rows sit half a cell to the start.
 * Few covers (under 4): a fixed pattern, a cell differing from its left neighbour and, with three, from the two above it.
 * Four or more: each cell takes the cover whose nearest copy is the farthest away (never-used ones first), so no cover comes
 * back within a few cells in any direction, diagonals included, and a repeat is as far off as the covers allow. `seed` only
 * decides the ties: one playlist, one wall. No covers: no cells.
 */
export function wallGrid(n: number, rows: number, cols: number, seed = 0): number[][] {
  if (n <= 0) return []
  if (n < 4) {
    // An odd row (shifted to the start) touches cells c-1 and c above: +1 avoids both; an even row touches c and c+1: +2 more.
    const shift = (r: number) => (n > 2 ? Math.floor(r / 2) * 3 + (r % 2) : r)
    return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (c + shift(r)) % n))
  }
  const grid: number[][] = []
  const near = new Float64Array(n)
  for (let r = 0; r < rows; r++) {
    const row: number[] = []
    for (let c = 0; c < cols; c++) {
      const x = c - (r % 2 ? 0.5 : 0)
      near.fill(Infinity)
      // Rows more than 3 above are too far to matter.
      for (let pr = Math.max(0, r - 3); pr <= r; pr++) {
        const prow = pr === r ? row : grid[pr]
        for (let pc = 0; pc < prow.length; pc++) {
          const d = Math.hypot(x - (pc - (pr % 2 ? 0.5 : 0)), r - pr)
          if (d < near[prow[pc]]) near[prow[pc]] = d
        }
      }
      let best = seed % n
      for (let k = 0; k < n; k++) {
        const i = (seed + k) % n
        if (near[i] > near[best]) best = i
      }
      row.push(best)
    }
    grid.push(row)
  }
  return grid
}

/** The tilt of a wall, degrees (`rotate`; mirrored in right-to-left), its `rotateX` and the perspective's distance, as the Wall draws them. */
export const TILT = { turn: 9, lean: 8, depth: 900 }

/**
 * The size a tilted wall needs to cover a box of `w` x `h` at every corner: the box's bounding rectangle in the wall's turned
 * frame (w·cos + h·sin by w·sin + h·cos), grown for the lean (the top edge goes away and shrinks) and a little margin.
 */
export function wallSize(w: number, h: number): { w: number; h: number } {
  const t = (TILT.turn * Math.PI) / 180
  const need = { w: w * Math.cos(t) + h * Math.sin(t), h: w * Math.sin(t) + h * Math.cos(t) }
  const far = 1 + (need.h / 2) * Math.sin((TILT.lean * Math.PI) / 180) / TILT.depth
  return { w: Math.ceil(need.w * far * 1.04), h: Math.ceil((need.h * far * 1.04) / Math.cos((TILT.lean * Math.PI) / 180)) }
}

/** The page a scroller is on, from its position: `left` is `scrollLeft` (negative or inverted in right-to-left, the sign is dropped). Always within 0..pages-1. */
export function pageOf(left: number, width: number, total: number): { page: number; pages: number } {
  if (width <= 0 || total <= width) return { page: 0, pages: 1 }
  const pages = Math.ceil(total / width)
  return { page: Math.max(0, Math.min(pages - 1, Math.round(Math.abs(left) / width))), pages }
}
