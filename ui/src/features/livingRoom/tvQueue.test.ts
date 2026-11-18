import { describe, expect, it } from 'vitest'
import { tvQueue } from './tvQueue'

describe('the TV home’s Up next row', () => {
  it('the songs after the playing one, in the play order, at most `max`', () => {
    expect(tvQueue([3, 1, 2, 0, 4], 2, 2)).toEqual([0, 4])
    expect(tvQueue([3, 1, 2, 0, 4], 3, 10)).toEqual([1, 2, 0, 4])
  })
  it('nothing after the last song, in an empty queue, or for a max of zero', () => {
    expect(tvQueue([0, 1, 2], 2, 6)).toEqual([])
    expect(tvQueue([], 0, 6)).toEqual([])
    expect(tvQueue([0, 1, 2], 0, 0)).toEqual([])
  })
  it('a playing song that is not in the order (a lone file): the queue from its start', () => {
    expect(tvQueue([5, 6, 7], 99, 2)).toEqual([5, 6])
  })
  it('songs that cannot play (Spotify off) are left out, as in the Up next panel, and the row still fills up', () => {
    expect(tvQueue([0, 1, 2, 3, 4], 0, 2, (i) => i !== 1)).toEqual([2, 3])
  })
})
