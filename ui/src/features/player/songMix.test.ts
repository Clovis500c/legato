import { describe, expect, it, vi } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import type { Taste } from './score'
import { keyClash, MIX_LEN, mixFromSong } from './songMix'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string) => p, invoke: vi.fn() }))

const KEYS = ['C', 'G', 'D', 'Am', 'Em', 'F', 'Dm']
const song = (id: number, extra: Partial<LibraryTrack> = {}): LibraryTrack => ({ id, added: id, addedAt: null, title: `Song ${id}`, artist: `Artist ${id % 40}`, album: `Album ${id}`, durationMs: null, isrc: null, ids: {}, genre: 'rock', year: 1995, ...extra })
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const none: Taste = { rating: () => 0, plays: () => 0, skips: () => 0, never: () => false }
// A library of 200 rock songs with tempo spread over 70-170 and keys in step, all near the seed in style.
const lib = Array.from({ length: 200 }, (_, i) => song(i + 1, { bpm: 70 + ((i * 7) % 100), key: KEYS[i % KEYS.length] }))
const seed = lib[10]
const run = (taste: Taste = none, tracks = lib, s = seed, rand = seeded(1)) => mixFromSong({ seed: s, candidates: tracks.map((track) => ({ track })), taste, variety: 'balanced', rand })

describe('a mix from a song', () => {
  it('30 songs, the seed first, none twice', () => {
    const out = run()
    expect(out).toHaveLength(MIX_LEN)
    expect(out[0].id).toBe(seed.id)
    expect(new Set(out.map((t) => t.id)).size).toBe(MIX_LEN)
  })

  it('each step moves at most 12 bpm where both tempos are known, and avoids a clashing key', () => {
    for (let s = 1; s <= 10; s++) {
      const out = run(none, lib, seed, seeded(s))
      for (let i = 1; i < out.length; i++) {
        expect(Math.abs(out[i].bpm! - out[i - 1].bpm!), `${s}:${i}`).toBeLessThanOrEqual(12)
        expect(keyClash(out[i - 1].key, out[i].key), `${s}:${i}`).toBe(false)
      }
    }
  })

  it('an unknown tempo or key is no obstacle, and the same style only', () => {
    const bare = Array.from({ length: 80 }, (_, i) => song(500 + i))
    const folk = Array.from({ length: 40 }, (_, i) => song(700 + i, { genre: 'folk', year: 1950, artist: `Folk ${i}` }))
    const out = run(none, [...bare, ...folk], bare[3])
    expect(out).toHaveLength(MIX_LEN)
    expect(out.every((t) => t.genre === 'rock')).toBe(true)
  })

  it('every third song is a favourite (when the tempo and key rules allow one: at least 7 in 10)', () => {
    const fav = (t: LibraryTrack) => t.id % 5 === 0
    const taste: Taste = { ...none, rating: (t) => (fav(t) ? 10 : 0) }
    const out = run(taste)
    // After the seed: positions 3, 6, 9... (1-based).
    const slots = out.filter((_, i) => i > 0 && (i + 1) % 3 === 0)
    expect(slots.filter(fav).length).toBeGreaterThanOrEqual(Math.floor(slots.length * 0.7))
  })

  it('none rated 1-2, Never, or recently skipped; a library under 30 songs gives fewer; 0 or 1 song does not crash', () => {
    const taste: Taste = { ...none, rating: (t) => (t.id % 7 === 0 ? 1 : 0), never: (t) => t.id % 11 === 0, skips: (t) => (t.id % 13 === 0 ? 2 : 0) }
    const out = run(taste)
    expect(out.slice(1).every((t) => t.id % 7 !== 0 && t.id % 11 !== 0 && t.id % 13 !== 0)).toBe(true)
    expect(run(none, lib.slice(0, 12), lib[0])).toHaveLength(12)
    expect(run(none, [lib[0]], lib[0])).toEqual([lib[0]])
    expect(run(none, [], lib[0])).toEqual([lib[0]])
  })

  it('the same input and seed give the same mix', () => {
    expect(run(none, lib, seed, seeded(5)).map((t) => t.id)).toEqual(run(none, lib, seed, seeded(5)).map((t) => t.id))
  })
})
