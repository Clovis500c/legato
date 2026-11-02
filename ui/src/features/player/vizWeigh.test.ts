import { describe, expect, it } from 'vitest'
import { createScene } from './vizScene'
import { VIZ_BANDS } from './vizUnpack'
import { aWeight, itu468, weightsOf } from './vizWeigh'

describe('visualizer weighting', () => {
  it('tilts 3 dB per octave around 1 kHz', () => {
    const w = weightsOf('tilt')
    // Band 34 = 1 kHz; 6 bands = an octave.
    expect(w[34]).toBeCloseTo(0, 5)
    expect(w[40]).toBeCloseTo(3, 1)
    expect(w[28]).toBeCloseTo(-3, 1)
    expect(weightsOf('flat').every((v) => v === 0)).toBe(true)
  })

  it('follows the A and ITU-R 468 tables', () => {
    expect(aWeight(1000)).toBeCloseTo(0, 1)
    expect(aWeight(100)).toBeCloseTo(-19.1, 1)
    expect(aWeight(10000)).toBeCloseTo(-2.5, 1)
    expect(itu468(1000)).toBeCloseTo(0, 1)
    expect(itu468(6300)).toBeCloseTo(12.2, 1)
    expect(Math.abs(itu468(31.5) + 29.9)).toBeLessThan(0.2)
    expect(Math.abs(itu468(20000) + 22.2)).toBeLessThan(0.3)
  })

  it('a level spectrum climbs toward the highs once tilted', () => {
    const flat = Float32Array.from({ length: VIZ_BANDS }, () => -40)
    const run = (w?: Float32Array) => {
      const scene = createScene(VIZ_BANDS, false, w)
      scene.frame(flat, flat)
      let out = scene.step(1 / 60)
      for (let i = 0; i < 60; i++) out = scene.step(1 / 60)
      return Array.from(out.levels)
    }
    const plain = run()
    const tilted = run(weightsOf('tilt'))
    expect(plain[5]).toBeCloseTo(plain[55], 5)
    expect(tilted[5]).toBeLessThan(tilted[34])
    expect(tilted[34]).toBeLessThan(tilted[55])
  })
})
