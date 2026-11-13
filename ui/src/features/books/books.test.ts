import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { pickBooks, progress } from './books'

const song = (id: number, over: Partial<LibraryTrack>): LibraryTrack => ({ id, added: 0, addedAt: null, title: `t${id}`, artist: 'a', album: null, durationMs: 200_000, isrc: null, ids: { local: `C:/${id}.mp3` }, ...over })

describe('audiobooks', () => {
  it('picks long files and tagged ones, not songs or videos, longest first', () => {
    const list = [
      song(1, {}),
      song(2, { durationMs: 3 * 3_600_000 }),
      song(3, { durationMs: 40 * 60_000, genre: 'Audiobook' }),
      song(4, { durationMs: 40 * 60_000, genre: 'Rock' }),
      song(5, { durationMs: 5 * 3_600_000, ids: { youtube: 'x' } }),
      song(6, { durationMs: 4 * 3_600_000, genre: 'Spoken Word' }),
      song(7, { durationMs: 3 * 60_000, genre: 'Audiobook' }),
    ]
    expect(pickBooks(list).map((t) => t.id)).toEqual([6, 2, 3])
  })
  it('where a book was left, if it is worth resuming', () => {
    const book = song(9, { durationMs: 3_600_000 * 3 })
    expect(progress({}, book)).toBeNull()
    const p = progress({ 't:9': { ms: 5_400_000, at: 1 } }, book)
    expect(p?.share).toBeCloseTo(0.5)
    expect(progress({ 't:9': { ms: 10_000, at: 1 } }, book)).toBeNull()
  })
})
