import { describe, expect, it } from 'vitest'
import { advance, createTerrain, depthOf, fadeOf, flat, project, resample, ROW_S, ROWS } from './vizTerrain'

describe('3D terrain', () => {
  it('resamples any number of bands into its points', () => {
    const out = new Float32Array(5)
    resample([0, 1], out)
    expect([...out]).toEqual([0, 0.25, 0.5, 0.75, 1])
    resample([0.4], out)
    expect([...out]).toEqual(Array(5).fill(Math.fround(0.4)))
  })

  it('starts a row every ROW_S at any frame rate, the newest following the sound', () => {
    for (const rate of [30, 60, 144]) {
      const t = createTerrain()
      let rows = 0
      let head = t.head
      for (let f = 0; f < rate; f++) {
        advance(t, [f / rate], 1 / rate)
        if (t.head !== head) {
          rows++
          head = t.head
        }
      }
      expect(rows).toBeGreaterThanOrEqual(11)
      expect(rows).toBeLessThanOrEqual(12)
      expect(t.rows[t.head][0]).toBeCloseTo((rate - 1) / rate, 5)
    }
  })

  it('a long gap starts at most one round of rows, copies of the last', () => {
    const t = createTerrain()
    advance(t, [0.5], 0.01)
    advance(t, [0.9], 60)
    expect(t.since).toBeLessThan(ROW_S)
    expect(t.rows.filter((_, i) => i !== t.head).every((r) => Math.abs(r[0] - 0.5) < 1e-6)).toBe(true)
    expect(t.rows[t.head][0]).toBeCloseTo(0.9, 5)
  })

  it('rows go back from the front and fade out at the far end, smoothly', () => {
    expect(depthOf(0, 0)).toBe(1)
    expect(fadeOf(depthOf(0, 0))).toBe(1)
    expect(fadeOf(depthOf(ROWS - 1, 1))).toBeCloseTo(0, 9)
    expect(depthOf(3, 0.5)).toBeCloseTo((depthOf(3, 0) + depthOf(4, 0)) / 2, 9)
  })

  it('in perspective: a further row sits higher, narrower and flatter', () => {
    const near = project(1, 1000, 500)
    const far = project(3, 1000, 500)
    expect(near.y).toBeCloseTo(485, 6)
    expect(far.y).toBeLessThan(near.y)
    expect(far.half).toBeCloseTo(near.half / 3, 6)
    expect(far.lift).toBeCloseTo(near.lift / 3, 6)
  })

  it('flat once every row has fallen silent', () => {
    const t = createTerrain()
    expect(flat(t)).toBe(true)
    advance(t, [0.6, 0.2], 1 / 60)
    expect(flat(t)).toBe(false)
    for (let f = 0; f < 60 * 4; f++) advance(t, [0, 0], 1 / 60)
    expect(flat(t)).toBe(true)
  })
})
