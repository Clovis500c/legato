import { describe, expect, it } from 'vitest'
import { colorMap, fillColumn, rowMix, SCROLL, scrollBy } from './vizSpectro'

const unpack = (v: number) => ({ r: v & 255, g: (v >>> 8) & 255, b: (v >>> 16) & 255, a: v >>> 24 })

describe('spectrogram scroll', () => {
  /** Pixels scrolled over `secs` at a refresh rate. */
  function over(rate: number, secs: number, dpr = 1) {
    const acc = { v: 0 }
    let px = 0
    for (let f = 0; f < rate * secs; f++) px += scrollBy(acc, 1 / rate, SCROLL, dpr)
    return px
  }

  it('moves the same distance whatever the refresh rate', () => {
    for (const rate of [24, 30, 60, 75, 120, 144, 240]) expect(Math.abs(over(rate, 2) - 2 * SCROLL)).toBeLessThanOrEqual(1)
  })

  it('counts device pixels at a high density', () => {
    expect(Math.abs(over(60, 1, 2) - 2 * SCROLL)).toBeLessThanOrEqual(1)
  })

  it('a long stall (dt capped by the caller) still gives whole pixels', () => {
    expect(scrollBy({ v: 0 }, 0.1, SCROLL, 1)).toBe(9)
  })
})

describe('spectrogram colours', () => {
  const map = colorMap()

  it('silence is clear, the loudest is opaque and light', () => {
    expect(unpack(map[0]).a).toBe(0)
    const top = unpack(map[255])
    expect(top.a).toBe(255)
    expect(top.r).toBeGreaterThan(200)
  })

  it('opacity only rises with the level', () => {
    for (let i = 1; i < 256; i++) expect(unpack(map[i]).a).toBeGreaterThanOrEqual(unpack(map[i - 1]).a)
  })
})

describe('spectrogram column', () => {
  const map = colorMap()

  it('low bands at the bottom, high at the top', () => {
    const out = new Uint32Array(40)
    fillColumn(out, [1, 0, 0, 0], rowMix(40, 4), map)
    expect(unpack(out[39]).a).toBe(255)
    expect(unpack(out[0]).a).toBe(0)
    fillColumn(out, [0, 0, 0, 1], rowMix(40, 4), map)
    expect(unpack(out[0]).a).toBe(255)
    expect(unpack(out[39]).a).toBe(0)
  })

  it('one column or two still fill without reading outside', () => {
    const out = new Uint32Array(10)
    fillColumn(out, [0.5], rowMix(10, 1), map)
    expect(out.every((v) => v === out[0])).toBe(true)
    fillColumn(out, [0, 1], rowMix(10, 2), map)
    expect(unpack(out[0]).a).toBeGreaterThan(unpack(out[9]).a)
  })
})
