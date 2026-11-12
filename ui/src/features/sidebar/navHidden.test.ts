import { expect, it } from 'vitest'
import { navOf, withHidden } from './navHidden'
import { sanitize } from '../../shared/theme/theme'

it('hides and shows entries once each, in the sidebar order', () => {
  expect(withHidden([], 'stats', true)).toEqual(['stats'])
  expect(withHidden(['stats'], 'home', true)).toEqual(['home', 'stats'])
  expect(withHidden(['home', 'stats'], 'home', true)).toEqual(['home', 'stats'])
  expect(withHidden(['home', 'stats'], 'home', false)).toEqual(['stats'])
})

it('knows which entry a page belongs to', () => {
  expect([navOf('mix'), navOf('radio'), navOf('add'), navOf('songs'), navOf('settings')]).toEqual(['mixes', 'radio', 'add', null, null])
})

it('keeps everything visible by default and only entries that exist from a saved file', () => {
  expect(sanitize({}).hiddenNav).toEqual([])
  expect(sanitize({ hiddenNav: ['radio', 'settings', 'radio', 7, 'stats'] }).hiddenNav).toEqual(['radio', 'stats'])
  expect(sanitize({ hiddenNav: 'radio' }).hiddenNav).toEqual([])
})
