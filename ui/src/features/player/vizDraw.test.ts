import { describe, expect, it } from 'vitest'
import { columnsFor, columnSpans, dialGeometry, ledRows, monoDb, RING_INNER, ringBars, toColumns, wavePath } from './vizDraw'

describe('visualizer shapes', () => {
  it('more room, more columns, up to one a band', () => {
    expect([columnsFor(0), columnsFor(100), columnsFor(448), columnsFor(4000)]).toEqual([8, 20, 61, 61])
  })

  it('both sides become one by power', () => {
    const out = monoDb([-120, -10, -20], [-120, -10, -120], new Float32Array(3))
    expect(out[0]).toBeCloseTo(-120, 0)
    expect(out[1]).toBeCloseTo(-10, 5)
    // One side silent: half the power, 3 dB down.
    expect(out[2]).toBeCloseTo(-23.01, 1)
  })

  it('columns take the loudest band of their share, every band counted once', () => {
    const bands = Float32Array.from({ length: 61 }, (_, i) => -100 + i)
    expect(Array.from(toColumns(bands, new Float32Array(61))).slice(0, 3)).toEqual([-100, -99, -98])
    const cols = toColumns(bands, new Float32Array(8))
    expect(cols[7]).toBe(-40)
    expect(cols[0]).toBe(-100 + 6)
    const one = new Float32Array(61).fill(-120)
    one[30] = -3
    expect(Array.from(toColumns(one, new Float32Array(10))).filter((v) => v === -3)).toHaveLength(1)
  })

  it('LED rows tile the box from the bottom, whole pixels, a gap between', () => {
    const r = ledRows(96, 2)
    expect(r.y).toHaveLength(r.h.length)
    expect(r.y.length).toBeGreaterThanOrEqual(6)
    expect(r.y[0] + r.h[0]).toBeLessThanOrEqual(96)
    expect(r.y[0]).toBeGreaterThan(r.y[1])
    for (let k = 1; k < r.y.length; k++) expect(r.y[k] + r.h[k]).toBeLessThan(r.y[k - 1])
    expect(r.y.every((v, k) => Number.isInteger(v) && Number.isInteger(r.h[k]) && v >= 0 && r.h[k] >= 1)).toBe(true)
    // Taller box, more segments, never less than 6 nor more than 64.
    expect(ledRows(900, 1).y.length).toBeGreaterThan(r.y.length)
    expect(ledRows(10, 1).y.length).toBe(6)
    expect(ledRows(4000, 1).y.length).toBe(64)
  })

  it('column spans fill the width in whole pixels', () => {
    const s = columnSpans(100, 8, 2)
    expect(s.x[0]).toBe(0)
    expect(s.x[7] + s.w[7] + 2).toBe(100)
    expect(s.x.every((v, i) => Number.isInteger(v) && s.w[i] >= 1)).toBe(true)
  })

  it('wave goes through the bars, filled down to the bottom', () => {
    expect(wavePath([0, 1], 100, 50, false)).toBe('M0 50 Q0 50 50 25 L100 0')
    expect(wavePath([0.5], 100, 50, true)).toBe('M0 25 L0 25 L100 50 L0 50 Z')
    expect(wavePath([], 100, 50, true)).toBe('')
  })
})

describe('radial ring', () => {
  it('bars mirror left and right, low notes at the bottom, none on the seams', () => {
    const r = ringBars(400, 30)
    expect(r.dx).toHaveLength(60)
    for (let i = 0; i < 30; i++) {
      expect(r.dx[30 + i]).toBeCloseTo(-r.dx[i], 6)
      expect(r.dy[30 + i]).toBeCloseTo(r.dy[i], 6)
      expect(r.dx[i]).toBeGreaterThan(0)
      expect(Math.hypot(r.dx[i], r.dy[i])).toBeCloseTo(1, 5)
    }
    expect(r.dy[0]).toBeGreaterThan(0.9)
    expect(r.dy[29]).toBeLessThan(-0.9)
  })

  it('starts at the inner share of the half box and reaches the edge', () => {
    const r = ringBars(400, 10)
    expect(r.r0).toBeCloseTo(200 * RING_INNER, 6)
    expect(r.r0 + r.len).toBeCloseTo(200, 6)
  })
})

describe('VU dial', () => {
  it('a wide low box gets a shallow arc with its pivot below, and the arc fits the width', () => {
    const d = dialGeometry(220, 48)
    expect(d.py).toBeGreaterThan(48)
    expect(d.swing).toBeLessThan(0.5)
    expect(d.r * Math.sin(d.swing)).toBeLessThanOrEqual(110)
    // The arc's ends stay inside the box.
    expect(d.py - d.r * Math.cos(d.swing)).toBeLessThan(48)
  })

  it('a tall box swings wider, never past 60 degrees', () => {
    const d = dialGeometry(300, 300)
    expect(d.swing).toBeGreaterThan(0.9)
    expect(d.swing).toBeLessThanOrEqual(Math.PI / 3 + 1e-9)
  })
})
