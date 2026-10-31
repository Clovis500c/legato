import { describe, expect, it } from 'vitest'
import { createFlashLimiter, swingsPerSecond } from './flash'

const FPS = 60
/** `hz` flashes a second between 0 and 1 for `secs`, through the limiter. */
function strobe(hz: number, secs: number, max = 3) {
  const lim = createFlashLimiter(max)
  const raw: number[] = []
  const out: number[] = []
  for (let i = 0; i < secs * FPS; i++) {
    const t = i / FPS
    const x = Math.floor(t * hz * 2) % 2 === 0 ? 1 : 0
    raw.push(x)
    out.push(lim.step(x, t))
  }
  return { raw, out }
}

describe('flash limiter', () => {
  it('a 10 Hz strobe flashes at most 3 times a second after it', () => {
    const { raw, out } = strobe(10, 5)
    // The test signal itself is a strobe (20 swings a second)...
    expect(swingsPerSecond(raw, FPS)).toBeGreaterThan(18)
    // ... what comes out has 3 flashes (a rise and a fall each) in any second.
    expect(swingsPerSecond(out, FPS)).toBeLessThanOrEqual(6)
  })

  it('also at 4, 6 and 30 Hz, and with one flash a second allowed', () => {
    for (const hz of [4, 6, 30]) expect(swingsPerSecond(strobe(hz, 4).out, FPS)).toBeLessThanOrEqual(6)
    expect(swingsPerSecond(strobe(10, 5, 1).out, FPS)).toBeLessThanOrEqual(2)
  })

  it('the screen stays near an extreme instead of flipping', () => {
    const { out } = strobe(10, 5)
    // Few crossings of the middle in the last 2 s, steady state (3 flashes a second = 6 crossings, at most).
    let crossings = 0
    for (let i = out.length - 2 * FPS + 1; i < out.length; i++) if (out[i] > 0.5 !== out[i - 1] > 0.5) crossings++
    expect(crossings).toBeLessThanOrEqual(12)
  })

  it('music-like changes pass untouched: 2 kicks a second, slow swells, small ripples', () => {
    const lim = createFlashLimiter(3)
    for (let i = 0; i < 4 * FPS; i++) {
      const t = i / FPS
      const kick = Math.floor(t * 4) % 2 === 0 ? 0.8 : 0.2
      expect(lim.step(kick, t)).toBe(kick)
    }
    const slow = createFlashLimiter(3)
    for (let i = 0; i < 4 * FPS; i++) {
      const t = i / FPS
      const x = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 0.8)
      expect(slow.step(x, t)).toBe(x)
    }
    const ripple = createFlashLimiter(3)
    for (let i = 0; i < 2 * FPS; i++) {
      const x = i % 2 ? 0.55 : 0.5
      expect(ripple.step(x, i / FPS)).toBe(x)
    }
  })

  it('lets go once the budget is back', () => {
    const lim = createFlashLimiter(3)
    for (let i = 0; i < FPS; i++) lim.step(i % 6 < 3 ? 1 : 0, i / FPS)
    // A second of calm, then a swing is allowed again.
    for (let i = 0; i < 2 * FPS; i++) lim.step(0.2, 1 + i / FPS)
    expect(lim.step(0.9, 3.1)).toBe(0.9)
  })
})
