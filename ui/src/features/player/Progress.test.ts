import { describe, expect, it, vi } from 'vitest'
import { extrapolate, positionNow, quantize } from './Progress'
import { usePlayer } from './store'

describe('positionNow', () => {
  it('waits for the source at a new song’s start, then runs from its reports', () => {
    let now = 1000
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    usePlayer.setState((s) => ({ playId: s.playId + 1, positionMs: 0, playing: true, durationMs: 200_000 }))
    now += 25_000
    // Regression guard: a YouTube start Google refused showed 0:25, nothing playing (2026-11-01).
    expect(positionNow()).toBe(0)
    usePlayer.setState({ positionMs: 250 })
    now += 500
    expect(positionNow()).toBe(750)
    clock.mockRestore()
  })
})

describe('quantize', () => {
  it('steps down to what the display shows', () => {
    expect(quantize(54_999, 1000)).toBe(54_000)
    expect(quantize(54_000, 1000)).toBe(54_000)
    expect(quantize(10_130, 86)).toBe(10_062)
    expect(quantize(1234.6, 1)).toBe(1235)
  })
})

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
