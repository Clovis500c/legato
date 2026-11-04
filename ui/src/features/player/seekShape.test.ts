import { describe, expect, it } from 'vitest'
import { SHAPE_BARS, shapeBars, shapePath } from './seekShape'

describe('song shape', () => {
  it('takes the loudest point under each bar', () => {
    const points = Array.from({ length: 400 }, (_, i) => (i === 250 ? 255 : 51))
    const bars = shapeBars(points)
    expect(bars).toHaveLength(SHAPE_BARS)
    expect(bars[75]).toBe(1)
    expect(bars.filter((v) => v === 1)).toHaveLength(1)
    expect(bars[0]).toBeCloseTo(0.2)
  })

  it('keeps a silent stretch visible and gives nothing without points', () => {
    expect(shapeBars(new Array(400).fill(0), 4)).toEqual([0.12, 0.12, 0.12, 0.12])
    expect(shapeBars([])).toEqual([])
    // Fewer points than bars: each point under several bars.
    expect(shapeBars([0, 255], 4)).toEqual([0.12, 0.12, 1, 1])
  })

  it('draws each bar centred on the middle line', () => {
    expect(shapePath([1, 0.5], 16)).toBe('M0.2 0.00h0.6v16.00h-0.6zM1.2 4.00h0.6v8.00h-0.6z')
  })
})
