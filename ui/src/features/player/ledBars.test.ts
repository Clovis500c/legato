import { describe, expect, it } from 'vitest'
import { atRest, CALM, capSegment, levelOf, litSegments, newBars, NORMAL, stepBars } from './ledBars'

const step = (b: ReturnType<typeof newBars>, to: number | undefined, secs: number, bal = NORMAL, fps = 60) => {
  for (let i = 0; i < Math.round(secs * fps); i++) stepBars(b, to === undefined ? undefined : [to], 1 / fps, bal)
}

describe('LED ballistics', () => {
  it('maps -78..-10 dB to empty..full', () => {
    expect([levelOf(-120), levelOf(-78), levelOf(-44), levelOf(-10), levelOf(0)]).toEqual([0, 0, 0.5, 1, 1])
  })

  it('rises fast and falls slower', () => {
    const b = newBars(1)
    stepBars(b, [1], 0.03, NORMAL)
    expect(b.level[0]).toBeCloseTo(1 - Math.exp(-1), 5)
    const down = newBars(1)
    down.level[0] = 1
    stepBars(down, undefined, 0.03, NORMAL)
    expect(1 - down.level[0]).toBeLessThan(b.level[0])
  })

  it('the peak holds for half a second, then falls faster and faster', () => {
    const b = newBars(1)
    step(b, 1, 0.3)
    const top = b.peak[0]
    expect(top).toBeGreaterThan(0.99)
    // The level drops to nothing: the cap stays put for 0.5 s after its last high...
    step(b, 0, 0.45)
    expect(b.peak[0]).toBe(top)
    step(b, 0, 0.1)
    expect(b.peak[0]).toBeLessThan(top)
    // ... then gravity: each 0.2 s covers more ground than the one before.
    const at = [b.peak[0]]
    for (let i = 0; i < 3; i++) {
      step(b, 0, 0.2)
      at.push(b.peak[0])
    }
    const drops = at.slice(1).map((v, i) => at[i] - v)
    expect(drops[1]).toBeGreaterThan(drops[0])
    expect(drops[2]).toBeGreaterThan(drops[1])
    // All the way down in the end, never under the level.
    step(b, 0, 2)
    expect(b.peak[0]).toBeCloseTo(0, 5)
  })

  it('a new high takes the cap along and holds again', () => {
    const b = newBars(1)
    step(b, 0.5, 1.5)
    const low = b.peak[0]
    step(b, 1, 0.2)
    expect(b.peak[0]).toBeGreaterThan(low)
    const high = b.peak[0]
    step(b, 0, 0.3)
    expect(b.peak[0]).toBe(high)
  })

  it('reduced motion is slower both ways and its cap sinks gently', () => {
    const calm = newBars(1)
    const normal = newBars(1)
    step(calm, 1, 0.1, CALM)
    step(normal, 1, 0.1, NORMAL)
    expect(calm.level[0]).toBeLessThan(normal.level[0])
    step(calm, 0, 2, CALM)
    step(normal, 0, 2, NORMAL)
    expect(calm.peak[0]).toBeGreaterThan(normal.peak[0])
  })

  it('rests when nothing is left', () => {
    const b = newBars(3)
    step(b, 1, 0.2)
    expect(atRest(b)).toBe(false)
    step(b, undefined, 4)
    expect(atRest(b)).toBe(true)
  })

  it('lights whole segments, and the cap never sits under them', () => {
    expect([litSegments(0, 10), litSegments(0.34, 10), litSegments(1, 10), litSegments(2, 10)]).toEqual([0, 3, 10, 10])
    expect(capSegment(0.62, 3, 10)).toBe(6)
    expect(capSegment(0.04, 0, 10)).toBe(0)
    expect(capSegment(0.1, 3, 10)).toBe(3)
    expect(capSegment(0, 0, 10)).toBe(0)
    expect(capSegment(1, 3, 10)).toBe(10)
  })
})
