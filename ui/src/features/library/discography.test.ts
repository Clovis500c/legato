import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { discography, isSingle } from './discography'

const t = (id: number, title: string, album: string | null, artist = 'Daft Punk'): LibraryTrack => ({ id, added: id, addedAt: null, title, artist, album, durationMs: null, isrc: null, ids: { youtube: `y${id}` } })

describe('discography', () => {
  it('tells singles and EPs from albums', () => {
    expect(isSingle({ album: 'Cola - Single', artist: 'CamelPhat', tracks: [t(1, 'Cola', 'Cola - Single')] })).toBe(true)
    expect(isSingle({ album: 'Live EP', artist: 'x', tracks: [] })).toBe(true)
    expect(isSingle({ album: 'Get Lucky', artist: 'Daft Punk', tracks: [t(1, 'Get Lucky', 'Get Lucky')] })).toBe(true)
    expect(isSingle({ album: 'Discovery', artist: 'Daft Punk', tracks: [t(1, 'One More Time', 'Discovery')] })).toBe(false)
    expect(isSingle({ album: 'Deep', artist: 'x', tracks: [t(1, 'Sleep', 'Deep')] })).toBe(false)
  })
  it("groups one artist's releases, most songs first", () => {
    const d = discography([t(1, 'One More Time', 'Discovery'), t(2, 'Aerodynamic', 'Discovery'), t(3, 'Get Lucky', 'Get Lucky'), t(4, 'Around the World', 'Homework'), t(5, 'Nightcall', 'OutRun', 'Kavinsky')], 'daft punk')
    expect(d.albums.map((a) => a.album)).toEqual(['Discovery', 'Homework'])
    expect(d.singles.map((a) => a.album)).toEqual(['Get Lucky'])
  })
})
