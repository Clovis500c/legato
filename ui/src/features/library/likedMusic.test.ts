import { describe, expect, it } from 'vitest'
import type { LibraryPlaylist } from '../../shared/api'
import { fold, oneLiked, shownIds } from './likedMusic'

const p = (id: number, name: string, custom: boolean, sourceId = `custom-${id}`): LibraryPlaylist => ({ id, source: custom ? 'local' : 'youtube', sourceId, name, trackCount: 0, custom, newestFirst: !custom, orderManual: false })
const account = p(1, 'Liked Music', false, 'LM')
const own = p(2, 'Liked Music', true)
const mix = p(3, 'Music', false, 'PL3')

describe('one Liked Music', () => {
  it('folds yours into the account’s: newest of yours on top, no song twice', () => {
    const { playlists, orders } = oneLiked({ playlists: [account, own, mix], orders: { 1: [10, 11], 2: [11, 12, 13], 3: [10] } })
    expect(playlists.map((x) => x.id)).toEqual([1, 3])
    expect(orders[1]).toEqual([13, 12, 11, 10])
    expect(playlists[0].trackCount).toBe(4)
    expect(playlists[1]).toBe(mix)
  })

  it('hides an empty one of yours, keeps yours alone without YouTube Music', () => {
    const raw = { playlists: [account, own], orders: { 1: [10] } }
    expect(oneLiked(raw)).toEqual({ playlists: [account], orders: raw.orders })
    const alone = { playlists: [own, mix], orders: { 2: [12] } }
    expect(oneLiked(alone)).toBe(alone)
  })

  it('opens both lists for the account’s page only', () => {
    expect(shownIds(1, [account, own])).toEqual([2, 1])
    expect(shownIds(3, [account, own, mix])).toEqual([3])
    expect(shownIds(1, [account])).toEqual([1])
  })

  it('folds rows by id', () => {
    expect(fold([{ id: 5 }, { id: 6 }], [{ id: 6 }, { id: 7 }], (t) => t.id)).toEqual([{ id: 6 }, { id: 5 }, { id: 7 }])
  })
})
