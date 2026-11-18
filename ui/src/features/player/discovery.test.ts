import { describe, expect, it } from 'vitest'
import type { HomeItem, LibraryTrack, Shelf } from '../../shared/api'
import { discoveryCandidates } from './discovery'

const song = (n: number, extra: Partial<LibraryTrack> = {}): LibraryTrack => ({ id: n, added: 0, addedAt: null, title: `S${n}`, artist: `A${n}`, album: null, durationMs: 1, isrc: null, ids: { youtube: `v${n}` }, ...extra })
const item = (n: number): HomeItem => ({ title: `S${n}`, subtitle: '', art: null, track: song(n), list: null }) as HomeItem
const list = (title: string): HomeItem => ({ title, subtitle: '', art: null, track: null, list: { type: 'browse', id: 'VLx' } }) as HomeItem
const shelf = (title: string, items: HomeItem[]): Shelf => ({ title, items }) as Shelf

describe('what Home offers', () => {
  it('the shelves’ songs, once each, in place order; playlists and albums are not songs; what the library already holds is not new', () => {
    const shelves = [shelf('Quick picks', [item(1), list('A playlist'), item(2), item(3)]), shelf('Mixed for you', [item(2), item(4)])]
    const got = discoveryCandidates(shelves, [song(3, { id: 33 })])
    expect(got.map((c) => c.track.ids.youtube)).toEqual(['v1', 'v2', 'v4'])
    expect(got.map((c) => c.rank)).toEqual([0, 1, 2])
  })
  it('no shelf, no songs: nothing', () => {
    expect(discoveryCandidates([], [])).toEqual([])
    expect(discoveryCandidates([shelf('Albums', [list('x')])], [])).toEqual([])
  })
})
