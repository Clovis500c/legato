import { describe, expect, it } from 'vitest'
import { bandAt } from './vizBeat'
import { BURST_GAP_S, createParticles, moodOf } from './vizParticles'

/** A seeded generator, 0 to 1. */
function random(seed = 5) {
  return () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32
}

/** Every dot's centre, diameter and opacity. */
function dots(p: ReturnType<typeof createParticles>) {
  const out: { x: number; y: number; size: number; alpha: number }[] = []
  p.each((x, y, size, alpha) => out.push({ x, y, size, alpha }))
  return out
}

describe('particles', () => {
  it('hold fewer dots in a smaller box', () => {
    const p = createParticles(random())
    p.size(1920, 1080)
    expect(p.cap).toBe(900)
    p.size(3840, 2160)
    expect(p.cap).toBe(900)
    // The strip under the cover.
    p.size(448, 48)
    expect(p.cap).toBe(60)
  })

  it('burst from the middle on a kick, more for a stronger one, and fly out', () => {
    const p = createParticles(random())
    p.size(1920, 1080)
    expect(p.burst(0, 12, 3)).toBe(true)
    const soft = p.count
    expect(soft).toBe(108)
    for (const d of dots(p)) expect(Math.hypot(d.x - 960, d.y - 540)).toBeLessThan(25)
    const strong = createParticles(random())
    strong.size(1920, 1080)
    strong.burst(0, 24, 3)
    expect(strong.count).toBe(216)
    // Out from the middle, slowing down.
    const spread = (q: ReturnType<typeof createParticles>) => dots(q).reduce((s, d) => s + Math.hypot(d.x - 960, d.y - 540), 0) / q.count
    const moved: number[] = []
    for (let k = 0; k < 30; k++) {
      p.step(1 / 30, 0, k / 30)
      if (k % 10 === 9) moved.push(spread(p))
    }
    expect(moved[0]).toBeGreaterThan(150)
    expect(moved[1] - moved[0]).toBeLessThan(moved[0])
    expect(moved[2] - moved[1]).toBeLessThan(moved[1] - moved[0])
  })

  it('burst at most 3 times a second, whatever the tempo', () => {
    const p = createParticles(random())
    p.size(1920, 1080)
    const bursts: number[] = []
    // A kick every 100 ms (the beat's shortest gap) for 5 s.
    for (let t = 0; t < 5; t += 0.1) if (p.burst(t, 12, 1)) bursts.push(t)
    for (let i = 3; i < bursts.length; i++) expect(bursts[i] - bursts[i - 3]).toBeGreaterThanOrEqual(1 - 1e-9)
    expect(bursts.length).toBeGreaterThanOrEqual(12)
    for (let i = 1; i < bursts.length; i++) expect(bursts[i] - bursts[i - 1]).toBeGreaterThanOrEqual(BURST_GAP_S - 1e-9)
  })

  it('trickle in with the level, never past the cap', () => {
    const p = createParticles(random())
    p.size(1920, 1080)
    for (let k = 0; k < 60; k++) p.trickle(1 / 60, 0, 1)
    expect(p.count).toBe(0)
    for (let k = 0; k < 60; k++) p.trickle(1 / 60, 1, 1)
    // 10 % of the cap a second, give or take the last one's rounding.
    expect(p.count).toBeGreaterThanOrEqual(89)
    expect(p.count).toBeLessThanOrEqual(90)
    for (let t = 0; t < 10; t += 0.1) {
      p.burst(t, 24, 1)
      p.trickle(0.1, 1, 1)
      expect(p.count).toBeLessThanOrEqual(900)
    }
    expect(p.count).toBe(900)
  })

  it('fade in and out, and are gone after their lives', () => {
    const p = createParticles(random())
    p.size(1920, 1080)
    p.trickle(1, 1, 2)
    // Born unseen.
    expect(p.count).toBe(90)
    expect(dots(p)).toHaveLength(0)
    p.step(0.06, 0, 0)
    expect(dots(p)).toHaveLength(90)
    expect(dots(p).every((d) => d.alpha > 0.4 && d.alpha <= 0.5 + 1e-6)).toBe(true)
    p.step(0.06, 0, 0.06)
    expect(dots(p).every((d) => d.alpha > 0.99)).toBe(true)
    for (let k = 0; k < 90; k++) p.step(1 / 30, 0, k / 30)
    expect(p.count).toBe(0)
  })

  it('drift with the mids, barely without them', () => {
    // One dot (followed by its index), the same start with the mids or without, for half a second.
    const travel = (seed: number, mids: number) => {
      const p = createParticles(random(seed))
      p.size(1920, 1080)
      p.trickle(1, 1 / 90 + 1e-6, 1)
      p.step(0.001, 0, 0)
      const [a] = dots(p)
      for (let k = 0; k < 15; k++) p.step(1 / 30, mids, k / 30)
      const [b] = dots(p)
      return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : null
    }
    let seen = 0
    for (let seed = 1; seed <= 8; seed++) {
      const still = travel(seed, 0)
      const moving = travel(seed, 1)
      if (still === null || moving === null) continue
      seen++
      // A trickled dot's own speed: under 12 px in half a second. The mids' push: about 27 px more, whichever way.
      expect(still).toBeLessThan(12)
      expect(moving).toBeGreaterThan(15)
    }
    expect(seen).toBeGreaterThanOrEqual(6)
  })

  it('leave the box and the screen when they fly off it', () => {
    const p = createParticles(random())
    p.size(448, 48)
    p.burst(0, 24, 1)
    const born = p.count
    expect(born).toBe(14)
    for (let k = 0; k < 20; k++) p.step(1 / 30, 0, k / 30)
    // Most flew out of a 48 px high strip in two thirds of a second.
    expect(p.count).toBeLessThan(born / 2)
    p.clear()
    expect(p.count).toBe(0)
  })

  it('read the mids and the level from a frame', () => {
    const quiet = moodOf(new Float32Array(61).fill(-120), [-120, -120])
    expect(quiet).toEqual({ mids: 0, level: 0 })
    const bands = new Float32Array(61).fill(-90)
    for (let i = bandAt(160, 61) + 1; i <= bandAt(2500, 61); i++) bands[i] = -45
    expect(moodOf(bands, [-25, -30])).toEqual({ mids: 0.5, level: 0.5 })
    expect(moodOf(new Float32Array(121).fill(-10), [-3, -3])).toEqual({ mids: 1, level: 1 })
  })
})
