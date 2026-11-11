import { describe, expect, it } from 'vitest'
import { holds, playingFrom } from './holding'

describe('own playlists holding the playing song', () => {
  const lists = [{ id: 1, name: 'Music', custom: true }, { id: 2, name: 'Other', custom: true }, { id: 3, name: 'Music', custom: false }]
  const orders = { 1: [7, 8], 2: [9], 3: [7] }

  it('knows which playlist holds it', () => {
    expect([holds(orders, 1, 7), holds(orders, 2, 7), holds(orders, 99, 7)]).toEqual([true, false, false])
  })

  it('names the own playlist the queue plays from, only while it still holds the song', () => {
    expect(playingFrom(lists, orders, 'Music', 7)?.id).toBe(1)
    expect(playingFrom(lists, orders, 'Music', 9)).toBeUndefined()
    expect(playingFrom(lists, orders, undefined, 7)).toBeUndefined()
    expect(playingFrom(lists, orders, 'Other', 7)).toBeUndefined()
  })
})
