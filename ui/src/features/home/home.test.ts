import { describe, expect, it } from 'vitest'
import type { LibraryPlaylist, LibraryTrack, Play } from '../../shared/api'
import { byOpened, JUMP, jumpLists, listOf, MAX_LISTS, pushList, type OpenedList } from './recentLists'
import { weekOf } from './week'

const t = (id: number, title: string, artist: string, album: string | null): LibraryTrack => ({ id, added: id, title, artist, album, durationMs: 200_000, isrc: null, ids: { youtube: `y${id}` } })
const tracks = [t(1, 'Get Lucky', 'Daft Punk', 'Random Access Memories'), t(2, 'Nightcall', 'Kavinsky', 'OutRun'), t(3, 'Wait', 'M83', 'Hurry Up'), t(4, 'Intro', 'The xx', null)]
const pl = (id: number, name: string, trackCount: number, custom: boolean): LibraryPlaylist => ({ id, source: 'local', sourceId: String(id), name, trackCount, custom, newestFirst: false, orderManual: false })

describe('opened lists', () => {
  it('knows which pages are lists and keeps each once, newest first', () => {
    expect(listOf({ name: 'songs' })).toBeNull()
    expect(listOf({ name: 'artist', artist: 'M83' })).toEqual({ kind: 'artist', artist: 'M83' })
    const a: OpenedList = { kind: 'playlist', id: 1 }
    const b: OpenedList = { kind: 'mix', id: 'daily-1' }
    expect(pushList(pushList([a], b), a)).toEqual([a, b])
    const many = Array.from({ length: MAX_LISTS }, (_, i): OpenedList => ({ kind: 'playlist', id: i + 10 }))
    expect(pushList(many, a)).toHaveLength(MAX_LISTS)
  })

  it('reopens what still exists, then fills from what was played and the playlists', () => {
    const opened: OpenedList[] = [{ kind: 'playlist', id: 99 }, { kind: 'album', album: 'OutRun', artist: 'Kavinsky' }, { kind: 'mix', id: 'gone' }]
    const stats = { 3: [2, 200], 1: [1, 100] } as Record<number, [number, number]>
    const got = jumpLists(opened, { tracks, stats, playlists: [pl(5, 'Big import', 300, false), pl(6, 'Mine', 4, true)], mixIds: ['daily-1'] })
    expect(got).toEqual([
      { kind: 'album', album: 'OutRun', artist: 'Kavinsky' },
      // Played lately, newest first: M83's album and artist, then Daft Punk's.
      { kind: 'album', album: 'Hurry Up', artist: 'M83' },
      { kind: 'artist', artist: 'M83' },
      { kind: 'album', album: 'Random Access Memories', artist: 'Daft Punk' },
      { kind: 'artist', artist: 'Daft Punk' },
      // Own playlists first.
      { kind: 'playlist', id: 6 },
      { kind: 'playlist', id: 5 },
    ])
    expect(got.length).toBeLessThanOrEqual(JUMP)
    // Mixes still loading: an opened mix stays.
    expect(jumpLists([{ kind: 'mix', id: 'x' }], { tracks, stats: {}, playlists: [] })).toEqual([{ kind: 'mix', id: 'x' }])
  })
})

describe('byOpened', () => {
  it('puts playlists opened lately first, the rest in their own order', () => {
    const list = [pl(1, 'A', 1, true), pl(2, 'B', 1, true), pl(3, 'C', 1, true), pl(4, 'D', 1, true)]
    const opened: OpenedList[] = [{ kind: 'playlist', id: 3 }, { kind: 'album', album: 'x', artist: 'y' }, { kind: 'playlist', id: 2 }]
    expect(byOpened(list, opened).map((p) => p.id)).toEqual([3, 2, 1, 4])
  })
})

describe('weekOf', () => {
  const now = new Date(2026, 9, 23, 15, 0)
  const at = (daysAgo: number, hour = 12) => new Date(2026, 9, 23 - daysAgo, hour).getTime() / 1000
  const play = (trackId: number, startedAt: number, listenedMs: number, completed = true): Play => ({ trackId, startedAt, listenedMs, completed })

  it('sums each day, today last, and the week before apart', () => {
    const w = weekOf([play(1, at(10), 60_000), play(2, at(6, 1), 120_000), play(3, at(0), 30_000), play(3, at(0, 9), 10_000, false)], tracks, now)
    expect(w.starts).toHaveLength(7)
    expect(w.starts[6].getDate()).toBe(23)
    expect(w.days).toEqual([120_000, 0, 0, 0, 0, 0, 40_000])
    expect(w.total).toBe(160_000)
    expect(w.before).toBe(60_000)
  })

  it('finds the top artist by time and the top song by listens', () => {
    const w = weekOf([play(2, at(1), 600_000), play(3, at(1), 200_000), play(3, at(2), 200_000), play(3, at(3), 5_000, false)], tracks, now)
    expect(w.topArtist?.name).toBe('Kavinsky')
    expect(w.topSong).toEqual({ track: tracks[2], plays: 2 })
  })

  it('is empty with no plays', () => {
    const w = weekOf([], tracks, now)
    expect([w.total, w.before, w.topArtist, w.topSong]).toEqual([0, 0, undefined, undefined])
  })
})
