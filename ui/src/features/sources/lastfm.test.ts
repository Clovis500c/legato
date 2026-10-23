import { describe, expect, it } from 'vitest'
import { scrobbles, toScrobble } from './lastfmRules'

describe('Last.fm', () => {
  it('scrobbles real listens only, like the connector', () => {
    expect(scrobbles(25_000, 25_000)).toBe(false)
    expect(scrobbles(200_000, 100_000)).toBe(true)
    expect(scrobbles(200_000, 99_000)).toBe(false)
    expect(scrobbles(900_000, 240_000)).toBe(true)
    expect(scrobbles(null, 100_000)).toBe(false)
  })
  it('sends seconds', () => {
    expect(toScrobble({ artist: 'Kavinsky', title: 'Nightcall', album: 'OutRun', durationMs: 258_400 }, 1_800_000_000)).toEqual({ artist: 'Kavinsky', track: 'Nightcall', album: 'OutRun', durationS: 258, timestamp: 1_800_000_000 })
  })
})
