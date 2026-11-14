import { describe, expect, it, vi } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { bannerCovers, byIdOf, deepOf, hueOf, initialOf, LOOK_AT, pageOf, seedOf, TILT, wallGrid, wallSize, washOf } from './banner'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string, s: string) => `http://${s}.localhost/${encodeURIComponent(p)}`, invoke: vi.fn() }))

const song = (id: number, art: string | null): LibraryTrack => ({ id, art, ids: {} }) as unknown as LibraryTrack
const byId = new Map([song(1, 'https://i.scdn.co/a'), song(2, null), song(3, 'https://i.scdn.co/a'), song(4, 'https://i.scdn.co/b'), song(5, 'https://i.scdn.co/c')].map((t) => [t.id, t]))

describe('playlist banners', () => {
  it('takes one song per distinct cover, in the playlist order, skipping songs without art', () => {
    expect(bannerCovers([1, 2, 3, 4, 5, 99], byId).map((t) => t.id)).toEqual([1, 4, 5])
    expect(bannerCovers([5, 4, 1], byId, 2).map((t) => t.id)).toEqual([5, 4])
    expect(bannerCovers(undefined, byId)).toEqual([])
    expect(bannerCovers([2], byId)).toEqual([])
  })

  it('a name keeps its hue and its initial; one with no letter has a mark all the same', () => {
    expect(hueOf('Road trip')).toBe(hueOf('Road trip'))
    expect(hueOf('Road trip')).toBeLessThan(360)
    expect(hueOf('')).toBe(0)
    expect([initialOf('  été 2024'), initialOf('日本'), initialOf('★★'), initialOf('')]).toEqual(['É', '日', '?', '?'])
  })

  it('the wash under the name is deep enough for white text, on any cover', () => {
    const lum = (css: string) => {
      const [r, g, b] = css.match(/\d+/g)!.map((n) => {
        const c = Number(n) / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    for (const dark of [false, true]) for (const rgb of [[255, 255, 255], [255, 255, 0], [0, 200, 255], [250, 40, 40]] as [number, number, number][]) expect(1.05 / (lum(deepOf(rgb, dark)) + 0.05)).toBeGreaterThanOrEqual(4.5)
    expect(washOf([10, 20, 30], 'x', true)).toMatch(/^linear-gradient\(to bottom, rgb\(10 20 30 \/ 0\.3\), rgb\(/)
    expect(washOf(null, 'Road trip', false)).toContain(`hsl(${hueOf('Road trip')} `)
  })

  it('pages: where a scroller is, in either direction, and one page when all fits', () => {
    expect(pageOf(0, 600, 1800)).toEqual({ page: 0, pages: 3 })
    expect(pageOf(610, 600, 1800)).toEqual({ page: 1, pages: 3 })
    expect(pageOf(-1180, 600, 1800)).toEqual({ page: 2, pages: 3 })
    expect(pageOf(5000, 600, 1800).page).toBe(2)
    expect(pageOf(0, 600, 500)).toEqual({ page: 0, pages: 1 })
    expect(pageOf(0, 0, 500)).toEqual({ page: 0, pages: 1 })
  })
})

describe('banner sources', () => {
  it('one map of the library for every tile, and a long playlist with no covers stops early', () => {
    const tracks = Array.from({ length: 3 }, (_, i) => ({ id: i + 1 }) as LibraryTrack)
    expect(byIdOf(tracks)).toBe(byIdOf(tracks))
    const none = Array.from({ length: 5000 }, (_, i) => i + 10)
    const seen: number[] = []
    const spy = new Map<number, LibraryTrack>()
    spy.get = (id: number) => (seen.push(id), undefined)
    expect(bannerCovers(none, spy)).toEqual([])
    expect(seen.length).toBe(LOOK_AT)
  })

  it('a header wash is deepest on the text side, a tile wash at the bottom', () => {
    expect(washOf([10, 20, 30], 'x', false, 'start')).toMatch(/^linear-gradient\(to right, rgb\(4 8 12\) 0%, rgb\(4 8 12\) 38%, rgb\(10 20 30 \/ 0\.3\) 100%\)$/)
    expect(washOf(null, 'x', true, 'bottom')).toMatch(/^linear-gradient\(to bottom, hsl\(/)
  })

  it('the wall: no cells without covers, neighbours never the same cover, every cover used when the cells allow', () => {
    expect(wallGrid(0, 4, 10)).toEqual([])
    for (const n of [3, 4, 5, 6, 7, 48]) {
      const g = wallGrid(n, 6, 12)
      expect(g).toHaveLength(6)
      expect(g.every((r) => r.length === 12)).toBe(true)
      for (let r = 0; r < g.length; r++) for (let c = 0; c < 12; c++) {
        if (c) expect(g[r][c]).not.toBe(g[r][c - 1])
        // Odd rows are shifted half a cell to the start: they sit between c-1 and c above; even rows between c and c+1.
        if (r) expect(r % 2 ? [g[r - 1][c - 1], g[r - 1][c]] : [g[r - 1][c], g[r - 1][c + 1]]).not.toContain(g[r][c])
      }
      if (n <= 12) expect(new Set(g.flat()).size).toBe(n)
    }
    // Two covers repeat but still alternate; one cover is one cover.
    expect(wallGrid(2, 1, 4)).toEqual([[0, 1, 0, 1]])
    expect(new Set(wallGrid(1, 3, 3).flat())).toEqual(new Set([0]))
  })
})

describe('the wall of a big playlist', () => {
  // x of a cell: odd rows sit half a cell to the start.
  const near = (g: number[][], rr: number, cc: number, dc: number, dr: number) => {
    const out: number[] = []
    const x = cc - (rr % 2 ? 0.5 : 0)
    for (let r = Math.max(0, rr - dr); r <= Math.min(g.length - 1, rr + dr); r++)
      for (let c = 0; c < g[r].length; c++) if ((r !== rr || c !== cc) && Math.abs(c - (r % 2 ? 0.5 : 0) - x) <= dc) out.push(g[r][c])
    return out
  }

  it('covers come from the whole playlist, the same ones for the same playlist', () => {
    const tracks = Array.from({ length: 1403 }, (_, i) => song(i + 1, `https://i.scdn.co/${i}`))
    const map = new Map(tracks.map((t) => [t.id, t]))
    const ids = tracks.map((t) => t.id)
    const covers = bannerCovers(ids, map, 48, seedOf('pl-1'))
    expect(covers).toHaveLength(48)
    expect(covers.map((t) => t.id)).toEqual(bannerCovers(ids, map, 48, seedOf('pl-1')).map((t) => t.id))
    // Taken along the whole list: some from its last third, not the first 200 alone.
    expect(Math.max(...covers.map((t) => t.id))).toBeGreaterThan(1000)
    expect(covers.filter((t) => t.id > 700).length).toBeGreaterThan(15)
  })

  it('a cover never comes back within 5 columns x 3 rows, diagonals included; 3 covers keep their neighbours apart', () => {
    for (const n of [20, 48]) for (const seed of [0, 7, seedOf('Music')]) {
      const g = wallGrid(n, 14, 40, seed)
      for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) expect(near(g, r, c, 2, 1)).not.toContain(g[r][c])
      expect(new Set(g.flat()).size).toBe(n)
    }
    // Same seed, same wall; another seed, another one.
    expect(wallGrid(48, 6, 20, 3)).toEqual(wallGrid(48, 6, 20, 3))
    expect(wallGrid(48, 6, 20, 3)).not.toEqual(wallGrid(48, 6, 20, 4))
    // A small playlist still never puts equal covers side by side (4 to 7 covers).
    for (const n of [4, 5, 6, 7, 10]) {
      const g = wallGrid(n, 8, 20, 5)
      for (let r = 0; r < g.length; r++) for (let c = 0; c < 20; c++) expect(near(g, r, c, 1, 1)).not.toContain(g[r][c])
    }
  })

  it('the tilted wall covers all four corners of its box, at any size, also mirrored', () => {
    const rad = (d: number) => (d * Math.PI) / 180
    // A point of the box (centre origin) onto the wall's plane: the transform undone is hard, so the wall's corners go forward instead.
    const project = (x: number, y: number, turn: number) => {
      const t = rad(turn)
      const rx = x * Math.cos(t) - y * Math.sin(t)
      const ry = x * Math.sin(t) + y * Math.cos(t)
      const l = rad(TILT.lean)
      const z = ry * Math.sin(l)
      const k = TILT.depth / (TILT.depth - z)
      return [rx * k, ry * Math.cos(l) * k]
    }
    const inside = (p: number[], quad: number[][]) => {
      const sign = quad.map((a, i) => {
        const b = quad[(i + 1) % 4]
        return Math.sign((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]))
      })
      return sign.every((v) => v >= 0) || sign.every((v) => v <= 0)
    }
    for (const turn of [-TILT.turn, TILT.turn]) for (const [w, h] of [[1630, 230], [375, 200], [2560, 260], [1000, 230], [800, 150], [3840, 300], [280, 140], [240, 140], [1200, 600]]) {
      const need = wallSize(w, h)
      const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => project((sx * need.w) / 2, (sy * need.h) / 2, turn))
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) expect(inside([(sx * w) / 2, (sy * h) / 2], quad), `${w}x${h} corner ${sx},${sy} turn ${turn}`).toBe(true)
    }
  })
})
