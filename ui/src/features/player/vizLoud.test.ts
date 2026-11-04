import { describe, expect, it } from 'vitest'
import { createLoudness, LOUD_STEP_MS, loudPos, loudText } from './vizLoud'

/** `secs` of play at `lufs`, updates every 33 ms as the engine's poll sends them. */
function play(m: ReturnType<typeof createLoudness>, lufs: number, secs: number, peak = 0.5) {
  for (let t = 0; t < secs * 1000; t += 33) m.push({ momentary: lufs, peak }, 33)
}

describe('loudness meter', () => {
  it('a steady level reads it everywhere, with no range', () => {
    const m = createLoudness()
    play(m, -20, 10)
    const r = m.reading()
    expect(r.momentary).toBe(-20)
    expect(r.short).toBeCloseTo(-20, 5)
    expect(r.integrated).toBeCloseTo(-20, 5)
    expect(r.range).toBeCloseTo(0, 5)
  })

  it('integrated: silence and parts 20 LU under are gated out, parts within 10 LU count', () => {
    const m = createLoudness()
    play(m, -20, 10)
    play(m, -120, 10)
    expect(m.reading().integrated).toBeCloseTo(-20, 5)
    play(m, -40, 10)
    expect(m.reading().integrated).toBeCloseTo(-20, 5)
    // 6 LU under: the mean of the two powers (as crates/dsp loudness.rs).
    const both = createLoudness()
    play(both, -20, 10)
    play(both, -26, 10)
    expect(both.reading().integrated!).toBeCloseTo(-22.04, 1)
  })

  it('loudness range: a loud half and a half 10 LU quieter spread 10 LU', () => {
    const m = createLoudness()
    play(m, -20, 30)
    play(m, -30, 30)
    expect(m.reading().range!).toBeGreaterThan(9.7)
    expect(m.reading().range!).toBeLessThan(10.3)
    // Short-term follows within 3 s.
    expect(m.reading().short).toBeCloseTo(-30, 5)
  })

  it('nothing yet: no integrated, no range until 3 s', () => {
    const m = createLoudness()
    expect(m.reading()).toEqual({ momentary: -120, short: -120, integrated: null, range: null, peak: -120, top: -120 })
    play(m, -20, 2)
    expect(m.reading().integrated).toBeCloseTo(-20, 5)
    expect(m.reading().range).toBeNull()
  })

  it('paused: shown, not counted; a long gap counts a moment only', () => {
    const m = createLoudness()
    for (let i = 0; i < 100; i++) m.push({ momentary: -10, peak: 0.5 }, 0)
    expect(m.reading().momentary).toBe(-10)
    expect(m.reading().integrated).toBeNull()
    m.push({ momentary: -10, peak: 0.5 }, 60_000)
    m.push({ momentary: -14, peak: 0.5 }, LOUD_STEP_MS * 30)
    // Two values at -10 (250 ms counted), three at -14 (with the 50 ms left): their powers' mean, not a minute of -10.
    expect(m.reading().integrated!).toBeCloseTo(-11.95, 1)
  })

  it('peak: now and the highest of the song; a new song starts over', () => {
    const m = createLoudness()
    m.push({ momentary: -20, peak: 0.5 }, 33)
    m.push({ momentary: -20, peak: 0.25 }, 33)
    expect(m.reading().peak).toBeCloseTo(-12.04, 2)
    expect(m.reading().top).toBeCloseTo(-6.02, 2)
    m.reset()
    expect(m.reading().top).toBe(-120)
    expect(m.reading().integrated).toBeNull()
  })

  it('bars and numbers', () => {
    expect(loudPos(-48)).toBe(0)
    expect(loudPos(-24)).toBe(0.5)
    expect(loudPos(3)).toBe(1)
    expect(loudPos(null)).toBe(0)
    expect(loudText(-14.23)).toBe('−14.2')
    expect(loudText(-0.01)).toBe('0.0')
    expect(loudText(6.25)).toBe('6.3')
    expect(loudText(-120)).toBe('—')
    expect(loudText(null)).toBe('—')
  })
})
