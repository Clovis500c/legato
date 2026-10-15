import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { coverGradient, formatDuration, timeAgo } from '../../shared/format'
import { filterTracks, libraryStats } from './filter'

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

it('coverGradient stable', () => {
  expect(coverGradient('Cheese')).toBe(coverGradient('Cheese'))
  expect(coverGradient('Cheese')).not.toBe(coverGradient('Rumours'))
})
