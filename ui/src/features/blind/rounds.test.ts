import { expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { ANSWER_MS, pickRounds, pointFor, SNIPPET_MS, snippetStart, TIMED_OUT } from './rounds'

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

it('a round is a point for the right answer only; time running out (no answer) is none', () => {
  expect(pointFor(2, 2)).toBe(1)
  expect(pointFor(1, 2)).toBe(0)
  expect(pointFor(TIMED_OUT, 2)).toBe(0)
  expect(TIMED_OUT).toBeLessThan(0)
  // Long enough to hear the whole snippet and think a little.
  expect(ANSWER_MS).toBeGreaterThan(SNIPPET_MS)
})

it('guessing the artist: four different artists among the answers, the right one in them; fewer than eight artists, no game', () => {
  const tracks = Array.from({ length: 40 }, (_, i) => song(i + 1, { artist: `Artist ${i % 12}` }))
  const game = pickRounds(tracks, 10, seq(), 'artist')
  expect(game).toHaveLength(10)
  for (const r of game) {
    expect(r.choices).toHaveLength(4)
    expect(r.choices).toContain(r.song)
    expect(new Set(r.choices.map((c) => c.artist)).size).toBe(4)
  }
  // Thirty songs by 5 artists make a song game, not an artist one.
  const few = Array.from({ length: 30 }, (_, i) => song(i + 1, { artist: `Artist ${i % 5}` }))
  expect(pickRounds(few, 10, seq(), 'artist')).toEqual([])
  expect(pickRounds(few, 10, seq())).toHaveLength(10)
})
