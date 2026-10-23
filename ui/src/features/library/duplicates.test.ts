import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { bestCopy, duplicateGroups } from './duplicates'

const t = (id: number, title: string, artist = 'Kavinsky', ids: LibraryTrack['ids'] = { youtube: `y${id}` }, album: string | null = null): LibraryTrack => ({ id, added: id, title, artist, album, durationMs: null, isrc: null, ids })

describe('duplicates', () => {
  it('groups copies of a song, not its other versions', () => {
    const lib = [
      t(1, 'Nightcall (Official Video)'),
      t(2, 'Nightcall', 'Kavinsky, Lovefoxxx', { spotify: 's2' }, 'OutRun'),
      t(3, 'NIGHTCALL [HD]'),
      t(4, 'Nightcall (Live)'),
      t(5, 'Nightcall - Slowed + Reverb'),
      t(6, 'Nightcall', 'Someone Else'),
      t(7, 'Odd Look'),
    ]
    expect(duplicateGroups(lib).map((g) => g.map((x) => x.id))).toEqual([[1, 2, 3]])
  })

  it('keeps the most played copy, else the one with most sources', () => {
    const g = [t(1, 'a'), t(2, 'a', 'Kavinsky', { youtube: 'y', spotify: 's' }), t(3, 'a')]
    expect(bestCopy(g, {}).id).toBe(2)
    expect(bestCopy(g, { 3: [9, 0] }).id).toBe(3)
  })
})
