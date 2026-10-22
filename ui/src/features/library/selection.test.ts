import { describe, expect, it } from 'vitest'
import { all, NONE, pick, picked, pickedRows, step } from './selection'

const list = [{ id: 10 }, { id: 11 }, { id: 12 }, { id: 13 }, { id: 14 }]
const ids = (s: { ids: Set<number> }) => [...s.ids].sort()

describe('selection', () => {
  it('click, Ctrl+click and Shift+click like a file list', () => {
    let s = pick(NONE, list, 1, 'only')
    expect(ids(s)).toEqual([11])
    s = pick(s, list, 3, 'toggle')
    expect(ids(s)).toEqual([11, 13])
    s = pick(s, list, 1, 'toggle')
    expect(ids(s)).toEqual([13])
    // Shift: from the anchor (last Ctrl+click) to here.
    s = pick(s, list, 0, 'range')
    expect(ids(s)).toEqual([10, 11])
    expect(s.anchor).toBe(1)
    s = pick(s, list, 3, 'range')
    expect(ids(s)).toEqual([11, 12, 13])
    // Unknown row: nothing changes.
    expect(pick(s, list, 9, 'only')).toBe(s)
  })

  it('arrows move, Shift+arrows extend, ends are kept', () => {
    let s = step(NONE, list, 0, false)
    expect(ids(s)).toEqual([10])
    s = step(s, list, 1, true)
    s = step(s, list, 2, true)
    expect(ids(s)).toEqual([10, 11, 12])
    s = step(s, list, 99, false)
    expect(ids(s)).toEqual([14])
    expect(s.cursor).toBe(4)
    expect(step(NONE, [], 3, false)).toBe(NONE)
  })

  it('all, and picked rows in list order', () => {
    const s = all(list)
    expect(ids(s)).toEqual([10, 11, 12, 13, 14])
    const some = pick(pick(NONE, list, 3, 'toggle'), list, 0, 'toggle')
    expect(picked(some, list).map((t) => t.id)).toEqual([10, 13])
    expect(pickedRows(some, list)).toEqual([0, 3])
  })
})
