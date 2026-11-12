import { expect, it } from 'vitest'
import { beatPeriod, clicksBetween, parseTempo } from './metronome'

it('lists the beats that fall in a window, on one steady grid', () => {
  expect(clicksBetween(1, 0.5, 1, 2.25)).toEqual([1, 1.5, 2])
  // The window opens late: the grid keeps its place, nothing is played twice.
  expect(clicksBetween(1, 0.5, 1.6, 2.6)).toEqual([2, 2.5])
  expect(clicksBetween(5, 0.5, 1, 2)).toEqual([])
  expect(clicksBetween(1, 0, 1, 2)).toEqual([])
  expect(clicksBetween(1, 0.5, 2, 2)).toEqual([])
})

it('takes a whole tempo from 30 to 400 and nothing else', () => {
  expect([parseTempo('120'), parseTempo(' 127,6 '), parseTempo('29'), parseTempo('401'), parseTempo('fast'), parseTempo('')]).toEqual([120, 128, null, null, null, null])
})

it('clicks at the tempo heard: the Live Editor slowing the song slows the clicks', () => {
  expect(beatPeriod(120, { on: true, speed: 1, tempo: 0.5 })).toBe(1)
  expect(beatPeriod(120, { on: true, speed: 1.25, tempo: 0.8 })).toBe(0.5)
  expect(beatPeriod(120, { on: false, speed: 1, tempo: 0.5 })).toBe(0.5)
})
