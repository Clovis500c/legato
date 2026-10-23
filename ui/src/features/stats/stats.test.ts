import { describe, expect, it } from 'vitest'
import type { LibraryTrack, Play } from '../../shared/api'
import { periodStart, statsOf } from './stats'

const t = (id: number, title: string, artist: string, album: string | null = null): LibraryTrack => ({ id, added: id, title, artist, album, durationMs: 200_000, isrc: null, ids: { youtube: `y${id}` } })
const tracks = [t(1, 'One More Time', 'Daft Punk', 'Discovery'), t(2, 'Aerodynamic', 'Daft Punk', 'Discovery'), t(3, 'Nightcall', 'Kavinsky', 'OutRun'), t(4, 'Old', 'Old Band')]
const now = new Date(2026, 9, 23, 18, 0)
// Local time, `daysAgo` days before `now`.
const at = (daysAgo: number, hour = 12) => Math.floor(new Date(2026, 9, 23 - daysAgo, hour).getTime() / 1000)
const play = (trackId: number, daysAgo: number, listenedMs = 200_000, hour = 12): Play => ({ trackId, startedAt: at(daysAgo, hour), listenedMs, completed: listenedMs >= 200_000 })

describe('stats', () => {
  it('starts periods at local midnight', () => {
    expect(new Date(periodStart('4w', now))).toEqual(new Date(2026, 8, 26))
    expect(new Date(periodStart('year', now))).toEqual(new Date(2026, 0, 1))
    expect(periodStart('all', now)).toBe(0)
  })

  it('ranks songs, artists and albums of the period', () => {
    const history = [play(4, 60), play(1, 3), play(1, 2, 200_000, 8), play(3, 2), play(2, 1, 10_000), play(1, 0, 200_000, 8)]
    const s = statsOf(history, tracks, '4w', now)
    expect(s.listens).toBe(4)
    expect(s.ms).toBe(810_000)
    expect(s.topSongs.map((r) => [r.item.id, r.listens])).toEqual([
      [1, 3],
      [3, 1],
      [2, 0],
    ])
    expect(s.topArtists.map((r) => r.item.name)).toEqual(['Daft Punk', 'Kavinsky'])
    expect(s.topAlbums[0].item.album).toBe('Discovery')
    expect(s.byHour[8]).toBe(400_000)
    expect(s.newArtists).toBe(2)
    expect(s.timeline.ms.reduce((a, b) => a + b, 0)).toBe(810_000)
    expect(s.timeline.starts).toHaveLength(28)
  })

  it('counts streaks of days in a row', () => {
    const s = statsOf([play(1, 9), play(1, 8), play(1, 7), play(1, 2), play(1, 1), play(1, 0)], tracks, 'all', now)
    expect(s.bestStreak).toBe(3)
    expect(s.streak).toBe(3)
    expect(statsOf([play(1, 2), play(1, 1)], tracks, 'all', now).streak).toBe(2)
  })
})
