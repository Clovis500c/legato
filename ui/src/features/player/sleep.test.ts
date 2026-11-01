import { describe, expect, it } from 'vitest'
import { albumEndsHere, sleepLabel } from './sleep'

const song = (album: string | null, artist = 'Air') => ({ album, artist })

describe('sleep timer', () => {
  it('says the minutes left, rounded up', () => {
    expect(sleepLabel(null)).toBe('')
    expect(sleepLabel('song')).toBe('End of song')
    expect(sleepLabel('album')).toBe('End of album')
    expect(sleepLabel(10_000 + 22.2 * 60_000, 10_000)).toBe('23 min')
    expect(sleepLabel(10_000 + 5_000, 10_000)).toBe('1 min')
  })

  it('ends the album where the next song in play order is from another one', () => {
    const list = [song('Moon Safari'), song('Moon Safari'), song('Talkie Walkie'), song(null)]
    const inOrder = [0, 1, 2, 3]
    expect(albumEndsHere({ list, order: inOrder, index: 0 })).toBe(false)
    expect(albumEndsHere({ list, order: inOrder, index: 1 })).toBe(true)
    // No album: a song by itself. Last song: no wrap.
    expect(albumEndsHere({ list, order: inOrder, index: 3 })).toBe(true)
    expect(albumEndsHere({ list: [song('Moon Safari'), song('Moon Safari')], order: [0, 1], index: 1 })).toBe(true)
    // Shuffled: the next in play order counts, not the next in the list.
    expect(albumEndsHere({ list, order: [0, 2, 1, 3], index: 0 })).toBe(true)
    expect(albumEndsHere({ list, order: [2, 1, 0, 3], index: 1 })).toBe(false)
    // Same name, other artist: another album.
    expect(albumEndsHere({ list: [song('Greatest Hits'), song('Greatest Hits', 'Queen')], order: [0, 1], index: 0 })).toBe(true)
  })

  it('looks past songs the queue passes over', () => {
    const list = [song('Moon Safari'), song('Talkie Walkie'), song('Moon Safari')]
    expect(albumEndsHere({ list, order: [0, 1, 2], index: 0 }, (j) => j === 1)).toBe(false)
    expect(albumEndsHere({ list, order: [0, 1, 2], index: 0 }, (j) => j === 2)).toBe(true)
  })
})
