import { describe, expect, it } from 'vitest'
import { smartOrder } from './shuffle'

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
