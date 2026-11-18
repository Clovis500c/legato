import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import type { Taste } from './score'
import { shapedOrder, SHARP, shuffleWeight, smartOrder, steered, weightedOrder } from './shuffle'

// Seeded: the same "random" on every run.
const seeded = (seed: number) => () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
const ARTISTS = ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'C', 'C', 'C', 'C', 'D', 'E', 'F']
const never = () => false
// Same artist twice in a row, counted.
const pairs = (order: number[], names: readonly string[] = ARTISTS) => order.slice(1).filter((x, k) => names[x] === names[order[k]]).length

describe('smart shuffle', () => {
  it('plays every song once, the current one first', () => {
    for (let s = 1; s <= 50; s++) {
      const order = smartOrder(ARTISTS, 5, never, seeded(s))
      expect(order[0]).toBe(5)
      expect([...order].sort((a, b) => a - b)).toEqual(ARTISTS.map((_, i) => i))
    }
    expect(smartOrder([], -1, never)).toEqual([])
  })

  it('never plays an artist twice in a row while someone else is left', () => {
    for (let s = 1; s <= 300; s++) {
      expect(pairs(smartOrder(ARTISTS, 0, never, seeded(s)))).toBe(0)
      expect(pairs(smartOrder(ARTISTS, -1, never, seeded(s)))).toBe(0)
    }
  })

  it('reads featured artists as the main one, and nameless songs as strangers', () => {
    const names = ['A feat. B', 'A', 'B', 'C', '', '']
    const main = ['A', 'A', 'B', 'C', 'x', 'y']
    for (let s = 1; s <= 100; s++) expect(pairs(smartOrder(names, -1, never, seeded(s)), main)).toBe(0)
  })

  it('plays the songs heard lately after the others', () => {
    const lately = (i: number) => i === 0 || i === 4 || i === 8
    for (let s = 1; s <= 50; s++) {
      const order = smartOrder(ARTISTS, 14, lately, seeded(s))
      expect(order.slice(-3).sort((a, b) => a - b)).toEqual([0, 4, 8])
      expect(pairs(order)).toBe(0)
    }
  })

  it('still shuffles: another seed, another order', () => {
    const orders = new Set([1, 2, 3, 4, 5, 6].map((s) => smartOrder(ARTISTS, -1, never, seeded(s)).join()))
    expect(orders.size).toBe(6)
  })
})

describe('shuffle shaped by the score', () => {
  const N = 1000
  // Song i has a z-score that falls with i: the top decile is 0..99, the bottom decile 900..999.
  const zs = Array.from({ length: N }, (_, i) => 2.5 - (5 * i) / (N - 1))
  const artists = Array.from({ length: N }, (_, i) => `Artist ${i % 150}`)

  it('the top decile lands in the first third much more often than the bottom decile, over 200 runs', () => {
    let top = 0
    let bottom = 0
    const weights = zs.map((z) => Math.exp(0.9 * z))
    for (let s = 1; s <= 200; s++) {
      const order = weightedOrder(weights, seeded(s))
      expect(order).toHaveLength(N)
      const place = new Map(order.map((i, k) => [i, k]))
      for (let i = 0; i < 100; i++) top += place.get(i)! < N / 3 ? 1 : 0
      for (let i = 900; i < N; i++) bottom += place.get(i)! < N / 3 ? 1 : 0
    }
    expect(top / 20000).toBeGreaterThan(0.6)
    expect(top).toBeGreaterThan(2 * bottom)
    expect(bottom).toBeGreaterThan(0)
  })

  it('a weight: rested songs and the ones you like up, the ones just heard and skipped down, never 0', () => {
    const t = { id: 1 } as LibraryTrack
    const now = 1_800_000_000
    const w = (taste: Partial<Taste>, sharp = SHARP.balanced) => shuffleWeight(t, { rating: () => 0, plays: () => 0, skips: () => 0, never: () => false, ...taste }, now, sharp)
    expect(w({})).toBe(1)
    expect(w({ lastPlayed: () => now - 3600 })).toBeLessThan(w({ lastPlayed: () => now - 3 * 86_400 }))
    expect(w({ lastPlayed: () => now - 3 * 86_400 })).toBeLessThan(w({ lastPlayed: () => now - 14 * 86_400 }))
    expect(w({ liked: () => true })).toBeGreaterThan(w({}))
    expect(w({ liked: () => true }, SHARP.alike)).toBeGreaterThan(w({ liked: () => true }, SHARP.adventurous))
    expect(w({ skips: () => 2 })).toBeLessThan(w({ skips: () => 1 }))
    expect(w({ skips: () => 50, less: () => true, lastPlayed: () => now })).toBeGreaterThan(0)
  })

  it('an artist that fills a third of the list comes back every third song or so, never twice in a row', () => {
    const names = Array.from({ length: 90 }, (_, i) => (i % 3 === 0 ? 'Fav' : `Other ${i}`))
    for (let s = 1; s <= 30; s++) {
      // Fav's songs weigh 10 times more: they would all come first without the spacing.
      const order = shapedOrder(names, -1, () => false, names.map((a) => (a === 'Fav' ? 10 : 1)), seeded(s))
      const places = order.flatMap((i, k) => (names[i] === 'Fav' ? [k] : []))
      expect(places.slice(1).every((p, k) => p - places[k] >= 3)).toBe(true)
      expect(places.filter((p) => p < 30).length).toBeLessThanOrEqual(10)
    }
  })

  it('the current song stays first, no artist twice in a row, rated 1-2 and recent songs last, every song once', () => {
    const low = (i: number) => i % 50 === 7
    const weights = zs.map((z) => Math.exp(0.9 * z))
    for (let s = 1; s <= 30; s++) {
      const order = shapedOrder(artists, 5, low, weights, seeded(s))
      expect(order[0]).toBe(5)
      expect([...order].sort((a, b) => a - b)).toEqual(artists.map((_, i) => i))
      expect(order.slice(1).filter((x, k) => artists[x] === artists[order[k]])).toHaveLength(0)
      const firstLow = order.findIndex((i, k) => k > 0 && low(i))
      expect(order.slice(firstLow).every(low)).toBe(true)
    }
    expect(shapedOrder([], -1, () => false, [])).toEqual([])
  })

  it('the same seed gives the same order', () => {
    expect(shapedOrder(artists, 0, () => false, zs, seeded(9))).toEqual(shapedOrder(artists, 0, () => false, zs, seeded(9)))
  })
})

describe('a skip steers the shuffle', () => {
  // Places 0..19; the songs of artist S sit at 2, 5 and 15; 7 is one of them you queued.
  const order = Array.from({ length: 20 }, (_, i) => i)
  const s = new Set([2, 5, 7, 15])
  it('the next ten after the current song carry none of that artist, the moved ones right after them, every song once', () => {
    const out = steered(order, 0, (i) => s.has(i), new Set([7]), false)
    expect(out.slice(1, 11).filter((i) => s.has(i))).toEqual([7])
    expect(out.slice(11, 13)).toEqual([2, 5])
    expect([...out].sort((a, b) => a - b)).toEqual(order)
  })
  it('skipped twice: all of theirs go to the end; what was already played stays', () => {
    const out = steered(order, 3, (i) => s.has(i), new Set(), true)
    expect(out.slice(0, 4)).toEqual([0, 1, 2, 3])
    expect(out.slice(-3)).toEqual([5, 7, 15])
    expect(out).toHaveLength(20)
  })
})
