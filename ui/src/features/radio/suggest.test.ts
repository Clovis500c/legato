import { expect, it } from 'vitest'
import { topGenres } from './suggest'

it('takes the two genres a library leans to, counting listens, and none when no song carries one', () => {
  const tracks = [{ id: 1, genre: 'Jazz' }, { id: 2, genre: ' jazz ' }, { id: 3, genre: 'Rock' }, { id: 4, genre: 'Folk' }, { id: 5 }, { id: 6, genre: 'x'.repeat(41) }]
  expect(topGenres(tracks, {})).toEqual(['jazz', 'folk'])
  expect(topGenres(tracks, { 3: [9] })).toEqual(['rock', 'jazz'])
  expect(topGenres([{ id: 5 }], {})).toEqual([])
})
