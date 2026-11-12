import { expect, it } from 'vitest'
import { isRemixLink } from './remixLink'

it('knows a remix link from a playlist link and from other text', () => {
  expect(isRemixLink('legato://remix/eyJ2IjoxfQ')).toBe(true)
  expect(isRemixLink('  LEGATO://remix/abc_-9 ')).toBe(true)
  expect(isRemixLink('legato://playlist/ABC')).toBe(false)
  expect(isRemixLink('legato://remix/')).toBe(false)
  expect(isRemixLink('legato://remix/a b')).toBe(false)
  expect(isRemixLink('see legato://remix/abc')).toBe(false)
})
