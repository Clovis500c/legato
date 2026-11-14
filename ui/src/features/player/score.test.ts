import { describe, expect, it, vi } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { exploreSlots, K, longProfile, rankPicks, scoreAll, type Candidate, type Taste } from './score'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string) => p, invoke: vi.fn() }))

const song = (id: number, artist: string, extra: Partial<LibraryTrack> = {}): LibraryTrack => ({ id, added: id, addedAt: null, title: `Song ${id}`, artist, album: null, durationMs: null, isrc: null, ids: {}, ...extra })
const none: Taste = { rating: () => 0, plays: () => 0, skips: () => 0, never: () => false }
const cands = (l: LibraryTrack[]): Candidate[] => l.map((track) => ({ track }))
const ids = (l: LibraryTrack[]) => l.map((t) => t.id)
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const queue = [song(1, 'Alpha', { genre: 'rock' }), song(2, 'Beta', { genre: 'rock' })]

describe('the shared recommendation score', () => {
  it('a liked artist ranks first, yet no artist exceeds 2 in any 10 picks', () => {
    const fans = Array.from({ length: 12 }, (_, i) => song(100 + i, 'Fave', { genre: 'rock', album: `Al ${i}` }))
    const others = Array.from({ length: 30 }, (_, i) => song(200 + i, `Other ${i}`, { genre: 'rock' }))
    const taste: Taste = { ...none, liked: (t) => t.artist === 'Fave', rating: (t) => (t.artist === 'Fave' ? 10 : 0) }
    const out = rankPicks({ candidates: cands([...fans, ...others]), queue, index: 1, taste, variety: 'balanced', max: 20, rand: seeded(1) })
    expect(out).toHaveLength(20)
    expect(out[0].artist).toBe('Fave')
    for (let i = 0; i + 10 <= out.length; i++) expect(out.slice(i, i + 10).filter((t) => t.artist === 'Fave').length).toBeLessThanOrEqual(K.perArtist)
    for (let i = 1; i < out.length; i++) expect(out[i].artist).not.toBe(out[i - 1].artist)
  })

  it('the explore dose is never 0, at Alike either, and grows with the variety', () => {
    for (const max of [5, 10, 15, 30]) expect(exploreSlots('alike', max)).toBeGreaterThanOrEqual(1)
    expect(exploreSlots('alike', 15)).toBeLessThan(exploreSlots('balanced', 15))
    expect(exploreSlots('balanced', 15)).toBeLessThan(exploreSlots('adventurous', 15))
    // A short ask keeps its best song first.
    expect(exploreSlots('alike', 1)).toBe(0)
  })

  it('a song rated 1-2 or Never never appears; recent skips sink a song', () => {
    const pool = Array.from({ length: 5 }, (_, i) => song(10 + i, `Artist ${i}`, { genre: 'rock' }))
    const taste: Taste = { ...none, rating: (t) => (t.id === 10 ? 1 : 0), never: (t) => t.id === 11, skips: (t) => (t.id === 12 ? 3 : 0) }
    const out = ids(rankPicks({ candidates: cands(pool), queue, index: 1, taste, variety: 'alike', max: 4, rand: seeded(2) }))
    expect(out).not.toContain(10)
    expect(out).not.toContain(11)
    expect(out.at(-1)).toBe(12)
  })

  it('one liked song moves the long profile by at most its cap', () => {
    const one = song(1, 'Solo', { genre: 'jazz' })
    const huge = longProfile([one], () => 1e6)
    const cap = Math.tanh((K.songCap * K.feature.artist) / K.longScale)
    expect(huge.get('a:solo')).toBeCloseTo(cap)
    expect(huge.get('a:solo')!).toBeLessThan(0.6)
    // A hundred of its plays and one play past the cap are the same.
    expect(longProfile([one], () => 100).get('a:solo')).toBeCloseTo(cap)
  })

  it('the same input and seed give the same list; z-scores have no spread when everything is alike', () => {
    const pool = Array.from({ length: 40 }, (_, i) => song(100 + i, `A${i % 9}`, { genre: i % 2 ? 'rock' : 'folk' }))
    const run = (seed: number) => ids(rankPicks({ candidates: cands(pool), queue, index: 1, taste: none, variety: 'adventurous', max: 15, rand: seeded(seed) }))
    expect(run(7)).toEqual(run(7))
    expect(scoreAll(cands([song(1, 'X'), song(2, 'X')]), new Map(), null, none, 0).map((x) => x.z)).toEqual([0, 0])
  })

  it('10 000 songs: the profile, the scores and 15 picks in under 50 ms', () => {
    const lib = Array.from({ length: 10_000 }, (_, i) => song(1000 + i, `Artist ${i % 700}`, { genre: `g${i % 25}`, year: 1960 + (i % 60), album: `Album ${i % 1500}`, bpm: 80 + (i % 90), key: `k${i % 24}` }))
    const taste: Taste = { ...none, decayed: (t) => (t.id % 7 === 0 ? 2 : 0), plays: (t) => (t.id % 7 === 0 ? 2 : 0) }
    const go = () => rankPicks({ candidates: cands(lib), queue, index: 1, taste, variety: 'balanced', max: 15, rand: seeded(3), library: lib })
    go()
    const t0 = performance.now()
    const out = go()
    expect(performance.now() - t0).toBeLessThan(50)
    expect(out).toHaveLength(15)
  })
})
