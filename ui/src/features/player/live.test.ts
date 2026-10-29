import { describe, expect, it } from 'vitest'
import { NEUTRAL } from './effects'
import { energy, frameSettings, parseLive, punch } from './live'
import { follow } from './pulse'

const YT = 'https://www.youtube.com'
const levels = { fast: -12, momentary: -12, short: -14, peak: 0.8, gain: 1.5 }

describe('live processing', () => {
  it('takes only live.js messages from YouTube', () => {
    expect(parseLive(YT, JSON.stringify({ musicApp: 'live', levels }))?.levels).toEqual(levels)
    expect(parseLive(YT, JSON.stringify({ musicApp: 'live', attached: false, error: 'blocked' }))).toMatchObject({ attached: false, error: 'blocked' })
    expect(parseLive('https://evil.example', JSON.stringify({ musicApp: 'live', levels }))).toBeNull()
    expect(parseLive(YT, JSON.stringify({ event: 'infoDelivery', info: { musicApp: 'live' } }))).toBeNull()
    expect(parseLive(YT, '{"musicApp":"live"')).toBeNull()
    expect(parseLive(YT, { musicApp: 'live' })).toBeNull()
  })

  it('leaves YouTube alone unless a feature needs it and it is allowed', () => {
    const wish = { on: true, ends: false, listen: false, adaptive: true, targetLufs: -14, bands: true, youtube: true, effects: NEUTRAL }
    expect(frameSettings(wish)).toEqual({ on: true, listen: false, adaptive: true, targetLufs: -14, bands: true })
    // Early ends alone: YouTube only listens.
    expect(frameSettings({ ...wish, on: false, ends: true, listen: true })).toMatchObject({ on: true, listen: true })
    expect(frameSettings({ ...wish, ends: true, youtube: false }).on).toBe(false)
    expect(frameSettings({ ...wish, youtube: false }).on).toBe(false)
    expect(frameSettings({ ...wish, on: false }).on).toBe(false)
  })

  it('turns loudness into 0..1', () => {
    expect(energy(null)).toBe(0)
    expect(energy({ ...levels, momentary: -120 })).toBe(0)
    expect(energy({ ...levels, momentary: -24 })).toBe(0.5)
    expect(energy({ ...levels, momentary: 0 })).toBe(1)
  })

  it('swells on hits, not on steady sound', () => {
    const steady = { ...levels, fast: -14, momentary: -14, short: -14 }
    const hit = { ...steady, fast: -8 }
    expect(punch(hit)).toBeGreaterThan(punch(steady) + 0.4)
    expect(punch({ ...steady, fast: -30 })).toBeLessThan(punch(steady))
    expect(punch({ ...steady, momentary: -90 })).toBe(0)
    expect(punch(null)).toBe(0)
  })

  it('pulses up fast and settles slower', () => {
    const up = follow(0, 1, 0.05)
    const down = 1 - follow(1, 0, 0.05)
    expect(up).toBeGreaterThan(0.6)
    expect(down).toBeLessThan(0.2)
    expect(follow(0.5, 0.5, 1)).toBe(0.5)
  })
})
