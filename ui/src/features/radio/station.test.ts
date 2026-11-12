import { describe, expect, it } from 'vitest'
import { isStation, stationQueue, stationTrack } from './station'

describe('a radio station as a track', () => {
  const s = { id: 'a1', name: 'Jazz FM', url: 'https://jazz.example/live', codec: 'MP3', bitrate: 128, country: 'UK', tags: [], favicon: 'https://cdn.jazz.net/logo.png' }

  it('plays from its address, as an endless stream with no length', () => {
    const t = stationTrack(s)
    expect(t.ids.server).toBe('radio:https://jazz.example/live')
    expect(t.title).toBe('Jazz FM')
    expect(t.artist).toBe('UK · MP3 128 kbit/s')
    expect(t.durationMs).toBeNull()
    expect(t.id).toBeLessThan(0)
    expect(isStation(t)).toBe(true)
    // Its icon is the cover everywhere a track shows one (the player, Up next, the mini player).
    expect(t.art).toBe('https://cdn.jazz.net/logo.png')
    expect(stationTrack({ ...s, favicon: '' }).art).toBeNull()
  })

  it('is not a server song of a signed-in server', () => {
    expect(isStation({ ids: { server: 's1a2b3c4d:99' } })).toBe(false)
    expect(isStation({ ids: {} })).toBe(false)
  })
})

describe('a station started from a list', () => {
  const at = (n: number) => ({ id: `s${n}`, name: `Station ${n}`, url: `https://r${n}.example/live`, codec: 'MP3', bitrate: 128, country: 'FR', tags: [], favicon: '' })

  it('queues the whole list from that station, so Next and Previous reach its neighbours', () => {
    const q = stationQueue([at(1), at(2), at(3)], at(2))
    expect(q.tracks.map((t) => t.title)).toEqual(['Station 1', 'Station 2', 'Station 3'])
    expect(q.index).toBe(1)
  })

  it('plays alone when the list does not hold it', () => {
    expect(stationQueue([at(1)], at(9))).toMatchObject({ index: 0, tracks: [{ title: 'Station 9' }] })
  })
})
