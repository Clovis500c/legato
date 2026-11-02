import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { upNextSongs } from './upNext'

const song = (n: number) => ({ id: n, title: `T${n}`, artist: `A${n}` }) as LibraryTrack

describe('upNextSongs', () => {
  it('lists what follows the current song in play order', () => {
    const list = [song(0), song(1), song(2), song(3)]
    expect(upNextSongs(list, [2, 0, 3, 1], 0)).toEqual([
      { title: 'T3', artist: 'A3' },
      { title: 'T1', artist: 'A1' },
    ])
    expect(upNextSongs(list, [2, 0, 3, 1], 0, 1)).toEqual([{ title: 'T3', artist: 'A3' }])
    expect(upNextSongs(list, [2, 0, 3, 1], 1)).toEqual([])
  })
})
