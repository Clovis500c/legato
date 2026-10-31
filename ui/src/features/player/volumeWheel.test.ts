import { describe, expect, it } from 'vitest'
import { nudged, wheelVolume } from './volumeWheel'

const ev = (deltaY: number, shiftKey = false, deltaMode = 0) => ({ deltaY, deltaMode, shiftKey })

describe('wheelVolume', () => {
  it('a notch up is +1 %, down -1 %', () => {
    expect(wheelVolume(0, ev(-100)).delta).toBeCloseTo(0.01)
    expect(wheelVolume(0, ev(120)).delta).toBeCloseTo(-0.01)
  })
  it('Shift is 5 %', () => {
    expect(wheelVolume(0, ev(-100, true)).delta).toBeCloseTo(0.05)
  })
  it('a touchpad adds small events up to one step', () => {
    let acc = 0
    let total = 0
    for (let i = 0; i < 10; i++) {
      const r = wheelVolume(acc, ev(-12))
      acc = r.acc
      total += r.delta
    }
    expect(total).toBeCloseTo(0.01)
  })
  it('a direction change drops the leftover', () => {
    const a = wheelVolume(0, ev(-60))
    expect(a.delta).toBe(0)
    expect(wheelVolume(a.acc, ev(60)).delta).toBe(0)
  })
  it('lines count as 40 px', () => {
    expect(wheelVolume(0, ev(-3, false, 1)).delta).toBeCloseTo(0.01)
  })
})

describe('nudged', () => {
  it('stays in 0..1 on whole percents', () => {
    expect(nudged(0.995, 0.01)).toBe(1)
    expect(nudged(0.004, -0.01)).toBe(0)
    expect(nudged(0.5, 0.01)).toBe(0.51)
  })
})
