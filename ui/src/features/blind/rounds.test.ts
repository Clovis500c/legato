import { expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { pickRounds, snippetStart } from './rounds'

const song = (id: number, extra: Partial<LibraryTrack> = {}) => ({ id, title: `Song ${id}`, artist: `Artist ${id}`, durationMs: 200_000, ids: { youtube: `v${id}` }, ...extra }) as LibraryTrack
const seq = () => {
  let n = 0
  return () => ((n = (n * 7 + 3) % 11) / 11)
}

it('picks ten songs, each with the right answer among four different ones', () => {
  const tracks = Array.from({ length: 30 }, (_, i) => song(i + 1))
  const game = pickRounds(tracks, 10, seq())
  expect(game).toHaveLength(10)
  expect(new Set(game.map((r) => r.song.id)).size).toBe(10)
  for (const r of game) {
    expect(r.choices).toHaveLength(4)
    expect(r.choices).toContain(r.song)
    expect(new Set(r.choices.map((c) => c.id)).size).toBe(4)
  }
})

it('leaves out what cannot be asked, one version of a song, and no game under eight songs', () => {
  const tracks = [
    ...Array.from({ length: 8 }, (_, i) => song(i + 1)),
    song(20, { durationMs: 30_000 }),
    song(21, { musicness: 'notMusic' }),
    song(22, { ids: {} }),
    song(23, { title: 'Song 1', artist: 'Artist 1' }),
  ]
  const game = pickRounds(tracks, 10, seq())
  expect(game.map((r) => r.song.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  expect(pickRounds(tracks.slice(0, 7), 10, seq())).toEqual([])
})

it('starts the snippet 30 % in, early enough to play it whole', () => {
  expect(snippetStart(200_000)).toBe(60_000)
  expect(snippetStart(60_000)).toBe(18_000)
  expect(snippetStart(30_000)).toBe(5_000)
  expect(snippetStart(10_000)).toBe(0)
})
