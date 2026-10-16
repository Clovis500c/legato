import { expect, it } from 'vitest'
import { isFull, vias } from './sources'

it('orders sources: local, YouTube, then preview', () => {
  expect(vias({ ids: { apple: '1', youtube: 'y', local: 'C:/a.flac' } })).toEqual(['local', 'youtube', 'preview'])
  expect(vias({ ids: { apple: '1', spotify: 's' } })).toEqual(['preview'])
  expect(vias({ ids: { spotify: 's' } })).toEqual([])
  // Spotify only once connected (Premium), after YouTube.
  expect(vias({ ids: { spotify: 's', apple: '1', youtube: 'y' } }, true)).toEqual(['youtube', 'spotify', 'preview'])
  expect(isFull({ ids: { spotify: 's' } }, true)).toBe(true)
  expect([isFull({ ids: { apple: '1' } }), isFull({ ids: { youtube: 'y' } })]).toEqual([false, true])
})
