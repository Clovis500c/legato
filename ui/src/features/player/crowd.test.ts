import { describe, expect, it, vi } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { crowdOf, mergeRadios, seedsOf } from './crowd'

const song = (n: number, video = `v${n}`): LibraryTrack => ({ id: -n, added: 0, addedAt: null, title: `S${n}`, artist: `A${n}`, album: null, durationMs: 1, isrc: null, ids: { youtube: video } })

describe('seeds', () => {
  it('the last 3 distinct YouTube songs of the queue up to the playing one, latest first', () => {
    const q = [song(1), song(2), song(3, 'v1'), song(4), song(5), song(6)]
    expect(seedsOf(q, 4, 3).map((t) => t.ids.youtube)).toEqual(['v5', 'v4', 'v1'])
    expect(seedsOf([song(1)], 0, 3)).toHaveLength(1)
    expect(seedsOf([], 0, 3)).toEqual([])
    const local = { ...song(9), ids: { local: '/a.mp3' } }
    expect(seedsOf([local, song(1)], 1, 3).map((t) => t.ids.youtube)).toEqual(['v1'])
  })
})

describe('merged radios', () => {
  it('a song in several radios gets a vote each and its best place', () => {
    const merged = mergeRadios([[song(1), song(2), song(3)], [song(9), song(3), song(1)], [song(3)]])
    const by = (v: string) => merged.find((c) => c.track.ids.youtube === v)
    expect(by('v3')).toMatchObject({ votes: 3, rank: 0 })
    expect(by('v1')).toMatchObject({ votes: 2, rank: 0 })
    expect(by('v2')).toMatchObject({ votes: 1, rank: 1 })
    expect(by('v9')).toMatchObject({ votes: 1, rank: 0 })
    expect(merged).toHaveLength(4)
  })
  it('the same radios in another order give the same songs with the same votes', () => {
    const a = [song(1), song(2)]
    const b = [song(2), song(3)]
    const key = (r: LibraryTrack[][]) => mergeRadios(r).map((c) => [c.track.ids.youtube, c.votes, c.rank]).sort()
    expect(key([a, b])).toEqual(key([b, a]))
  })
})

describe('asking the radios', () => {
  it('one request per seed, in order, merged', async () => {
    const ask = vi.fn(async (v: string) => [song(v === 'v1' ? 10 : 11), song(12)])
    const got = await crowdOf(['v1', 'v2'], ask)
    expect(ask.mock.calls.map((c) => c[0])).toEqual(['v1', 'v2'])
    expect(got.find((c) => c.track.id === -12)?.votes).toBe(2)
  })
  it('a refusal ends the crowd for this pick: nothing from it, no further request', async () => {
    const ask = vi.fn().mockResolvedValueOnce([song(1)]).mockRejectedValueOnce(new Error('Too Many Requests')).mockResolvedValue([song(2)])
    expect(await crowdOf(['a', 'b', 'c'], ask)).toEqual([])
    expect(ask).toHaveBeenCalledTimes(2)
    const first = vi.fn().mockRejectedValue(new Error('Sorry'))
    expect(await crowdOf(['a', 'b', 'c'], first)).toEqual([])
    expect(first).toHaveBeenCalledTimes(1)
  })
})
