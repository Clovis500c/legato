import { describe, expect, it } from 'vitest'
import { extrapolate } from './Progress'

describe('extrapolate', () => {
  it('moves on with time while playing, stays put when paused', () => {
    expect(extrapolate(10_000, 1000, 1250, true, 200_000)).toBe(10_250)
    expect(extrapolate(10_000, 1000, 5000, false, 200_000)).toBe(10_000)
  })

  it('never past the end, never backwards on clock skew', () => {
    expect(extrapolate(199_900, 0, 1000, true, 200_000)).toBe(200_000)
    expect(extrapolate(5000, 1000, 900, true, null)).toBe(5000)
  })
})
