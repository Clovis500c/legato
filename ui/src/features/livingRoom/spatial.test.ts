import { describe, expect, it } from 'vitest'
import { nextBox, type Box } from './spatial'

// A grid: two rows of three, 100 wide, 50 tall.
const grid: Box[] = [0, 1].flatMap((r) => [0, 1, 2].map((c) => ({ x: c * 120, y: r * 70, w: 100, h: 50 })))

describe('arrow navigation', () => {
  it('moves along its row or column', () => {
    expect(nextBox(grid, 0, 'right')).toBe(1)
    expect(nextBox(grid, 1, 'right')).toBe(2)
    expect(nextBox(grid, 1, 'down')).toBe(4)
    expect(nextBox(grid, 4, 'up')).toBe(1)
    expect(nextBox(grid, 4, 'left')).toBe(3)
  })
  it('stays when nothing lies that way', () => {
    expect(nextBox(grid, 0, 'left')).toBeNull()
    expect(nextBox(grid, 0, 'up')).toBeNull()
    expect(nextBox(grid, 5, 'down')).toBeNull()
    expect(nextBox([], 0, 'down')).toBeNull()
  })
  it('prefers staying in line over a nearer box off to the side', () => {
    const boxes: Box[] = [
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 20, y: 300, w: 100, h: 50 },
      { x: 400, y: 60, w: 100, h: 50 },
    ]
    expect(nextBox(boxes, 0, 'down')).toBe(1)
  })
})
