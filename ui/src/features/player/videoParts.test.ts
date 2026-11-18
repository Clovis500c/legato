import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { keepParts, partIn, partOf, partRows } from './videoParts'

const MIN = 60_000
const video = { id: 7, title: 'Live at the pier', artist: 'DJ', album: '', durationMs: 120 * MIN, ids: { youtube: 'mix' }, added: 0, addedAt: null } as unknown as LibraryTrack
const chapters = [
  { startMs: 0, title: 'Intro' },
  { startMs: 5 * MIN, title: 'First track' },
  { startMs: 40 * MIN, title: '' },
]

describe('partRows', () => {
  it('a row per chapter: its title, the video artist and source, its own length, where it starts and ends', () => {
    const rows = partRows(video, chapters, 120 * MIN)
    expect(rows.map((r) => [r.title, r.artist, r.ids.youtube, r.durationMs, partOf(r)])).toEqual([
      ['Intro', 'DJ', 'mix', 5 * MIN, { startMs: 0, endMs: 5 * MIN }],
      ['First track', 'DJ', 'mix', 35 * MIN, { startMs: 5 * MIN, endMs: 40 * MIN }],
      ['Chapter 3', 'DJ', 'mix', 80 * MIN, { startMs: 40 * MIN, endMs: null }],
    ])
  })

  it('out of order, twice the same start, or past the end: sorted, once, inside; the first part holds the start', () => {
    const rows = partRows(video, [{ startMs: 40 * MIN, title: 'B' }, { startMs: 3 * MIN, title: 'A' }, { startMs: 40 * MIN, title: 'B again' }, { startMs: 130 * MIN, title: 'After' }], 120 * MIN)
    expect(rows.map((r) => [r.title, partOf(r)])).toEqual([
      ['A', { startMs: 0, endMs: 40 * MIN }],
      ['B', { startMs: 40 * MIN, endMs: null }],
    ])
  })

  it('fewer than two parts, or no length: none (the video plays whole)', () => {
    expect(partRows(video, [{ startMs: 0, title: 'Only' }], 120 * MIN)).toEqual([])
    expect(partRows(video, chapters, 0)).toEqual([])
  })

  it('a song row has no part', () => {
    expect(partOf(video)).toBeUndefined()
  })
})

describe('partIn', () => {
  const rows = partRows(video, chapters, 120 * MIN)
  const other = { ...video, id: 8, ids: { youtube: 'other' } } as LibraryTrack
  const list = [other, ...rows]

  it('the row of the video whose part holds the time', () => {
    expect(partIn(list, [0, 1, 2, 3], 'mix', 0)).toBe(1)
    expect(partIn(list, [0, 1, 2, 3], 'mix', 5 * MIN)).toBe(2)
    expect(partIn(list, [0, 1, 2, 3], 'mix', 119 * MIN)).toBe(3)
  })

  it('a part taken out of Up next (not in the order) or another video: none', () => {
    expect(partIn(list, [0, 1, 3], 'mix', 6 * MIN)).toBe(-1)
    expect(partIn(list, [0, 1, 2, 3], 'other', 6 * MIN)).toBe(-1)
  })
})

describe('keepParts', () => {
  const rows = partRows(video, chapters, 120 * MIN)
  const a = { ...video, id: 1, ids: { youtube: 'a' } } as LibraryTrack
  const b = { ...video, id: 2, ids: { youtube: 'b' } } as LibraryTrack
  // 0: a, 1-3: the parts, 4: b
  const list = [a, ...rows, b]

  it('a shuffled order keeps a video parts together, in time order, where the first of them came', () => {
    expect(keepParts([4, 2, 0, 3, 1], list)).toEqual([4, 1, 2, 3, 0])
  })

  it('a part taken out stays out; songs alone are as they were', () => {
    expect(keepParts([3, 0, 1, 4], list)).toEqual([1, 3, 0, 4])
    expect(keepParts([4, 0], list)).toEqual([4, 0])
  })
})
