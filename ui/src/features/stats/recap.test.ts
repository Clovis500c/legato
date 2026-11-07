import { describe, expect, it } from 'vitest'
import type { LibraryTrack, Play } from '../../shared/api'
import { personalityOf, recapOf, recapSpans, spanRange } from './recap'
import { recapCards } from './recapCards'
import { statsOf } from './stats'

const t = (id: number, title: string, artist: string, album: string | null = null): LibraryTrack => ({ id, added: id, addedAt: null, title, artist, album, durationMs: 200_000, isrc: null, ids: { youtube: `y${id}` } })
const tracks = [t(1, 'One More Time', 'Daft Punk', 'Discovery'), t(2, 'Nightcall', 'Kavinsky', 'OutRun'), t(3, 'Old', 'Old Band')]
// Half an hour heard, local time.
const play = (trackId: number, month: number, day: number, hour = 12, year = 2026): Play => ({ trackId, startedAt: Math.floor(new Date(year, month, day, hour).getTime() / 1000), listenedMs: 30 * 60_000, completed: true })

describe('recap', () => {
  it('spans a whole year or one month, local time', () => {
    expect(spanRange({ year: 2026, month: null }).map((t) => new Date(t))).toEqual([new Date(2026, 0, 1), new Date(2027, 0, 1)])
    expect(spanRange({ year: 2026, month: 11 }).map((t) => new Date(t))).toEqual([new Date(2026, 11, 1), new Date(2027, 0, 1)])
  })

  it('offers years and months with an hour of music, newest first', () => {
    const history = [play(3, 11, 30, 12, 2025), play(3, 11, 31, 12, 2025), play(1, 8, 1), play(1, 9, 2), play(1, 9, 3)]
    expect(recapSpans(history)).toEqual([
      { year: 2026, month: null },
      { year: 2026, month: 9 },
      { year: 2025, month: null },
      { year: 2025, month: 11 },
    ])
  })

  it('counts like Stats over its dates and finds each month’s song', () => {
    const history = [play(3, 11, 31, 12, 2025), play(1, 0, 5), play(1, 0, 6), play(2, 0, 7), play(2, 2, 1, 23), play(2, 2, 2, 23)]
    const r = recapOf(history, tracks, { year: 2026, month: null })
    expect(r.stats.ms).toBe(5 * 30 * 60_000)
    // Old Band was last year's.
    expect(r.stats.newArtists).toBe(2)
    expect(r.months.map((m) => m?.item.id ?? null)).toEqual([1, null, 2, null, null, null, null, null, null, null, null, null])
    expect(r.topHour).toBe(12)
    expect(r.stats.topSongs).toEqual(statsOf(history, tracks, 'year', new Date(2026, 11, 31)).topSongs)
    const march = recapOf(history, tracks, { year: 2026, month: 2 })
    expect([march.stats.listens, march.months, march.topHour]).toEqual([2, [], 23])
  })

  it('names a listening personality, the first rule that fits', () => {
    const none = statsOf([], tracks, 'all')
    const at = (hour: number) => Object.assign(Array(24).fill(0), { [hour]: 40 }) as number[]
    expect(personalityOf({ ...none, ms: 100, listens: 40, topSongs: [{ item: tracks[0], listens: 8, ms: 10 }] })).toEqual({ personality: 'onRepeat', share: 0.2 })
    expect(personalityOf({ ...none, ms: 100, listens: 10, topSongs: [{ item: tracks[0], listens: 8, ms: 10 }] }).personality).toBe('eclectic')
    expect(personalityOf({ ...none, ms: 100, topArtists: [{ item: { name: 'Daft Punk', cover: tracks[0] }, listens: 1, ms: 30 }] })).toEqual({ personality: 'loyal', share: 0.3 })
    expect(personalityOf({ ...none, ms: 100, artists: 10, newArtists: 6 }).personality).toBe('explorer')
    expect(personalityOf({ ...none, ms: 100, byHour: at(23) }).personality).toBe('nightOwl')
    expect(personalityOf({ ...none, ms: 100, byHour: at(7) }).personality).toBe('earlyBird')
    expect(personalityOf({ ...none, ms: 100, byHour: at(15) }).personality).toBe('eclectic')
    expect(personalityOf(none)).toEqual({ personality: 'eclectic', share: 0 })
  })

  it('ends on the profile card: the time, the top artists, the biggest playlists', () => {
    const recap = recapOf([play(1, 8, 1), play(1, 8, 2), play(2, 8, 3)], tracks, { year: 2026, month: null })
    const cards = recapCards(recap, [{ name: 'Road trip', songs: 42 }])
    const profile = cards.at(-1)!
    expect(profile.id).toBe('profile')
    expect(profile.title).toBe(cards[0].title)
    expect(profile.rows?.map((r) => r.title)).toEqual(['1. Daft Punk', '2. Kavinsky', 'Road trip'])
    expect(profile.rows?.at(-1)?.sub).toBe('42 songs')
    // Nothing heard: no profile.
    expect(recapCards(recapOf([], tracks, { year: 2026, month: null })).some((c) => c.id === 'profile')).toBe(false)
  })
})
