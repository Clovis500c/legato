import { expect, it } from 'vitest'
import { loopBack } from './abLoop'

it('turns the song back to the loop start once its end is reached', () => {
  expect(loopBack(29_000, 10_000, 30_000)).toBeNull()
  expect(loopBack(30_000, 10_000, 30_000)).toBe(10_000)
  expect(loopBack(31_500, 10_000, 30_000)).toBe(10_000)
})

it('does nothing for half a loop, a too short one or a missing start', () => {
  expect(loopBack(50_000, 10_000, null)).toBeNull()
  expect(loopBack(50_000, null, 30_000)).toBeNull()
  expect(loopBack(50_000, 10_000, 10_500)).toBeNull()
})
