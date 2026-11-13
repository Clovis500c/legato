import { describe, expect, it } from 'vitest'
import { sweetSeconds } from './sweet'

describe('sweetSeconds', () => {
  it('keeps the set seconds when a tempo is unknown or there is no fade', () => {
    expect(sweetSeconds({ bpm: 120 }, {}, 6)).toBe(6)
    expect(sweetSeconds(undefined, { bpm: 120 }, 6)).toBe(6)
    expect(sweetSeconds({ bpm: 120 }, { bpm: 120 }, 0)).toBe(0)
    expect(sweetSeconds({ bpm: 10 }, { bpm: 12 }, 6)).toBe(6)
  })

  it('lands whole phrases of beats when the tempos lock', () => {
    // 120 BPM: a phrase of 8 beats is 4 s; 6 s asked → the nearest whole phrase (2 phrases = 8 s rounds from 1.5 → 2).
    expect(sweetSeconds({ bpm: 120 }, { bpm: 121 }, 6)).toBe(8)
    expect(sweetSeconds({ bpm: 120 }, { bpm: 120 }, 4)).toBe(4)
    // Double time locks too.
    expect(sweetSeconds({ bpm: 70 }, { bpm: 140 }, 8)).toBeCloseTo(((8 * 60) / 70) * 1, 5)
  })

  it('goes short when the tempos are far apart and leaves the middle alone', () => {
    expect(sweetSeconds({ bpm: 90 }, { bpm: 120 }, 8)).toBe(3)
    expect(sweetSeconds({ bpm: 90 }, { bpm: 120 }, 2)).toBe(2)
    expect(sweetSeconds({ bpm: 120 }, { bpm: 128 }, 8)).toBe(8)
  })

  it('never stretches a short fade into a long phrase', () => {
    expect(sweetSeconds({ bpm: 40 }, { bpm: 40 }, 1)).toBe(1)
    expect(sweetSeconds({ bpm: 35 }, { bpm: 35 }, 12)).toBe(12)
  })
})
