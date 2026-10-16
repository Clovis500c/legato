import { describe, expect, it } from 'vitest'
import { nextIndex, playOrder } from './queue'

describe('playOrder', () => {
  it('keeps list order, or shuffles with the current track first', () => {
    expect(playOrder(4, 2, false)).toEqual([0, 1, 2, 3])
    let seed = 1
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const o = playOrder(50, 7, true, rand)
    expect(o[0]).toBe(7)
    expect([...o].sort((a, b) => a - b)).toEqual(playOrder(50, 0, false))
    expect(o).not.toEqual(playOrder(50, 7, false))
  })
})

describe('nextIndex', () => {
  const order = [2, 0, 3, 1]
  it('walks the order and stops at the end without repeat', () => {
    expect(nextIndex(order, 2, 1, 'off', false)).toBe(0)
    expect(nextIndex(order, 1, 1, 'off', true)).toBeNull()
    expect(nextIndex(order, 2, -1, 'off', false)).toBeNull()
  })

  it('wraps with repeat all, replays with repeat one only when the track ended', () => {
    expect(nextIndex(order, 1, 1, 'all', true)).toBe(2)
    expect(nextIndex(order, 2, -1, 'all', false)).toBe(1)
    expect(nextIndex(order, 3, 1, 'one', true)).toBe(3)
    expect(nextIndex(order, 3, 1, 'one', false)).toBe(1)
  })

  it('skips unplayable tracks, gives up when none plays', () => {
    expect(nextIndex(order, 2, 1, 'off', false, (i) => i === 0)).toBe(3)
    expect(nextIndex(order, 2, 1, 'all', false, () => true)).toBeNull()
  })
})
