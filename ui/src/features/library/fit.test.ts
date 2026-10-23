import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { songsThatFit } from './fit'

const t = (id: number, artist: string): LibraryTrack => ({ id, added: id, title: `Song ${id}`, artist, album: null, durationMs: null, isrc: null, ids: { youtube: `y${id}` } })
const tracks = [t(1, 'M83'), t(2, 'M83'), t(3, 'M83'), t(4, 'Kavinsky'), t(5, 'The xx'), t(6, 'Justice')]

describe('songsThatFit', () => {
  it('takes mixes sharing songs first, then the same artists by plays, never what is already in', () => {
    const got = songsThatFit([tracks[0]], tracks, { stats: { 3: [9, 1], 2: [1, 1] }, mixes: [{ id: 'daily-1', trackIds: [1, 5, 1] }, { id: 'other', trackIds: [6] }] })
    expect(got.map((f) => [f.track.id, f.mix])).toEqual([
      [5, 'daily-1'],
      [3, undefined],
      [2, undefined],
    ])
  })
  it('stops at the max', () => {
    expect(songsThatFit([tracks[0]], tracks, { stats: {} }, 1)).toHaveLength(1)
  })
})
