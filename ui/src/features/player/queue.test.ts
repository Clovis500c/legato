import { describe, expect, it } from 'vitest'
import { fadeGain, nextIndex, playOrder, queued } from './queue'

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

describe('queued', () => {
  it('inserts after the current track or at the end', () => {
    expect(queued([2, 0, 1], 0, [3, 4], true)).toEqual([2, 0, 3, 4, 1])
    expect(queued([2, 0, 1], 0, [3], false)).toEqual([2, 0, 1, 3])
  })
})

describe('fadeGain', () => {
  const dur = 200_000
  it('off at 0 seconds, full volume mid-track', () => {
    expect(fadeGain(199_000, dur, 0, true)).toBe(1)
    expect(fadeGain(100_000, dur, 5, true)).toBe(1)
  })

  it('fades in only after an automatic change, fades out at the end', () => {
    expect(fadeGain(0, dur, 5, true)).toBe(0)
    expect(fadeGain(0, dur, 5, false)).toBe(1)
    expect(fadeGain(2500, dur, 5, true)).toBeCloseTo(0.5)
    expect(fadeGain(dur - 2500, dur, 5, false)).toBeCloseTo(0.5)
    expect(fadeGain(dur, dur, 5, false)).toBe(0)
  })

  it('short or unknown-length tracks never fade out', () => {
    expect(fadeGain(9000, 9500, 5, false)).toBe(1)
    expect(fadeGain(9000, null, 5, false)).toBe(1)
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
