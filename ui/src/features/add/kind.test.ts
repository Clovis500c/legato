import { expect, it } from 'vitest'
import { unofficial, videoKind } from './kind'

it('reads video flavour from titles', () => {
  expect(videoKind('Daft Punk - Get Lucky (Official Video)')).toBe('clip')
  expect(videoKind('Get Lucky (Live at the Grammys)')).toBe('live')
  expect(videoKind('Get Lucky - Acoustic Cover')).toBe('cover')
  expect(videoKind('Get Lucky KARAOKE version')).toBe('karaoke')
  expect(videoKind('Get Lucky (Lyrics)')).toBe('lyrics')
  expect(videoKind('Get Lucky')).toBeNull()
  expect(videoKind('Oliver Twist')).toBeNull()
  expect([unofficial('cover'), unofficial('clip')]).toEqual([true, false])
})
