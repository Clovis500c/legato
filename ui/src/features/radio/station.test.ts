import { describe, expect, it } from 'vitest'
import { isStation, stationTrack } from './station'

describe('a radio station as a track', () => {
  const s = { id: 'a1', name: 'Jazz FM', url: 'https://jazz.example/live', codec: 'MP3', bitrate: 128, country: 'UK', tags: [] }

  it('plays from its address, as an endless stream with no length', () => {
    const t = stationTrack(s)
    expect(t.ids.server).toBe('radio:https://jazz.example/live')
    expect(t.title).toBe('Jazz FM')
    expect(t.artist).toBe('UK · MP3 128 kbit/s')
    expect(t.durationMs).toBeNull()
    expect(t.id).toBeLessThan(0)
    expect(isStation(t)).toBe(true)
  })

  it('is not a server song of a signed-in server', () => {
    expect(isStation({ ids: { server: 's1a2b3c4d:99' } })).toBe(false)
    expect(isStation({ ids: {} })).toBe(false)
  })
})
