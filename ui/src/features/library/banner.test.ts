import { describe, expect, it, vi } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { bannerCovers, deepOf, hueOf, initialOf, pageOf, washOf } from './banner'

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
