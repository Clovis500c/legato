import { describe, expect, it } from 'vitest'
import { fresh, seen, toggle, type Marks } from './played'

const none: Marks = { played: [], seen: {} }

describe('podcast marks', () => {
  it('flips played on and off', () => {
    const on = toggle(none, 'a')
    expect(on.played).toEqual(['a'])
    expect(toggle(on, 'a').played).toEqual([])
  })
  it('nothing is new the first time, then only what was not seen', () => {
    expect(fresh(none, 'u', ['a', 'b'])).toEqual([])
    const m = seen(none, 'u', ['a', 'b'])
    expect(fresh(m, 'u', ['c', 'a', 'b'])).toEqual(['c'])
    expect(fresh(m, 'other', ['c'])).toEqual([])
  })
})
