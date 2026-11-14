import { describe, expect, it } from 'vitest'
import { BETA, shapedOrder, smartOrder, weightedOrder, weightOf } from './shuffle'

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
    for (let s = 1; s <= 200; s++) {
      const order = weightedOrder(zs, BETA.balanced, seeded(s))
      expect(order).toHaveLength(N)
      const place = new Map(order.map((i, k) => [i, k]))
      for (let i = 0; i < 100; i++) top += place.get(i)! < N / 3 ? 1 : 0
      for (let i = 900; i < N; i++) bottom += place.get(i)! < N / 3 ? 1 : 0
    }
    expect(top / 20000).toBeGreaterThan(0.6)
    expect(top).toBeGreaterThan(2 * bottom)
    expect(bottom).toBeGreaterThan(0)
  })

  it('every song keeps a nonzero chance: the weight is above 0 however low the score, and capped however high', () => {
    for (const beta of Object.values(BETA)) for (const z of [-50, -3, 0, 3, 50]) expect(weightOf(z, beta)).toBeGreaterThanOrEqual(0.1)
    expect(weightOf(50, BETA.alike)).toBe(30)
  })

  it('the current song stays first, no artist twice in a row, rated 1-2 and recent songs last, every song once', () => {
    const low = (i: number) => i % 50 === 7
    for (let s = 1; s <= 30; s++) {
      const order = shapedOrder(artists, 5, low, zs, BETA.balanced, seeded(s))
      expect(order[0]).toBe(5)
      expect([...order].sort((a, b) => a - b)).toEqual(artists.map((_, i) => i))
      expect(order.slice(1).filter((x, k) => artists[x] === artists[order[k]])).toHaveLength(0)
      const firstLow = order.findIndex((i, k) => k > 0 && low(i))
      expect(order.slice(firstLow).every(low)).toBe(true)
    }
    expect(shapedOrder([], -1, () => false, [], BETA.balanced)).toEqual([])
  })

  it('the same seed gives the same order', () => {
    expect(shapedOrder(artists, 0, () => false, zs, BETA.alike, seeded(9))).toEqual(shapedOrder(artists, 0, () => false, zs, BETA.alike, seeded(9)))
  })
})
