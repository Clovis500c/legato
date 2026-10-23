import { describe, expect, it } from 'vitest'
import type { FadeSettings } from '../../shared/theme/theme'
import { curvePath, demoGain, demoLength, effectiveFade, fadeGain, NO_FADE, shape, type Fade } from './fade'

const simple = (s: number): Fade => ({ ...NO_FADE, out: s, in: s })

describe('fadeGain', () => {
  const dur = 200_000
  it('off at 0 seconds, full volume mid-track', () => {
    expect(fadeGain(199_000, dur, simple(0), true)).toBe(1)
    expect(fadeGain(100_000, dur, simple(5), true)).toBe(1)
  })

  it('fades in only after an automatic change, fades out at the end', () => {
    expect(fadeGain(0, dur, simple(5), true)).toBe(0)
    expect(fadeGain(0, dur, simple(5), false)).toBe(1)
    expect(fadeGain(2500, dur, simple(5), true)).toBeCloseTo(0.5)
    expect(fadeGain(dur - 2500, dur, simple(5), false)).toBeCloseTo(0.5)
    expect(fadeGain(dur, dur, simple(5), false)).toBe(0)
  })

  it('short or unknown-length tracks never fade out', () => {
    expect(fadeGain(9000, 9500, simple(5), false)).toBe(1)
    expect(fadeGain(9000, null, simple(5), false)).toBe(1)
  })

  it('out and in have their own length and shape', () => {
    const f: Fade = { ...NO_FADE, out: 8, in: 2, outCurve: 'exp', inCurve: 'linear' }
    expect(fadeGain(1000, dur, f, true)).toBeCloseTo(0.5)
    // 4 s left of 8: exponential is already down to 1/8.
    expect(fadeGain(dur - 4000, dur, f, false)).toBeCloseTo(0.125)
    expect(fadeGain(dur - 9000, dur, f, false)).toBe(1)
  })
})

describe('shape', () => {
  it('every curve goes 0 → 1 and stays in range', () => {
    for (const c of ['scurve', 'linear', 'equal', 'exp', 'log'] as const) {
      expect(shape(c, 0)).toBeCloseTo(0)
      expect(shape(c, 1)).toBeCloseTo(1)
      expect(shape(c, -1)).toBeCloseTo(0)
      expect(shape(c, 2)).toBeCloseTo(1)
    }
  })

  it('equal power keeps loudness: out² + in² = 1', () => {
    for (const x of [0.1, 0.5, 0.8]) expect(shape('equal', x) ** 2 + shape('equal', 1 - x) ** 2).toBeCloseTo(1)
  })
})

it('simple mode ignores the advanced fields', () => {
  const fade: FadeSettings = { advanced: false, out: 2, in: 9, outCurve: 'log', inCurve: 'exp', skip: true, pause: 400 }
  expect(effectiveFade({ crossfade: 4, fade })).toEqual({ ...simple(4), skip: true })
  expect(effectiveFade({ crossfade: 4, fade: { ...fade, advanced: true } })).toEqual({ out: 2, in: 9, outCurve: 'log', inCurve: 'exp', skip: true, pause: 400 })
})

it('demo: fade out, a short silence, fade in', () => {
  const f = simple(2)
  expect(demoGain(0, f)).toBe(1)
  expect(demoGain(1, f)).toBeCloseTo(0.5)
  expect(demoGain(2.3, f)).toBe(0)
  expect(demoGain(demoLength(f), f)).toBe(1)
})

it('curve path runs from start to end point', () => {
  const d = curvePath('linear', 10, 110, 100, 0, 4)
  expect(d.startsWith('M10.0,100.0')).toBe(true)
  expect(d.endsWith('110.0,0.0')).toBe(true)
  const down = curvePath('linear', 10, 110, 100, 0, 4, true)
  expect(down.startsWith('M10.0,0.0')).toBe(true)
  expect(down.endsWith('110.0,100.0')).toBe(true)
})
