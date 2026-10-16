import { describe, expect, it } from 'vitest'
import { clampWidth, gripCorner, MIN_WIDTH, nearestSpot, resized, spotPosition } from './snap'

const view = { w: 1360, h: 860 }
const card = { w: 356, h: 268 }
const inset = { top: 64, right: 24, bottom: 104, left: 24 }

describe('spotPosition', () => {
  it('corners and edge middles stay inside the free area', () => {
    expect(spotPosition('br', view, card, inset)).toEqual({ x: 1360 - 24 - 356, y: 860 - 104 - 268 })
    expect(spotPosition('tl', view, card, inset)).toEqual({ x: 24, y: 64 })
    expect(spotPosition('t', view, card, inset)).toEqual({ x: Math.round((24 + 980) / 2), y: 64 })
    expect(spotPosition('l', view, card, inset)).toEqual({ x: 24, y: Math.round((64 + 488) / 2) })
  })

  it('a card too big for the window keeps its corner on screen', () => {
    expect(spotPosition('br', { w: 300, h: 300 }, card, inset)).toEqual({ x: 24, y: 64 })
  })
})

describe('nearestSpot', () => {
  it('settles in the closest spot', () => {
    expect(nearestSpot({ x: 30, y: 70 }, { x: 0, y: 0 }, view, card, inset)).toBe('tl')
    expect(nearestSpot({ x: 900, y: 450 }, { x: 0, y: 0 }, view, card, inset)).toBe('br')
    expect(nearestSpot({ x: 500, y: 80 }, { x: 0, y: 0 }, view, card, inset)).toBe('t')
  })

  it('a flick carries it toward where it was thrown', () => {
    // Dropped near top-left but thrown right fast.
    expect(nearestSpot({ x: 100, y: 70 }, { x: 6, y: 0 }, view, card, inset)).toBe('tr')
  })
})

describe('resize', () => {
  it('never below YouTube minimum, never past 60 % of the window', () => {
    expect(clampWidth(100, view)).toBe(MIN_WIDTH)
    expect(clampWidth(5000, view)).toBe(816)
  })

  it('grip faces the middle, dragging it outward grows the card', () => {
    expect(gripCorner('br')).toEqual({ left: true, top: true })
    expect(gripCorner('tl')).toEqual({ left: false, top: false })
    expect(resized(400, -50, 'br', view)).toBe(450)
    expect(resized(400, 50, 'tl', view)).toBe(450)
    expect(resized(400, 25, 'b', view)).toBe(450)
  })
})
