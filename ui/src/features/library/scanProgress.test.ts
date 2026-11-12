import { expect, it } from 'vitest'
import { progressOf } from './scanProgress'

it('shows a scan under way and clears it with the last report', () => {
  expect(progressOf([3, 12])).toEqual([3, 12])
  expect(progressOf([12, 12])).toBeNull()
  expect(progressOf([0, 0])).toBeNull()
})
