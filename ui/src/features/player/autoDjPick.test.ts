import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import type { PlayStats } from '../library/filter'
import { djPick, djWhy, likedArtists, weight, type DjRules } from './autoDjPick'

const song = (id: number, artist: string, extra: Partial<LibraryTrack> = {}): LibraryTrack => ({ id, added: id, addedAt: null, title: `Song ${id}`, artist, album: null, durationMs: 200_000, isrc: null, ids: { youtube: `video${id}` }, ...extra })
const NOW = 1_800_000_000
const DAY = 86_400
const rules: DjRules = { fresh: 7, rated: true, gap: 0 }
// Always the first song left: picks in the pool's order.
const first = () => 0
const ids = (ts: LibraryTrack[]) => ts.map((t) => t.id)

describe('Auto-DJ', () => {
  it('weighs songs by your rating', () => {
    expect([weight(10, true), weight(6, true), weight(2, true), weight(undefined, true), weight(10, false)]).toEqual([4, 1, 0.25, 1, 1])
    // Five stars against an unrated song: four draws in five.
    const pool = [song(1, 'Air'), song(2, 'Justice')]
    const stats: PlayStats = { 1: [3, 0, 10] }
    expect(ids(djPick(pool, [], stats, rules, 1, NOW, () => 0.79))).toEqual([1])
    expect(ids(djPick(pool, [], stats, rules, 1, NOW, () => 0.81))).toEqual([2])
    expect(ids(djPick(pool, [], stats, { ...rules, rated: false }, 1, NOW, () => 0.51))).toEqual([2])
  })

  it('leaves out the queue, videos that are not music, and songs heard lately while others are left', () => {
    const pool = [song(1, 'A'), song(2, 'B'), song(3, 'C', { musicness: 'notMusic' }), song(4, 'D'), song(5, 'E')]
    const stats: PlayStats = { 4: [1, NOW - 2 * DAY] }
    // 1 queued, 3 a talk, 4 heard two days ago: it comes once the others have.
    expect(ids(djPick(pool, [pool[0]], stats, rules, 3, NOW, first))).toEqual([2, 5, 4])
    // A day's wait: 4 is fair game.
    expect(ids(djPick(pool, [pool[0]], stats, { ...rules, fresh: 1 }, 3, NOW, first))).toEqual([2, 4, 5])
    expect(djPick([pool[2]], [], {}, rules, 2, NOW, first)).toEqual([])
  })

  it('brings up artists you liked twice as often, and says why', () => {
    const pool = [song(1, 'Air'), song(2, 'Justice'), song(3, 'Air feat. Beck')]
    const liked = likedArtists(pool, new Set([3]))
    // Air weighs 2 (song 1) against 1: two draws in three.
    expect(ids(djPick(pool.slice(0, 2), [], {}, rules, 1, NOW, () => 0.66, liked))).toEqual([1])
    expect(ids(djPick(pool.slice(0, 2), [], {}, rules, 1, NOW, () => 0.68, liked))).toEqual([2])
    expect(ids(djPick(pool.slice(0, 2), [], {}, { ...rules, rated: false }, 1, NOW, () => 0.51, liked))).toEqual([2])
    expect(djWhy(pool[0], {}, rules, liked)).toEqual({ kind: 'liked', title: 'Song 3', self: false })
    expect(djWhy(pool[2], {}, rules, liked)).toEqual({ kind: 'liked', title: 'Song 3', self: true })
    expect(djWhy(pool[0], { 1: [0, 0, 9] }, rules, liked)).toEqual({ kind: 'stars', stars: 4.5 })
    expect(djWhy(pool[1], {}, rules, liked)).toBeUndefined()
    expect(djWhy(pool[0], {}, { ...rules, rated: false }, liked)).toBeUndefined()
  })

  it('keeps an artist apart unless no one else is left', () => {
    const pool = [song(1, 'Air'), song(2, 'Air'), song(3, 'Air feat. Beck'), song(4, 'Justice')]
    expect(ids(djPick(pool, [], {}, { ...rules, gap: 1 }, 4, NOW, first))).toEqual([1, 4, 2, 3])
    expect(ids(djPick(pool, [], {}, rules, 4, NOW, first))).toEqual([1, 2, 3, 4])
  })

  it('goes on once every song has played, never from the queue’s last half', () => {
    const pool = [song(1, 'A'), song(2, 'B'), song(3, 'C')]
    expect(ids(djPick(pool, pool, {}, rules, 4, NOW, first))).toEqual([1, 2, 3, 1])
    expect(ids(djPick([pool[0]], [pool[0]], {}, rules, 2, NOW, first))).toEqual([1, 1])
  })
})
