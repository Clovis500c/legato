import { describe, expect, it } from 'vitest'
import { insertAt, keepQueued, moveInOrder, moveToSlot, nextIndex, playOrder, queued, queueItems, queueRows, repeatsAhead, tooLong } from './queue'

describe('playOrder', () => {
  it('keeps list order, or shuffles with the current track first', () => {
    expect(playOrder(4, 2, false)).toEqual([0, 1, 2, 3])
    let seed = 1
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const o = playOrder(50, 7, true, rand)
    expect(o[0]).toBe(7)
    expect([...o].sort((a, b) => a - b)).toEqual(playOrder(50, 0, false))
    expect(o).not.toEqual(playOrder(50, 7, false))
  })
})

describe('queued', () => {
  it('inserts after the current track or at the end', () => {
    expect(queued([2, 0, 1], 0, [3, 4], true)).toEqual([2, 0, 3, 4, 1])
    expect(queued([2, 0, 1], 0, [3], false)).toEqual([2, 0, 1, 3])
  })

  it("queues the user's songs after the current one, behind ones already queued, before the rest of the list", () => {
    expect(queued([0, 1, 2], 0, [3], false, [])).toEqual([0, 3, 1, 2])
    expect(queued([0, 3, 1, 2], 0, [4], false, [3])).toEqual([0, 3, 4, 1, 2])
    // Play next still goes first.
    expect(queued([0, 3, 1, 2], 0, [4], true, [3])).toEqual([0, 4, 3, 1, 2])
  })

  it('keeps them there when shuffle turns on or off', () => {
    expect(keepQueued([0, 1, 2, 3, 4], [1, 4, 0, 2, 3], 1, [4])).toEqual([0, 1, 4, 2, 3])
    // Already played: no longer ahead, stays where the new order puts it.
    expect(keepQueued([0, 1, 2, 3], [3, 0, 1, 2], 0, [3])).toEqual([0, 1, 2, 3])
  })
})

describe('queueItems', () => {
  it('heads Now playing, the songs you queued and the rest', () => {
    const rows = queueRows([0, 1, 5, 6, 2], 1, () => true)
    expect(queueItems(rows, [5, 6])).toEqual([{ k: 0 }, { head: 'now' }, { k: 1 }, { head: 'mine' }, { k: 2 }, { k: 3 }, { head: 'then' }, { k: 4 }])
    expect(queueItems(rows, [])).toEqual([{ k: 0 }, { head: 'now' }, { k: 1 }, { head: 'then' }, { k: 2 }, { k: 3 }, { k: 4 }])
    expect(queueItems(queueRows([0], 0, () => true), [])).toEqual([{ head: 'now' }, { k: 0 }])
  })
})

describe('nextIndex', () => {
  const order = [2, 0, 3, 1]
  it('passes over songs longer than Skip long songs, unknown lengths play', () => {
    const lengths = [180_000, 3_600_000, null, 600_001]
    expect(nextIndex([0, 1, 2, 3], 0, 1, 'off', true, (j) => tooLong(lengths[j], 10))).toBe(2)
    expect(nextIndex([0, 1, 2, 3], 2, 1, 'all', true, (j) => tooLong(lengths[j], 10))).toBe(0)
    expect(tooLong(3_600_000, 0)).toBe(false)
  })
  it('walks the order and stops at the end without repeat', () => {
    expect(nextIndex(order, 2, 1, 'off', false)).toBe(0)
    expect(nextIndex(order, 1, 1, 'off', true)).toBeNull()
    expect(nextIndex(order, 2, -1, 'off', false)).toBeNull()
  })

  it('wraps with repeat all, replays with repeat one only when the track ended', () => {
    expect(nextIndex(order, 1, 1, 'all', true)).toBe(2)
    expect(nextIndex(order, 2, -1, 'all', false)).toBe(1)
    expect(nextIndex(order, 3, 1, 'one', true)).toBe(3)
    expect(nextIndex(order, 3, 1, 'one', false)).toBe(1)
  })

  it('skips unplayable tracks, gives up when none plays', () => {
    expect(nextIndex(order, 2, 1, 'off', false, (i) => i === 0)).toBe(3)
    expect(nextIndex(order, 2, 1, 'all', false, () => true)).toBeNull()
  })
})

describe('queue panel rows', () => {
  it('keeps songs already played above the current one', () => {
    const rows = queueRows([3, 0, 2, 1], 2, () => true)
    expect(rows.map((r) => [r.i, r.played, r.current])).toEqual([
      [3, true, false],
      [0, true, false],
      [2, false, true],
      [1, false, false],
    ])
  })

  it('leaves out what cannot play, never the current song', () => {
    expect(queueRows([0, 1, 2], 1, (i) => i !== 1 && i !== 2).map((r) => r.i)).toEqual([0, 1])
  })
})

describe('moveInOrder', () => {
  it('moves a song to where another one is, up or down', () => {
    expect(moveInOrder([5, 6, 7, 8], 8, 6)).toEqual([5, 8, 6, 7])
    expect(moveInOrder([5, 6, 7, 8], 6, 8)).toEqual([5, 7, 8, 6])
    expect(moveInOrder([5, 6, 7], 6, 6)).toEqual([5, 6, 7])
    expect(moveInOrder([5, 6, 7], 9, 6)).toEqual([5, 6, 7])
  })
})

describe('Up next drops', () => {
  it('puts a song at its slot, dropped songs slide in', () => {
    // Order 0..4, song 1 dragged before 4 (slot 4): lands right before it.
    expect(moveToSlot([0, 1, 2, 3, 4], 1, 4)).toEqual([0, 2, 3, 1, 4])
    // Upward: before 1.
    expect(moveToSlot([0, 1, 2, 3, 4], 3, 1)).toEqual([0, 3, 1, 2, 4])
    // To the end, and not in the order: unchanged.
    expect(moveToSlot([0, 1, 2], 0, 3)).toEqual([1, 2, 0])
    expect(moveToSlot([0, 1, 2], 9, 1)).toEqual([0, 1, 2])
    expect(insertAt([0, 1, 2], [5, 6], 1)).toEqual([0, 5, 6, 1, 2])
    expect(insertAt([0, 1], [5], 99)).toEqual([0, 1, 5])
  })

  it('moves played songs and the current one too: above the current = history, below = still to play', () => {
    const state = (order: number[], index: number) => queueRows(order, index, () => true).map((r) => (r.current ? 'now' : r.played ? 'played' : 'next'))
    // Current song (1) dragged to the end: what was next becomes history.
    const moved = moveToSlot([0, 1, 2, 3], 1, 4)
    expect(moved).toEqual([0, 2, 3, 1])
    expect(state(moved, 1)).toEqual(['played', 'played', 'played', 'now'])
    // A played song (0) dragged below the current one: it plays again.
    const again = moveToSlot([0, 1, 2, 3], 0, 2)
    expect(again).toEqual([1, 0, 2, 3])
    expect(state(again, 1)).toEqual(['now', 'next', 'next', 'next'])
  })
})

describe('repeatsAhead', () => {
  it('lists songs to come already higher in the queue', () => {
    const ids = [10, 11, 10, 12, 11]
    // Order 0..4, playing index 1: list 2 (=10) and 4 (=11) repeat.
    expect(repeatsAhead([0, 1, 2, 3, 4], 1, (i) => ids[i])).toEqual([2, 4])
    expect(repeatsAhead([0, 1, 3], 0, (i) => ids[i])).toEqual([])
  })
})
