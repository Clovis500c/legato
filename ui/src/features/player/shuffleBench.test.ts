import { describe, expect, it, vi } from 'vitest'
import type { LibraryTrack, TasteSignal } from '../../shared/api'
import { shapedOrder, SHARP, shuffleWeight } from './shuffle'
import { tasteFor } from './taste'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string) => p, invoke: vi.fn() }))

/**
 * `pnpm bench` runs this with LEGATO_BENCH=1 and prints its "BENCH shuffle" line: what a Shuffle of a 10 000-song library costs
 * (the taste store's load from the signals, the scores, the weighted order and the artist pass). Plain test runs skip it.
 */
describe.skipIf(!process.env.LEGATO_BENCH)('shuffle on 10 000 songs', () => {
  it('measures the whole shuffle', () => {
    const lib: LibraryTrack[] = Array.from({ length: 10_000 }, (_, i) => ({ id: i + 1, added: i, addedAt: null, title: `Song ${i}`, artist: `Artist ${i % 700}`, album: `Album ${i % 1500}`, durationMs: 200_000, isrc: null, ids: {}, genre: `g${i % 25}`, year: 1960 + (i % 60), bpm: 80 + (i % 90), key: `k${i % 24}` }) as LibraryTrack)
    const signals: TasteSignal[] = lib.filter((t) => t.id % 3 === 0).map((t) => ({ id: t.id, playsDecayed: 2, playsLong: 3, lastPlayed: 1_700_000_000, skipsRecent: t.id % 9 === 0 ? 1 : 0, liked: t.id % 30 === 0, less: false, never: false, hours: 1 << (t.id % 24), near: [] }))
    const stats: Record<number, [number, number, number]> = Object.fromEntries(lib.filter((t) => t.id % 3 === 0).map((t) => [t.id, [3, 1_700_000_000, 0]]))
    const once = () => {
      const t0 = performance.now()
      const map = new Map(signals.map((s) => [s.id, s]))
      const t1 = performance.now()
      const taste = tasteFor(stats, map)
      const weights = lib.map((t) => shuffleWeight(t, taste, 1_800_000_000, SHARP.balanced))
      const t2 = performance.now()
      const order = shapedOrder(lib.map((t) => t.artist), 0, () => false, weights)
      const t3 = performance.now()
      return { load: t1 - t0, score: t2 - t1, order: t3 - t2, total: t3 - t0, n: order.length }
    }
    once()
    const runs = Array.from({ length: 5 }, once).sort((a, b) => a.total - b.total)
    const best = runs[0]
    console.log(`BENCH shuffle 10000: ${best.total.toFixed(1)} ms (store load ${best.load.toFixed(1)}, scores ${best.score.toFixed(1)}, order ${best.order.toFixed(1)})`)
    expect(best.n).toBe(10_000)
    expect(best.total).toBeLessThan(50)
  })
})
