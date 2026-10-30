import { describe, expect, it } from 'vitest'
import type { LibraryTrack, Track } from '../../shared/api'
import { albumRows } from './albumPage'

const song = (title: string): Track => ({ title, artist: 'Daft Punk', album: 'Discovery', durationMs: null, isrc: null, ids: { apple: title } })
const mine = (id: number, title: string): LibraryTrack => ({ ...song(title), id, added: id, addedAt: null, ids: { youtube: `y${id}` } })

describe('albumRows', () => {
  it('puts your songs in album order, the missing ones between, extras after', () => {
    const shown = [mine(7, 'Digital Love'), mine(8, 'Bonus'), mine(9, 'One More Time')]
    const info = { year: 2001, slots: [{ disc: 1, number: 1, track: song('One More Time'), libraryId: 9 }, { disc: 1, number: 2, track: song('Aerodynamic'), libraryId: null }, { disc: 1, number: 3, track: song('Digital Love'), libraryId: 7 }] }
    const r = albumRows(info, shown)
    expect(r.rows.map((x) => ('mine' in x ? x.mine.id : x.missing.title))).toEqual([9, 'Aerodynamic', 7])
    expect(r.extras.map((t) => t.id)).toEqual([8])
    expect(r.ordered.map((t) => t.id)).toEqual([9, 7, 8])
    expect(r.discs).toBe(1)
  })
})
