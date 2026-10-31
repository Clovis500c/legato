import { describe, expect, it } from 'vitest'
import { createVu, holdLed, LED_HOLD, stepNeedle, vuOf, vuPos, VU_MAX, VU_MIN, type Needle } from './vizVu'

/** A step from 0 to 1, in 1 ms steps: time to 99 % and the highest value reached. */
function step(dt: number, until = 1.5) {
  const n: Needle = { x: 0, v: 0 }
  let t99 = -1
  let peak = 0
  for (let i = 1; i <= Math.round(until / dt); i++) {
    const t = i * dt
    stepNeedle(n, 1, dt)
    if (t99 < 0 && n.x >= 0.99) t99 = t
    peak = Math.max(peak, n.x)
  }
  return { t99, peak, end: n.x }
}

describe('VU needle', () => {
  it('a step reaches 99 % in 300 ms, 1 to 1.5 % over, then settles', () => {
    const r = step(0.001)
    expect(r.t99 * 1000).toBeGreaterThan(290)
    expect(r.t99 * 1000).toBeLessThan(310)
    expect(r.peak - 1).toBeGreaterThan(0.01)
    expect(r.peak - 1).toBeLessThan(0.015)
    expect(r.end).toBeCloseTo(1, 4)
  })

  it('moves alike at any frame rate (exact steps)', () => {
    const a = step(1 / 30, 0.9)
    const b = step(1 / 120, 0.9)
    expect(a.end).toBeCloseTo(b.end, 6)
  })

  it('stays put at its target and never blows up on a long pause', () => {
    const n: Needle = { x: 0.4, v: 0 }
    stepNeedle(n, 0.4, 0.5)
    expect(n.x).toBeCloseTo(0.4, 9)
    stepNeedle(n, 1, 120)
    expect(n.x).toBeCloseTo(1, 9)
  })
})

describe('VU level', () => {
  it('a sine at 14 dB under full scale RMS reads 0 VU', () => {
    // A full-scale sine's RMS reads -3 dB: 11 dB under that is -14.
    expect(vuOf(-14)).toBeCloseTo(0, 5)
    expect(vuOf(-4)).toBeCloseTo(10, 5)
  })

  it('reads the window RMS, not the bands (overlapping bass bands would read hot)', () => {
    const vu = createVu(false)
    vu.frame([-14, -14])
    for (let i = 0; i < 400; i++) vu.step(1 / 60)
    expect(vu.step(1 / 60).pos[0]).toBeCloseTo(vuPos(0), 3)
  })

  it('silence sits under the scale; the scale ends map to 0 and 1', () => {
    expect(vuOf(-120)).toBeLessThan(VU_MIN)
    expect(vuPos(VU_MIN)).toBe(0)
    expect(vuPos(VU_MAX)).toBe(1)
    expect(vuPos(0)).toBeCloseTo(20 / 23, 9)
  })

  it('a steady 0 VU tone brings the needle to 99 % of its place in 300 ms', () => {
    const vu = createVu(false)
    vu.frame([-14, -14])
    const goal = vuPos(0)
    let at = -1
    for (let t = 0.001; t < 1; t += 0.001) {
      const { pos } = vu.step(0.001)
      if (at < 0 && pos[0] >= 0.99 * goal) at = t
    }
    expect(at * 1000).toBeGreaterThan(290)
    expect(at * 1000).toBeLessThan(310)
  })

  it('calm: the needle drifts, slower than normal', () => {
    const fast = createVu(false)
    const slow = createVu(true)
    fast.frame([-14, -14])
    slow.frame([-14, -14])
    let a = fast.step(0)
    let b = slow.step(0)
    for (let i = 0; i < 30; i++) {
      a = fast.step(0.01)
      b = slow.step(0.01)
    }
    expect(b.pos[0]).toBeLessThan(a.pos[0] * 0.6)
  })
})

describe('peak LED', () => {
  it('lights at +3 VU and holds a second after the last one', () => {
    expect(holdLed(0, 2.9, 0.016)).toBe(0)
    expect(holdLed(0, 3, 0.016)).toBe(LED_HOLD)
    expect(holdLed(LED_HOLD, -10, 0.5)).toBeCloseTo(0.5, 9)
    expect(holdLed(0.2, -10, 0.5)).toBe(0)
  })

  it('on/off at most once a second, even for a strobing level', () => {
    const vu = createVu(false)
    const loud = [-3, -3]
    const quiet = [-120, -120]
    let last = false
    let flips = 0
    // A 10 Hz strobe for 2 s at 60 fps.
    for (let f = 0; f < 120; f++) {
      const on = Math.floor(f / 3) % 2 === 0
      vu.frame(on ? loud : quiet)
      const s = vu.step(1 / 60)
      if (s.on[0] !== last) flips++
      last = s.on[0]
    }
    // Lit once, held through the strobe: a single change in 2 s.
    expect(flips).toBeLessThanOrEqual(2)
  })

  it('silence lets the needles and LEDs rest', () => {
    const vu = createVu(false)
    vu.frame([-3, -3])
    for (let i = 0; i < 60; i++) vu.step(1 / 60)
    vu.silence()
    let s = vu.step(1 / 60)
    expect(s.resting).toBe(false)
    for (let i = 0; i < 400; i++) s = vu.step(1 / 60)
    expect(s.resting).toBe(true)
  })
})
