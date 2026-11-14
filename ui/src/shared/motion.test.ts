import { expect, it } from 'vitest'
import { allowsMotion } from './motion'

it('background art moves only when the setting allows it and the system does not ask for reduced motion', () => {
  expect(allowsMotion(true, false)).toBe(true)
  expect(allowsMotion(true, true)).toBe(false)
  expect(allowsMotion(false, false)).toBe(false)
  expect(allowsMotion(false, true)).toBe(false)
})
