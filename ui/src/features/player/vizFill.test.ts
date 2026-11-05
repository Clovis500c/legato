import { describe, expect, it } from 'vitest'
import { fillFor, type Stops } from './vizFill'
import { gradientStops, hueRgb } from './vizStops'

const two: Stops = [
  [0, 'blue'],
  [1, 'red'],
]
const ring = { r0: 70, len: 30 }

describe('visualizer gradient', () => {
  it('by level runs from the bottom up, from the middle out for the mirror', () => {
    expect(fillFor('level', 'bars', 300, 100, two)).toEqual({ kind: 'linear', x0: 0, y0: 100, x1: 0, y1: 0, stops: two })
    expect(fillFor('level', 'led', 300, 100, two)).toMatchObject({ y0: 100, y1: 0 })
    expect(fillFor('level', 'mirror', 300, 100, two)).toEqual({
      kind: 'linear',
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 100,
      stops: [
        [0, 'red'],
        [0.5, 'blue'],
        [0.5, 'blue'],
        [1, 'red'],
      ],
    })
  })

  it('along frequency runs left to right, every straight look alike', () => {
    for (const look of ['bars', 'mirror', 'peaks', 'wave', 'led'] as const) expect(fillFor('frequency', look, 300, 100, two)).toEqual({ kind: 'linear', x0: 0, y0: 0, x1: 300, y1: 0, stops: two })
  })

  it('the ring: out from the cover, or clockwise from the bottom where its lows are', () => {
    expect(fillFor('level', 'radial', 200, 200, two, ring)).toEqual({ kind: 'radial', x: 100, y: 100, r0: 70, r1: 100, stops: two })
    expect(fillFor('frequency', 'radial', 200, 200, two, ring)).toEqual({
      kind: 'conic',
      x: 100,
      y: 100,
      start: Math.PI / 2,
      stops: [
        [0, 'blue'],
        [0.5, 'red'],
        [0.5, 'red'],
        [1, 'blue'],
      ],
    })
  })

  it('none, the particles, the needles, the spectrogram, the scopes and the loudness meter keep their colours', () => {
    expect(fillFor('none', 'bars', 300, 100, two)).toBeNull()
    expect(fillFor('level', 'particles', 300, 100, two)).toBeNull()
    expect(fillFor('level', 'vu', 300, 100, two)).toBeNull()
    expect(fillFor('level', 'ppm', 300, 100, two)).toBeNull()
    expect(fillFor('level', 'terrain', 300, 100, two)).toBeNull()
    expect(fillFor('level', 'plugin', 300, 100, two)).toBeNull()
    expect(fillFor('level', 'preset', 300, 100, two)).toBeNull()
    expect(fillFor('frequency', 'spectrogram', 300, 100, two)).toBeNull()
    expect(fillFor('level', 'loudness', 300, 100, two)).toBeNull()
    expect(fillFor('level', 'scope', 300, 100, two)).toBeNull()
    expect(fillFor('frequency', 'vectorscope', 300, 100, two)).toBeNull()
    expect(fillFor('level', 'bars', 300, 100, [])).toBeNull()
  })

  it('a meter warms to the alarm red at the top; the prism runs red to violet', () => {
    const level = gradientStops('level', '#111111', '#d93a2b', false)
    expect(level.map(([p]) => p)).toEqual([0, 0.55, 0.8, 1])
    expect(level[0][1]).toBe('#111111')
    expect(level[3][1]).toBe('#d93a2b')
    const prism = gradientStops('frequency', '#111111', '#d93a2b', true)
    expect(prism).toHaveLength(7)
    expect(prism[0][0]).toBe(0)
    expect(prism[6][0]).toBe(1)
    expect(new Set(prism.map(([, c]) => c)).size).toBe(7)
    expect(gradientStops('none', '#111111', '#d93a2b', true)).toEqual([])
    expect([hueRgb(0), hueRgb(120), hueRgb(240)]).toEqual([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ])
  })
})
