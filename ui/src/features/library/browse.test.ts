import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { browse, inPicks, pickIn } from './browse'

const song = (id: number, artist: string, album: string | null = null): LibraryTrack => ({ id, added: id, addedAt: null, title: `Song ${id}`, artist, album, durationMs: null, isrc: null, ids: { local: `C:/Music/${id}.mp3` } })
const ids = (tracks: LibraryTrack[]) => tracks.map((t) => t.id)

const library = [song(1, 'Daft Punk', 'Discovery'), song(2, 'Daft Punk feat. Romanthony', 'Discovery'), song(3, 'Daft Punk', 'Homework'), song(4, 'Air', 'Moon Safari'), song(5, 'Daft Punk'), song(6, 'Air', 'Discovery')]

describe('Column browser', () => {
  it('offers genres only when songs have one, and a genre narrows the artists', () => {
    expect(browse(library, { artists: [], albums: [] }).genres).toBeNull()
    const tagged = library.map((t) => (t.artist === 'Air' ? { ...t, genre: 'Electronic' } : t.id === 3 ? { ...t, genre: 'house' } : t))
    const b = browse(tagged, { artists: [], albums: [] })
    expect(b.genres?.items.map((g) => [g.genre, g.tracks.length])).toEqual([['Electronic', 2], ['house', 1]])
    const house = browse(tagged, { genres: ['house'], artists: [], albums: [] })
    expect([ids(house.songs), house.artists.items.map((g) => g.artist)]).toEqual([[3], ['Daft Punk']])
    expect(ids(inPicks([{ ...song(7, 'Air'), genre: 'Electronic' }, song(8, 'Air')], browse(tagged, { genres: ['electronic'], artists: [], albums: [] })))).toEqual([7])
  })

  it('lists artists and albums A to Z, every song when nothing is picked', () => {
    const b = browse(library, { artists: [], albums: [] })
    expect(b.artists.items.map((g) => [g.artist, g.tracks.length])).toEqual([['Air', 2], ['Daft Punk', 4]])
    // Same album name, two artists: two albums.
    expect(b.albums.items.map((g) => [g.album, g.artist])).toEqual([['Discovery', 'Air'], ['Discovery', 'Daft Punk'], ['Homework', 'Daft Punk'], ['Moon Safari', 'Air']])
    expect(ids(b.songs)).toEqual([1, 2, 3, 4, 5, 6])
    expect(b.artists.on.size + b.albums.on.size).toBe(0)
  })

  it('narrows the albums to the artists picked, the songs to the albums picked', () => {
    const daft = browse(library, { artists: ['daft punk'], albums: [] })
    expect(daft.albums.items.map((g) => g.album)).toEqual(['Discovery', 'Homework'])
    // A credit's first artist, and a song with no album, count as the artist's.
    expect(ids(daft.songs)).toEqual([1, 2, 3, 5])
    expect(ids(daft.albums.tracks)).toEqual([1, 2, 3, 5])
    const discovery = browse(library, { artists: ['daft punk'], albums: [daft.albums.items[0].key] })
    expect(ids(discovery.songs)).toEqual([1, 2])
    // Every artist: an album picked keeps its own artist's songs.
    expect(ids(browse(library, { artists: [], albums: [daft.albums.items[0].key] }).songs)).toEqual([1, 2])
    expect(ids(browse(library, { artists: ['air', 'daft punk'], albums: [] }).songs)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('leaves out a pick no longer there, so the list never ends up empty', () => {
    const b = browse(library.filter((t) => t.artist === 'Air'), { artists: ['daft punk'], albums: ['homework\u0000daft punk'] })
    expect(b.artists.on.size).toBe(0)
    expect(ids(b.songs)).toEqual([4, 6])
    // The hidden videos follow what's picked.
    const air = browse(library, { artists: ['air'], albums: [] })
    expect(ids(inPicks([song(7, 'Air - Topic'), song(8, 'Someone')], air))).toEqual([7])
  })

  it('picks one, toggles with Ctrl, runs with Shift, All picks none', () => {
    const keys = ['a', 'b', 'c', 'd']
    expect(pickIn(keys, ['a'], 'c', 'only', 'a')).toEqual(['c'])
    expect(pickIn(keys, ['a'], 'c', 'toggle', 'a')).toEqual(['a', 'c'])
    expect(pickIn(keys, ['a', 'c'], 'a', 'toggle', 'c')).toEqual(['c'])
    expect(pickIn(keys, ['d'], 'b', 'range', 'd')).toEqual(['b', 'c', 'd'])
    expect(pickIn(keys, [], 'b', 'range', null)).toEqual(['b'])
    expect(pickIn(keys, ['a', 'b'], null, 'only', 'a')).toEqual([])
  })
})
