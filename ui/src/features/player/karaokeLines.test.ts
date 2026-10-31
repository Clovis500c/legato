import { describe, expect, it } from 'vitest'
import { centerShift, nudged, nudgeOf, plainShift, seatOf } from './karaokeLines'
import { fixesWith, fixLabel, NO_FIX } from './lyricsAt'

describe('seats', () => {
  it('the sung line, one past, two next, the rest hidden', () => {
    expect([-3, -2, -1, 0, 1, 2, 3].map((d) => seatOf(10 + d, 10))).toEqual(['hidden', 'hidden', 'past', 'now', 'next', 'later', 'hidden'])
  })
  it('before the first line: nothing sung, the first two are next', () => {
    expect([0, 1, 2].map((i) => seatOf(i, -1))).toEqual(['next', 'later', 'hidden'])
  })
})

describe('centre', () => {
  it('moves a line to the middle of the view', () => {
    expect(centerShift(1000, 700, 100)).toBe(-250)
    expect(centerShift(1000, 0, 100)).toBe(450)
  })
})

describe('plain lyrics', () => {
  it('follow the share of the song played, within the room they have', () => {
    expect(plainShift(0, 200_000, 3000, 1000)).toBe(0)
    expect(plainShift(100_000, 200_000, 3000, 1000)).toBe(-1000)
    expect(plainShift(999_000, 200_000, 3000, 1000)).toBe(-2000)
  })
  it('stay still without a length, or when they fit', () => {
    expect(plainShift(5000, null, 3000, 1000)).toBe(0)
    expect(plainShift(5000, 0, 3000, 1000)).toBe(0)
    expect(plainShift(5000, 100_000, 800, 1000)).toBe(0)
  })
})

describe('arrows', () => {
  it('← → half a second, ↓ ↑ a tenth, other keys nothing', () => {
    expect([nudgeOf('ArrowLeft'), nudgeOf('ArrowRight'), nudgeOf('ArrowDown'), nudgeOf('ArrowUp')]).toEqual([-500, 500, -100, 100])
    expect(nudgeOf('KeyK')).toBeNull()
  })
  it('move the offset and keep the speed', () => {
    expect(nudged({ offset: 200, rate: 1.05 }, -500)).toEqual({ offset: -300, rate: 1.05 })
  })
})

describe('saved fixes', () => {
  it('replace the song’s, and drop one that changes nothing', () => {
    const all = { a: { offset: 500, rate: 1 } }
    expect(fixesWith(all, 'b', { offset: -100, rate: 1 })).toEqual({ a: { offset: 500, rate: 1 }, b: { offset: -100, rate: 1 } })
    expect(fixesWith(all, 'a', NO_FIX)).toEqual({})
    expect(fixesWith(all, 'a', null)).toEqual({})
    expect(all).toEqual({ a: { offset: 500, rate: 1 } })
  })
  it('read as signed seconds', () => {
    expect(fixLabel({ offset: 500, rate: 1 })).toBe('+0.5 s')
    expect(fixLabel({ offset: -1500, rate: 0.95 })).toBe('−1.5 s · ×0.95')
  })
})
