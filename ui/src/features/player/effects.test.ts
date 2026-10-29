import { describe, expect, it } from 'vitest'
import { cleanEffects, NEUTRAL, neutral, PRESETS, rates, songKey } from './effects'

describe('effects', () => {
  it('rates: speed moves both, tempo only time, pitch only pitch; bypass is 1 : 1', () => {
    expect(rates({ ...NEUTRAL, speed: 0.8 })).toEqual([0.8, 0.8])
    expect(rates({ ...NEUTRAL, tempo: 1.2 })).toEqual([1.2, 1])
    expect(rates({ ...NEUTRAL, pitch: 12 })).toEqual([1, 2])
    expect(rates({ ...NEUTRAL, speed: 0.8, on: false })).toEqual([1, 1])
  })

  it('neutral: untouched or bypassed', () => {
    expect(neutral(NEUTRAL)).toBe(true)
    expect(neutral({ ...NEUTRAL, bass: 3 })).toBe(false)
    expect(neutral({ ...NEUTRAL, bass: 3, on: false })).toBe(true)
    // Speed 1.25 × tempo 0.8: time back to 1, pitch still up.
    expect(neutral({ ...NEUTRAL, speed: 1.25, tempo: 0.8 })).toBe(false)
    expect(PRESETS.every((p) => !neutral(p.effects))).toBe(true)
  })

  it('cleanEffects: missing, wrong or out-of-range fields become neutral or clamped', () => {
    expect(cleanEffects(null)).toEqual(NEUTRAL)
    expect(cleanEffects({})).toEqual(NEUTRAL)
    const e = cleanEffects({ speed: 9, pitch: 'x', eq: [30, null], reverb: { mix: 0.5 }, space: { on: true, azimuth: 500 }, on: false })
    expect(e.speed).toBe(2.5)
    expect(e.pitch).toBe(0)
    expect(e.eq).toEqual([24, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    // Older 5-band edit: same curve on the 10 bands (effects.rs older_five_band_edits_keep_their_curve).
    const old = cleanEffects({ eq: [6, 0, -6, 0, 12] }).eq
    expect([old[0], old[3], old[4], old[5], old[7], old[9]]).toEqual([6, 0, -3, -6, 0, 12])
    expect(old[8]).toBeCloseTo(7.57, 1)
    expect(e.reverb).toEqual({ ...NEUTRAL.reverb, mix: 0.5 })
    expect(e.space.on).toBe(true)
    expect(e.space.azimuth).toBe(180)
    expect(e.on).toBe(false)
    // Saved edits round-trip.
    expect(cleanEffects(JSON.parse(JSON.stringify(PRESETS[1].effects)))).toEqual(PRESETS[1].effects)
  })

  it('songKey: library track, else video, else file; recommendations by their video', () => {
    expect(songKey({ trackId: 4, youtubeId: 'abc' })).toBe('t:4')
    expect(songKey({ trackId: -3, youtubeId: 'abc' })).toBe('yt:abc')
    expect(songKey({ path: 'C:\m\a.flac' })).toBe('f:C:\m\a.flac')
    expect(songKey({})).toBeNull()
    expect(songKey(null)).toBeNull()
  })
})
