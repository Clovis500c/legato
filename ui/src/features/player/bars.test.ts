import { describe, expect, it } from 'vitest'
import { barLevel, BARS, stepBars } from './bars'

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
