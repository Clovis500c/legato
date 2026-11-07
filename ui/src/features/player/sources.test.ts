import { expect, it } from 'vitest'
import { isFull, nativePath, serverDown, toFind, vias, viaOfPath } from './sources'

it('orders sources: local, YouTube, then preview', () => {
  expect(vias({ ids: { apple: '1', youtube: 'y', local: 'C:/a.flac' } })).toEqual(['local', 'youtube', 'preview'])
  expect(vias({ ids: { apple: '1', spotify: 's' } })).toEqual(['preview'])
  expect(vias({ ids: { spotify: 's' } })).toEqual([])
  // Spotify only once connected (Premium), after YouTube.
  expect(vias({ ids: { spotify: 's', apple: '1', youtube: 'y' } }, true)).toEqual(['youtube', 'spotify', 'preview'])
  expect(isFull({ ids: { spotify: 's' } }, true)).toBe(true)
  expect([isFull({ ids: { apple: '1' } }), isFull({ ids: { youtube: 'y' } })]).toEqual([false, true])
})

it('plays your music server after your files, before YouTube, by an engine path without a URL', () => {
  const t = { ids: { youtube: 'y', server: 's1a2b3c4d:tr-1', local: 'C:/a.flac' } }
  expect(vias(t)).toEqual(['local', 'server', 'youtube'])
  expect(isFull({ ids: { server: 's1:x' } })).toBe(true)
  expect(nativePath(t, 'server')).toBe('server:s1a2b3c4d:tr-1')
  expect(nativePath(t, 'local')).toBe('C:/a.flac')
  expect(nativePath(t, 'youtube')).toBeUndefined()
  expect([viaOfPath('server:s1:x'), viaOfPath('C:/a.flac')]).toEqual(['server', 'local'])
})

it('tells a server that is off or refusing from a song it lacks', () => {
  expect(serverDown("Your music server doesn't answer: check that it's on (tcp connect error)")).toBe(true)
  expect(serverDown('Your music server refused the sign-in (HTTP 401)')).toBe(true)
  expect(serverDown("Your music server isn't signed in")).toBe(true)
  expect(serverDown("Your music server's certificate isn't trusted (a self-signed one?)")).toBe(true)
  expect(serverDown("Your music server doesn't have this item (Song not found)")).toBe(false)
  expect(serverDown('Your music server stopped sending this song (timed out)')).toBe(false)
  expect(serverDown('C:/a.flac: file not found')).toBe(false)
})

it('looks up a library song with no way to play yet, unless it was not found before', () => {
  const notFound = new Set([2])
  expect(toFind({ id: 1, artist: 'A', ids: { spotify: 's' } }, notFound)).toBe(true)
  expect(toFind({ id: 2, artist: 'A', ids: { spotify: 's' } }, notFound)).toBe(false)
  expect(toFind({ id: -1, artist: 'A', ids: { spotify: 's' } }, notFound)).toBe(false)
  expect(toFind({ id: 3, artist: 'A', ids: { apple: '1' } }, notFound)).toBe(false)
  expect(toFind({ id: 4, artist: 'A', ids: { spotify: 's' } }, notFound, true)).toBe(false)
  expect(toFind({ id: 5, artist: ' ', ids: {} }, notFound)).toBe(false)
})
