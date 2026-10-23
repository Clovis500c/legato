import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { sanitizeSmart, type SmartList } from '../../shared/theme/theme'
import { smartTracks } from './rules'

const t = (id: number, title: string, artist: string, ids: LibraryTrack['ids'] = { youtube: `y${id}` }): LibraryTrack => ({ id, added: id, title, artist, album: null, durationMs: null, isrc: null, ids })
const tracks = [t(1, 'One More Time', 'Daft Punk'), t(2, 'Nightcall', 'Kavinsky', { spotify: 's2' }), t(3, 'Get Lucky', 'Daft Punk', { local: 'l3' }), t(4, 'Intro', 'The xx')]
const now = 1_000_000
const stats: Record<number, [number, number]> = { 1: [12, now - 3600], 2: [3, now - 40 * 86_400], 3: [7, now - 2 * 86_400] }
const list = (patch: Partial<SmartList>): SmartList => ({ id: 's', name: 'x', match: 'all', rules: [], sort: 'plays', limit: 0, ...patch })
const ids = (l: SmartList) => smartTracks(l, tracks, stats, now).map((x) => x.id)

describe('smart playlists', () => {
  it('filters by text, source, plays and last played', () => {
    expect(ids(list({ rules: [{ field: 'artist', op: 'has', value: 'daft' }] }))).toEqual([1, 3])
    expect(ids(list({ rules: [{ field: 'artist', op: 'not', value: 'daft' }] }))).toEqual([2, 4])
    expect(ids(list({ rules: [{ field: 'source', op: 'is', value: 'spotify' }] }))).toEqual([2])
    expect(ids(list({ rules: [{ field: 'plays', op: 'atLeast', value: '5' }] }))).toEqual([1, 3])
    expect(ids(list({ rules: [{ field: 'played', op: 'within', value: '7' }] }))).toEqual([1, 3])
    expect(ids(list({ rules: [{ field: 'played', op: 'notWithin', value: '30' }] }))).toEqual([2, 4])
    expect(ids(list({ rules: [{ field: 'added', op: 'last', value: '2' }], sort: 'added' }))).toEqual([4, 3])
  })

  it('matches all or any rule, sorts and limits', () => {
    const rules = [
      { field: 'artist' as const, op: 'is', value: 'kavinsky' },
      { field: 'title' as const, op: 'has', value: 'lucky' },
    ]
    expect(ids(list({ rules }))).toEqual([])
    expect(ids(list({ rules, match: 'any', sort: 'title' }))).toEqual([3, 2])
    expect(ids(list({ limit: 2 }))).toEqual([1, 3])
    expect(ids(list({ rules: [{ field: 'plays', op: 'atLeast', value: '' }], sort: 'artist' }))).toEqual([3, 1, 2, 4])
  })

  it('keeps only well-formed saved lists', () => {
    expect(sanitizeSmart([{ id: 'a', name: 'A', rules: [{ field: 'plays', op: 'atLeast', value: '1' }, { field: 'bad' }], sort: 'nope', limit: -3 }, { name: 'no id' }, null])).toEqual([{ id: 'a', name: 'A', match: 'all', rules: [{ field: 'plays', op: 'atLeast', value: '1' }], sort: 'plays', limit: 0 }])
  })
})
