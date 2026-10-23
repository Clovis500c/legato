import { describe, expect, it } from 'vitest'
import { searchShift } from './searchShift'

describe('searchShift', () => {
  it('moves the bar over the cover, never out of its box', () => {
    expect(searchShift(500, { left: 300, width: 1000 }, 600)).toBe(-200)
    expect(searchShift(800, { left: 300, width: 1000 }, 600)).toBe(0)
    expect(searchShift(1000, { left: 300, width: 1000 }, 600)).toBe(200)
    expect(searchShift(100, { left: 300, width: 1000 }, 600)).toBe(-200)
    expect(searchShift(100, { left: 300, width: 500 }, 600)).toBe(0)
  })
})
