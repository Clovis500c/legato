import { describe, expect, it } from 'vitest'
import { paletteOf } from './coverPalette'

/** A picture's RGBA bytes: `n` pixels of each colour. */
function picture(...parts: [number, [number, number, number]][]) {
  const out: number[] = []
  for (const [n, [r, g, b]] of parts) for (let i = 0; i < n; i++) out.push(r, g, b, 255)
  return Uint8ClampedArray.from(out)
}

/** The palette in whole numbers (means of equal pixels may miss by a rounding). */
const palette = (data: ArrayLike<number>, count?: number) => paletteOf(data, count).map((c) => c.map(Math.round))

describe('cover palette', () => {
  it('gives the colours of a picture, the most present first', () => {
    const navy: [number, number, number] = [20, 40, 110]
    const sun: [number, number, number] = [240, 190, 70]
    const teal: [number, number, number] = [40, 130, 140]
    expect(palette(picture([300, navy], [150, sun], [100, teal]))).toEqual([navy, sun, teal])
  })

  it('leaves out greys, black, white and see-through pixels', () => {
    expect(palette(picture([200, [128, 128, 128]], [100, [0, 0, 0]], [100, [255, 255, 255]]))).toEqual([])
    const clear = Uint8ClampedArray.from([255, 0, 0, 0, 255, 0, 0, 0])
    expect(palette(clear)).toEqual([])
    // A grey picture with a red dot: the red alone.
    expect(palette(picture([500, [120, 120, 120]], [5, [220, 30, 30]]))).toEqual([[220, 30, 30]])
  })

  it('keeps one of two close colours, drops the barely there, and stops at the count', () => {
    // Two oranges a slice apart but close: one.
    const one = palette(picture([200, [230, 120, 40]], [200, [235, 150, 40]]))
    expect(one).toHaveLength(1)
    // A colour under 8 % of the main one's weight: left out.
    expect(palette(picture([1000, [30, 60, 200]], [40, [200, 40, 40]]))).toHaveLength(1)
    const many = palette(picture([100, [220, 30, 30]], [95, [30, 200, 40]], [80, [30, 60, 220]], [70, [230, 220, 40]], [60, [200, 40, 200]]), 3)
    expect(many).toEqual([
      [220, 30, 30],
      [30, 200, 40],
      [30, 60, 220],
    ])
  })
})
