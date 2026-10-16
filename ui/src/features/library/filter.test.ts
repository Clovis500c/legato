import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { formatDuration, timeAgo } from '../../shared/format'
import { filterTracks, groupAlbums, groupArtists, libraryStats, primaryArtist, sortTracks } from './filter'

const t = (id: number, title: string, artist: string, ids: LibraryTrack['ids']): LibraryTrack => ({
  id,
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
  it('cherche sans accents ni casse, tous les mots', () => {
    expect(filterTracks(tracks, 'STROMAÉ danse', 'all').map((x) => x.id)).toEqual([1])
    expect(filterTracks(tracks, '  ', 'all')).toHaveLength(3)
  })
  it('filtre par source et non reliés', () => {
    expect(filterTracks(tracks, '', 'youtube').map((x) => x.id)).toEqual([1, 3])
    expect(filterTracks(tracks, '', 'unlinked').map((x) => x.id)).toEqual([2, 3])
  })
})

it('libraryStats', () => {
  expect(libraryStats(tracks)).toEqual({
    total: 3,
    perSource: { spotify: 2, youtube: 2, local: 0 },
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
  expect(timeAgo(now - 10_000, now)).toBe('à l’instant')
  expect(timeAgo(now - 120_000, now)).toBe('il y a 2 minutes')
})

describe('albums et artistes', () => {
  const lib = [
    { ...t(1, 'Get Lucky', 'Daft Punk, Pharrell Williams', { spotify: 'a' }), album: 'Random Access Memories', durationMs: 369_000 },
    { ...t(2, 'Instant Crush', 'Daft Punk feat. Julian Casablancas', { youtube: 'b' }), album: 'Random Access Memories', durationMs: 337_000 },
    { ...t(3, 'Intro', 'The xx', { local: 'c' }), album: 'xx', durationMs: 128_000 },
    t(4, 'Sans album', 'Daft Punk', { youtube: 'd' }),
  ]

  it('primaryArtist garde le premier crédité', () => {
    expect(primaryArtist('Daft Punk, Pharrell Williams')).toBe('Daft Punk')
    expect(primaryArtist('Polo & Pan')).toBe('Polo & Pan')
    expect(primaryArtist('Daft Punk feat. Julian Casablancas')).toBe('Daft Punk')
    expect(primaryArtist('M83')).toBe('M83')
  })

  it('groupe par album + artiste principal, ignore les titres sans album', () => {
    expect(groupAlbums(lib).map((g) => [g.album, g.artist, g.tracks.length])).toEqual([
      ['Random Access Memories', 'Daft Punk', 2],
      ['xx', 'The xx', 1],
    ])
  })

  it('compte titres et albums par artiste', () => {
    expect(groupArtists(lib)).toEqual([
      { artist: 'Daft Punk', count: 3, albums: 1 },
      { artist: 'The xx', count: 1, albums: 1 },
    ])
  })

  it('trie récents et durée', () => {
    expect(sortTracks(lib, 'recent').map((x) => x.id)).toEqual([4, 3, 2, 1])
    expect(sortTracks(lib, 'duration').map((x) => x.id)).toEqual([1, 2, 3, 4])
    expect(sortTracks(lib, 'title').map((x) => x.title)[0]).toBe('Get Lucky')
  })
})
