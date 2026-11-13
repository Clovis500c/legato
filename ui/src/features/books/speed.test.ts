import { describe, expect, it } from 'vitest'
import { withSpeed } from './speed'

describe('book speed', () => {
  it('keeps a step, drops normal speed and anything off the steps', () => {
    const a = withSpeed({}, 't:1', 1.5)
    expect(a).toEqual({ 't:1': 1.5 })
    expect(withSpeed(a, 't:1', 1)).toEqual({})
    expect(withSpeed(a, 't:2', 1.7)).toEqual({ 't:1': 1.5 })
  })
  it('forgets the oldest past 200', () => {
    let m = {}
    for (let i = 0; i < 205; i++) m = withSpeed(m, `t:${i}`, 2)
    expect(Object.keys(m).length).toBe(200)
    expect('t:0' in m).toBe(false)
    expect('t:204' in m).toBe(true)
  })
})
