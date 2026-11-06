import { describe, expect, it } from 'vitest'
import { DOWN_MS, retryWait } from './ytDown'

describe('ytDown', () => {
  it('waits longer each time, never past 2 min', () => {
    expect([0, 1, 2, 3].map(retryWait)).toEqual([5000, 10_000, 20_000, 40_000])
    expect(retryWait(5)).toBe(120_000)
    expect(retryWait(40)).toBe(120_000)
    expect(retryWait(-1)).toBe(5000)
  })

  it('gives a slow network time before calling the embed down', () => {
    expect(DOWN_MS).toBeGreaterThanOrEqual(8000)
  })
})
