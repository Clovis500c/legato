import { expect, it } from 'vitest'
import { countInTimes } from './countIn'

it('counts four beats at the tempo, the song starting on the fifth', () => {
  expect(countInTimes(0.5)).toEqual({ clicks: [0, 0.5, 1, 1.5], start: 2 })
  expect(countInTimes(0.5, 2)).toEqual({ clicks: [0, 0.5], start: 1 })
})
