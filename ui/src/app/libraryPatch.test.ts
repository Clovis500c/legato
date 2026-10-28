import { describe, expect, it } from 'vitest'
import type { LibraryChanges, LibraryPlaylist, LibraryTrack } from '../shared/api'
import { nocase, patchLibrary, type LibraryLists } from './libraryPatch'

const t = (id: number, artist: string, title = 'Song', youtube = `y${id}`): LibraryTrack => ({ id, added: id, title, artist, album: null, durationMs: null, isrc: null, ids: { youtube } })
const p = (id: number, name: string, trackCount = 0): LibraryPlaylist => ({ id, source: 'local', sourceId: `custom-${id}`, name, trackCount, custom: true, newestFirst: false, orderManual: false })
const none: LibraryChanges = { tracks: [], gone: [], playlists: [], playlistsGone: [], orders: {}, history: false }

// As a whole read sends them: artist, title NOCASE, then id.
const lib = (): LibraryLists => ({
  tracks: [t(1, 'ABBA'), t(2, 'abba', 'Waterloo'), t(3, 'Muse')],
  playlists: [p(10, 'Liked Music', 1), p(11, 'Road trip', 2)],
  orders: { 10: [3], 11: [1, 2] },
})

describe('nocase', () => {
  it('folds ASCII only, then orders by code point', () => {
    expect(nocase('ABBA', 'abba')).toBe(0)
    expect(nocase('Zed', 'éclair')).toBeLessThan(0)
    expect(nocase('ÉCLAIR', 'éclair')).toBeLessThan(0)
    expect(nocase('abb', 'abba')).toBeLessThan(0)
    // UTF-8 puts U+FF01 before an emoji, UTF-16 units the other way round.
    expect(nocase('🔥', '！')).toBeGreaterThan(0)
  })
})

describe('patchLibrary', () => {
  it('leaves everything as it was when nothing changed', () => {
    const s = lib()
    const next = patchLibrary(s, none)
    expect(next.tracks).toBe(s.tracks)
    expect(next.playlists).toBe(s.playlists)
    expect(next.orders).toBe(s.orders)
  })

  it('a like: the playlist and its order, the songs untouched', () => {
    const s = lib()
    const next = patchLibrary(s, { ...none, playlists: [p(10, 'Liked Music', 2)], orders: { 10: [1, 3] } })
    expect(next.tracks).toBe(s.tracks)
    expect(next.playlists[0].trackCount).toBe(2)
    expect(next.playlists[1]).toBe(s.playlists[1])
    expect(next.orders).toEqual({ 10: [1, 3], 11: [1, 2] })
    expect(next.orders[11]).toBe(s.orders[11])
  })

  it('puts new and changed rows where a whole read does, keeps unchanged ones', () => {
    const s = lib()
    const next = patchLibrary(s, { ...none, tracks: [t(4, 'Abba', 'Dancing Queen'), t(3, 'Muse', 'Song', 'other'), { ...s.tracks[0] }, t(5, 'Zaz'), t(6, 'Ángel')] })
    expect(next.tracks.map((x) => x.id)).toEqual([4, 1, 2, 3, 5, 6])
    expect(next.tracks[1]).toBe(s.tracks[0])
    expect(next.tracks[3].ids.youtube).toBe('other')
  })

  it('a renamed playlist moves, gone rows and playlists leave, emptied playlists leave orders', () => {
    const s = lib()
    const next = patchLibrary(s, { ...none, gone: [2], playlists: [p(11, 'Afternoon', 0)], playlistsGone: [10], orders: { 11: [] } })
    expect(next.tracks.map((x) => x.id)).toEqual([1, 3])
    expect(next.playlists.map((x) => x.name)).toEqual(['Afternoon'])
    expect(next.orders).toEqual({})
    expect(s.orders).toEqual({ 10: [3], 11: [1, 2] })
  })
})
