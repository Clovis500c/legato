import { describe, expect, it } from 'vitest'
import type { Pickup } from '../../shared/api'
import { worthOffering } from './pickupOffer'

const track = { title: 'Song', artist: 'Band', album: null, durationMs: 200_000, isrc: null, ids: { youtube: 'abc' }, art: null, musicness: null }
const pickup: Pickup = { deviceName: 'Office', trackId: null, track, positionMs: 61_000, at: 2_000 }

describe('pick up on another PC', () => {
  it('offers a newer song than this PC played last', () => {
    expect(worthOffering(pickup, { at: 1_000 })).toBe(true)
    expect(worthOffering(pickup, { at: 3_000 })).toBe(false)
  })

  it('counts a session saved without its time, or none, as older', () => {
    expect(worthOffering(pickup, { ids: [1], index: 0 })).toBe(true)
    expect(worthOffering(pickup, null)).toBe(true)
  })

  it('skips a song this PC cannot play', () => {
    const local = { ...pickup, track: { ...track, ids: { spotify: 'x' } } }
    expect(worthOffering(local, null)).toBe(false)
    expect(worthOffering({ ...local, trackId: 7 }, null)).toBe(true)
  })
})
