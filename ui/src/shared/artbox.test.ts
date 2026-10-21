import { describe, expect, it } from 'vitest'
import { clampRatio, contentBox, cropStyle, cropTo, frameAround, FULL, mayHaveBars } from './artbox'

// w × h image: black outside [x0, x1) × [y0, y1), gray art inside.
function frame(w: number, h: number, x0: number, x1: number, y0: number, y1: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const v = x >= x0 && x < x1 && y >= y0 && y < y1 ? 180 : 8
      d.set([v, v, v, 255], o)
    }
  return d
}

describe('contentBox', () => {
  it('cuts pillarbox bars: portrait art in a 16:9 frame', () => {
    const b = contentBox(frame(160, 90, 44, 116, 0, 90), 160, 90)
    expect(b.x * 160).toBe(45)
    expect(b.w * 160).toBe(70)
    expect(b.h).toBe(1)
  })

  it('cuts letterbox bars: 16:9 picture in a 4:3 frame', () => {
    const b = contentBox(frame(160, 120, 0, 160, 15, 105), 160, 120)
    expect(b.y * 120).toBe(16)
    expect(b.h * 120).toBe(88)
    expect(b.w).toBe(1)
  })

  it('keeps art that only looks dark: one-sided, or mostly black', () => {
    expect(contentBox(frame(160, 90, 30, 160, 0, 90), 160, 90)).toEqual(FULL)
    expect(contentBox(frame(160, 90, 70, 90, 0, 90), 160, 90)).toEqual(FULL)
    expect(contentBox(frame(16, 9, 0, 0, 0, 0), 16, 9)).toEqual(FULL)
    expect(contentBox(frame(160, 90, 0, 160, 0, 90), 160, 90)).toEqual(FULL)
  })

  it('very uneven bars: cuts the smaller one on both sides (only darkness goes)', () => {
    const b = contentBox(frame(160, 90, 10, 120, 0, 90), 160, 90)
    expect(b.x * 160).toBe(11)
    expect((b.x + b.w) * 160).toBe(149)
  })

  // 2026-10-20 report: off-center picture, uneven bars, a thin light line at each bar's inner edge, busy picture.
  it('cuts uneven bars and the light seams next to them', () => {
    const w = 320
    const h = 180
    const d = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = x < 72 || x >= 230 ? 6 : x === 72 || x === 229 ? 225 : 50 + ((x * 7 + y * 13) % 190)
        d.set([v, v, v, 255], (y * w + x) * 4)
      }
    const b = contentBox(d, w, h)
    expect(b.x * w).toBe(74)
    expect((b.x + b.w) * w).toBe(228)
    expect(b.y).toBe(0)
    expect(b.h).toBe(1)
  })

  it('cuts a thin white border around the frame, with or without bars inside', () => {
    const w = 160
    const h = 90
    const bordered = (inner: Uint8ClampedArray) => {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1) inner.set([250, 250, 250, 255], (y * w + x) * 4)
      return inner
    }
    const bars = contentBox(bordered(frame(w, h, 44, 116, 0, 90)), w, h)
    expect(bars.x * w).toBe(45)
    expect(bars.w * w).toBe(70)
    // No bars: only the border line goes.
    const plain = contentBox(bordered(frame(w, h, 0, 160, 0, 90)), w, h)
    expect(plain).toEqual({ x: 2 / w, y: 2 / h, w: (w - 4) / w, h: (h - 4) / h })
  })
})

describe('frameAround', () => {
  it('enlarges the 16:9 frame so the box fills the slot, and clips the rest', () => {
    // Pillarboxed 4:3 picture: middle 75 % of the frame width.
    const f = frameAround({ left: 100, top: 50, width: 400, height: 400 * (3 / 4) }, { x: 0.125, y: 0, w: 0.75, h: 1 })
    expect(f.width).toBeCloseTo(400 / 0.75)
    expect(f.height).toBeCloseTo(300)
    expect(f.left).toBeCloseTo(100 - 0.125 * (400 / 0.75))
    expect(f.top).toBeCloseTo(50)
    expect(f.clipPath).toBe('inset(0px 66.67px 0px 66.67px round 8px)')
  })

  it('whole frame in a 16:9 slot: no clipping', () => {
    expect(frameAround({ left: 0, top: 0, width: 320, height: 180 }, FULL)).toEqual({ left: 0, top: 0, width: 320, height: 180, clipPath: 'inset(0px 0px 0px 0px round 8px)' })
  })
})

describe('cropTo', () => {
  it('shows the whole box when the frame has its shape', () => {
    const box = { x: 0.25, y: 0, w: 0.5, h: 1 }
    expect(cropTo(box, 1280, 720, (0.5 * 1280) / 720)).toEqual(box)
  })

  it('cuts the long side around the center like object-fit: cover', () => {
    expect(cropTo(FULL, 1600, 900, 1)).toEqual({ x: (1 - 900 / 1600) / 2, y: 0, w: 900 / 1600, h: 1 })
    expect(cropTo(FULL, 900, 1600, 1)).toEqual({ x: 0, y: (1 - 900 / 1600) / 2, w: 1, h: 900 / 1600 })
  })

  it('places the image so only the crop shows', () => {
    expect(cropStyle({ x: 0.25, y: 0, w: 0.5, h: 1 })).toMatchObject({ width: '200%', height: '100%', left: '-50%', top: '0%' })
  })
})

describe('frame shape', () => {
  it('stays between a vertical and a wide video', () => {
    expect(clampRatio(0.2)).toBe(9 / 16)
    expect(clampRatio(4)).toBe(16 / 9)
    expect(clampRatio(0.8)).toBe(0.8)
  })

  it('only video frames are checked for bars', () => {
    expect(mayHaveBars('http://art.localhost/https%3A%2F%2Fi.ytimg.com%2Fvi%2Fabc%2Fmaxresdefault.jpg')).toBe(true)
    expect(mayHaveBars('http://art.localhost/https%3A%2F%2Flh3.googleusercontent.com%2Fx%3Dw1200-h1200')).toBe(false)
  })
})
