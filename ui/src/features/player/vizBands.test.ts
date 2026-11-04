import { describe, expect, it } from 'vitest'
import { bandCount, freqAt, THIRDS, toThirds } from './vizBands'
import { VIZ_BANDS } from './vizUnpack'

const sixths = (fill: number, at: Record<number, number> = {}) => {
  const db = new Float32Array(VIZ_BANDS).fill(fill)
  for (const [i, v] of Object.entries(at)) db[Number(i)] = v
  return db
}

describe('toThirds', () => {
  it('makes 31 bands of 61', () => {
    expect(THIRDS).toBe(31)
    expect(bandCount('third')).toBe(31)
    expect(bandCount('sixth')).toBe(61)
  })

  it('keeps a sine at a third’s center, splits one on its edge', () => {
    const centre = toThirds(sixths(-120, { 34: 0 }), new Float32Array(THIRDS))
    expect(centre[17]).toBeCloseTo(0, 1)
    expect(centre[16]).toBeLessThan(-100)
    const edge = toThirds(sixths(-120, { 35: 0 }), new Float32Array(THIRDS))
    expect(edge[17]).toBeCloseTo(-3.01, 1)
    expect(edge[18]).toBeCloseTo(-3.01, 1)
  })

  it('keeps a flat spectrum flat, the ends too (twice the width: 3 dB more)', () => {
    const out = toThirds(sixths(-40), new Float32Array(THIRDS))
    for (const v of out) expect(v).toBeCloseTo(-40 + 3.01, 1)
  })
})

describe('freqAt', () => {
  it('puts 1 kHz on its band’s column, the marks in order inside the box', () => {
    expect(freqAt(1000, 'sixth')).toBeCloseTo(34.5 / 61, 6)
    expect(freqAt(1000, 'third')).toBeCloseTo(17.5 / 31, 6)
    for (const banding of ['sixth', 'third'] as const) {
      const xs = [50, 100, 1000, 10000].map((hz) => freqAt(hz, banding))
      expect(xs).toEqual([...xs].sort((a, b) => a - b))
      expect(xs[0]).toBeGreaterThan(0)
      expect(xs[3]).toBeLessThan(1)
    }
  })
})
