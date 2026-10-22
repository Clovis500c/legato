import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { formatDuration, timeAgo } from '../../shared/format'
import { filterTracks, groupAlbums, groupArtists, libraryStats, musicOnly, primaryArtist, sortGroups, sortTracks } from './filter'

const t = (id: number, title: string, artist: string, ids: LibraryTrack['ids']): LibraryTrack => ({
  id,
  added: id,
  title,
  artist,
  album: null,
  durationMs: null,
  isrc: null,
  ids,
})

const tracks = [
  t(1, 'Alors on danse', 'Stromae', { spotify: 's1', youtube: 'y1' }),
  t(2, 'Midnight City', 'M83', { spotify: 's2' }),
  t(3, 'Nightcall', 'Kavinsky', { youtube: 'y3' }),
]

describe('filterTracks', () => {
  it('ignores accents and case, needs every word', () => {
    expect(filterTracks(tracks, 'STROMAÉ danse', 'all').map((x) => x.id)).toEqual([1])
    expect(filterTracks(tracks, '  ', 'all')).toHaveLength(3)
  })
  it('filters by source and unlinked', () => {
    expect(filterTracks(tracks, '', 'youtube').map((x) => x.id)).toEqual([1, 3])
    expect(filterTracks(tracks, '', 'unlinked').map((x) => x.id)).toEqual([2, 3])
  })
})

it('libraryStats', () => {
  expect(libraryStats(tracks)).toEqual({
    total: 3,
    perSource: { spotify: 2, youtube: 2, local: 0, apple: 0 },
    sources: 2,
    unlinked: 2,
    linkedPct: 33,
  })
  expect(libraryStats([]).linkedPct).toBe(0)
})

it('formatDuration', () => {
  expect(formatDuration(369_000)).toBe('6:09')
  expect(formatDuration(3_601_000)).toBe('1:00:01')
  expect(formatDuration(null)).toBe('')
})

it('timeAgo', () => {
  const now = 1_000_000_000
  expect(timeAgo(now - 10_000, now)).toBe('just now')
  expect(timeAgo(now - 120_000, now)).toBe('2 minutes ago')
})

describe('albums and artists', () => {
  const lib = [
    { ...t(1, 'Get Lucky', 'Daft Punk, Pharrell Williams', { spotify: 'a' }), album: 'Random Access Memories', durationMs: 369_000 },
    { ...t(2, 'Instant Crush', 'Daft Punk feat. Julian Casablancas', { youtube: 'b' }), album: 'Random Access Memories', durationMs: 337_000 },
    { ...t(3, 'Intro', 'The xx', { local: 'c' }), album: 'xx', durationMs: 128_000 },
    t(4, 'No album', 'Daft Punk', { youtube: 'd' }),
  ]

  it('primaryArtist keeps first credited', () => {
    expect(primaryArtist('Daft Punk, Pharrell Williams')).toBe('Daft Punk')
    expect(primaryArtist('Polo & Pan')).toBe('Polo & Pan')
    expect(primaryArtist('Daft Punk feat. Julian Casablancas')).toBe('Daft Punk')
    expect(primaryArtist('M83')).toBe('M83')
    // YouTube channel names.
    expect(primaryArtist('Kenshi Yonezu - Topic')).toBe('Kenshi Yonezu')
    expect(primaryArtist('AdeleVEVO')).toBe('Adele')
    expect(primaryArtist('Kuuls x BGX Reverb')).toBe('Kuuls')
    expect(primaryArtist('Xavier')).toBe('Xavier')
    expect(primaryArtist('VEVO')).toBe('VEVO')
  })

  it('groups by album + primary artist, skips tracks without album', () => {
    expect(groupAlbums(lib).map((g) => [g.album, g.artist, g.tracks.length])).toEqual([
      ['Random Access Memories', 'Daft Punk', 2],
      ['xx', 'The xx', 1],
    ])
  })

  it('counts tracks and albums per artist', () => {
    expect(groupArtists(lib).map(({ cover, tracks, ...g }) => ({ ...g, cover: cover.id, songs: tracks.length }))).toEqual([
      { artist: 'Daft Punk', count: 3, albums: 1, cover: lib.find((x) => x.artist.startsWith('Daft Punk'))!.id, songs: 3 },
      { artist: 'The xx', count: 1, albums: 1, cover: lib.find((x) => x.artist === 'The xx')!.id, songs: 1 },
    ])
  })

  it('sorts by recent and duration', () => {
    expect(sortTracks(lib, 'recent').map((x) => x.id)).toEqual([4, 3, 2, 1])
    expect(sortTracks(lib, 'duration').map((x) => x.id)).toEqual([1, 2, 3, 4])
    expect(sortTracks(lib, 'title').map((x) => x.title)[0]).toBe('Get Lucky')
  })

  it('YouTube-like sorts: added, plays, alphabet both ways, length, random', () => {
    const ids = (s: Parameters<typeof sortTracks>[1], o?: Parameters<typeof sortTracks>[2]) => sortTracks(lib, s, o).map((x) => x.id)
    expect(ids('added-old')).toEqual([1, 2, 3, 4])
    // Playlist: date added = its own order.
    expect(ids('added-new', { positional: true })).toEqual([...lib].reverse().map((x) => x.id))
    // Liked Music: service order already newest first.
    expect(ids('added-new', { positional: true, newestFirst: true })).toEqual([1, 2, 3, 4])
    expect(ids('added-old', { positional: true, newestFirst: true })).toEqual([4, 3, 2, 1])
    // Library: added rank, not row id.
    const ranked = lib.map((x) => ({ ...x, added: 10 - x.id }))
    expect(sortTracks(ranked, 'added-new').map((x) => x.id)).toEqual([1, 2, 3, 4])
    expect(ids('manual')).toEqual(lib.map((x) => x.id))
    const stats = { 3: [5, 100], 1: [5, 200], 2: [1, 900] } as Record<number, [number, number]>
    expect(ids('most-played', { stats })).toEqual([1, 3, 2, 4])
    expect(ids('recently-played', { stats })).toEqual([2, 1, 3, 4])
    expect(sortTracks(lib, 'title-desc').map((x) => x.title)).toEqual(sortTracks(lib, 'title').map((x) => x.title).reverse())
    // Unknown length last.
    expect(ids('duration-short')).toEqual([3, 2, 1, 4])
    const r = ids('random', { seed: 7 })
    expect([...r].sort()).toEqual([1, 2, 3, 4])
    expect(ids('random', { seed: 7 })).toEqual(r)
  })

  it('albums and artists sort and filter like songs', () => {
    const albums = groupAlbums(lib).map((g) => ({ ...g, name: g.album }))
    const names = (o: Parameters<typeof sortGroups>[1], opts?: Parameters<typeof sortGroups>[2]) => sortGroups(albums, o, opts).map((g) => g.name)
    expect(names('name')).toEqual(['Random Access Memories', 'xx'])
    expect(names('name-desc')).toEqual(['xx', 'Random Access Memories'])
    expect(names('songs')).toEqual(['Random Access Memories', 'xx'])
    // Newest song added decides: xx (3) after RAM (1, 2).
    expect(names('added-new')).toEqual(['xx', 'Random Access Memories'])
    expect(names('added-old')).toEqual(['Random Access Memories', 'xx'])
    const stats = { 3: [9, 50], 1: [2, 500], 2: [2, 10] } as Record<number, [number, number]>
    expect(names('most-played', { stats })).toEqual(['xx', 'Random Access Memories'])
    expect(names('recently-played', { stats })).toEqual(['Random Access Memories', 'xx'])
    expect(names('length')).toEqual(['Random Access Memories', 'xx'])
    expect(names('name', { size: 'one' })).toEqual(['xx'])
    expect(names('name', { size: 'several' })).toEqual(['Random Access Memories'])
    const artists = groupArtists(lib).map((g) => ({ ...g, name: g.artist }))
    expect(sortGroups(artists, 'albums').map((g) => g.name)).toEqual(['Daft Punk', 'The xx'])
    expect(sortGroups(artists, 'random', { seed: 3 }).map((g) => g.name)).toEqual(sortGroups(artists, 'random', { seed: 3 }).map((g) => g.name))
  })
})

describe('musicOnly', () => {
  const t = (id: number, musicness?: 'music' | 'unsure' | 'notMusic') => ({ id, musicness })
  it('sets clear non-music aside, keeps doubts and unknowns', () => {
    const list = [t(1, 'music'), t(2, 'notMusic'), t(3, 'unsure'), t(4)]
    expect(musicOnly(list)).toEqual({ kept: [t(1, 'music'), t(3, 'unsure'), t(4)], hidden: [t(2, 'notMusic')] })
    expect(musicOnly([t(1)]).kept).toEqual([t(1)])
  })
})
