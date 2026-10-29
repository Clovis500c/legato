import { describe, expect, it } from 'vitest'
import { barLevel, BARS, stepBars, stepPeaks, wavePath } from './bars'

describe('visualizer bars', () => {
  it('maps -60..-6 dB to empty..full', () => {
    expect([barLevel(-120), barLevel(-60), barLevel(-33), barLevel(-6), barLevel(0)]).toEqual([0, 0, 0.5, 1, 1])
  })

  it('rises fast, falls slower, rests without bands', () => {
    const rest = new Array(BARS).fill(0)
    const loud = new Array(BARS).fill(-6)
    const up = stepBars(rest, loud, 0.03)
    expect(up[0]).toBeCloseTo(1 - Math.exp(-1), 5)
    const down = stepBars(new Array(BARS).fill(1), undefined, 0.03)
    expect(1 - down[0]).toBeLessThan(up[0])
    expect(stepBars(rest, loud.slice(0, 2), 1)[5]).toBe(0)
  })
})

describe('visualizer styles', () => {
  it('peaks jump up with their bar and fall back slowly', () => {
    expect(stepPeaks([0.2, 0.9], [0.5, 0.1], 0.12)).toEqual([0.5, 0.8])
  })

  it('wave goes through the bars, filled down to the bottom', () => {
    expect(wavePath([0, 1], 100, 50, false)).toBe('M0 50 Q0 50 50 25 L100 0')
    expect(wavePath([0.5], 100, 50, true)).toBe('M0 25 L0 25 L100 50 L0 50 Z')
    expect(wavePath([], 100, 50, true)).toBe('')
  })
})
