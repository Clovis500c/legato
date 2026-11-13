import { describe, expect, it } from 'vitest'
import { padActions, pressed } from './pad'

const btn = (...down: number[]) => Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i) }))

describe('gamepad', () => {
  it('a button acts when it goes down, not while held', () => {
    const a = pressed(btn(0), [0, 0])
    expect(padActions([], a)).toEqual(['press'])
    expect(padActions(a, a)).toEqual([])
    expect(padActions(a, pressed(btn(0, 1), [0, 0]))).toEqual(['back'])
  })
  it('the d-pad and the left stick both move', () => {
    expect(padActions([], pressed(btn(13), [0, 0]))).toEqual(['down'])
    expect(padActions([], pressed(btn(), [-0.9, 0]))).toEqual(['left'])
    expect(padActions([], pressed(btn(), [0.3, -0.2]))).toEqual([])
  })
  it('buttons without a meaning do nothing', () => {
    expect(padActions([], pressed(btn(2, 5), [0, 0]))).toEqual([])
  })
})
