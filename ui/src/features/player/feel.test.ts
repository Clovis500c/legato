import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../app/store'
import type { LibraryTrack, TasteSignal } from '../../shared/api'
import { endListen, progress, startListen } from './listens'
import type { Candidate, Taste } from './score'
import { pickSimilar } from './similarRank'
import { mixFromSong } from './songMix'
import { usePlayer } from './store'
import { tasteFor, useTaste } from './taste'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string) => p, invoke: vi.fn(async () => undefined) }))

// What the owner found horrible (2026-11-17: Shuffle in playlists and mixes), on a made-up library like theirs: streamed songs with
// no genre or year tags; "Fav" played every day and liked, 17 bands barely played, "Skippy" skipped again and again.
const NOW = 1_800_000_000
const DAY = 86_400
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const range = (n: number) => Array.from({ length: n }, (_, i) => i)
const song = (id: number, artist: string): LibraryTrack => ({ id, added: id, addedAt: null, title: `Song ${id}`, artist, album: null, durationMs: 200_000, isrc: null, ids: { youtube: `v${id}` } })
const bands = range(85).map((i) => song(101 + i, `Band ${1 + Math.floor(i / 5)}`))
const fav = range(15).map((i) => song(1 + i, 'Fav'))
const skippy = range(5).map((i) => song(201 + i, 'Skippy'))
const library = [...bands, ...fav, ...skippy]

const stats: Record<number, [number, number, number?]> = {}
for (const t of fav) stats[t.id] = [20, NOW - 3 * DAY]
for (const t of skippy) stats[t.id] = [1, NOW - 5 * DAY]
for (const t of bands.slice(0, 20)) stats[t.id] = [1, NOW - 40 * DAY]
const signal = (id: number, s: Partial<TasteSignal>): TasteSignal => ({ id, playsDecayed: 0, playsLong: 0, lastPlayed: 0, skipsRecent: 0, liked: false, less: false, never: false, hours: 0, near: [], ...s })
const signals = new Map<number, TasteSignal>([
  ...fav.map((t) => [t.id, signal(t.id, { playsDecayed: 6, playsLong: 10, lastPlayed: NOW - 3 * DAY, liked: true })] as const),
  ...skippy.map((t) => [t.id, signal(t.id, { playsDecayed: -1.5, lastPlayed: NOW - 5 * DAY, skipsRecent: 3 })] as const),
  ...bands.slice(0, 20).map((t) => [t.id, signal(t.id, { playsDecayed: 0.3, playsLong: 0.6, lastPlayed: NOW - 40 * DAY })] as const),
])
const mine: Taste = tasteFor(stats, signals)
// YouTube Music's radio of a Band 1 song (about 50 songs, as it answers): other artists of its style, in its order.
const radio: Candidate[] = range(50).map((i) => ({ track: { ...song(-(i + 1), `Radio ${1 + (i % 10)}`), ids: { youtube: `r${i}` } }, rank: i }))
const all: Candidate[] = [...library.map((track) => ({ track })), ...radio]

/** Shuffle on, through the player, with `list[0]` playing. */
function shuffled(list: LibraryTrack[], seed: number): LibraryTrack[] {
  vi.spyOn(Math, 'random').mockImplementation(seeded(seed))
  usePlayer.setState({ list, index: 0, order: [], added: [], shuffle: false, smartShuffle: true, shuffleVariety: 'balanced' })
  usePlayer.getState().toggleShuffle()
  return usePlayer.getState().order.map((i) => list[i])
}

describe('what felt horrible, fixed', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000)
    useStore.setState({ tracks: library, stats })
    useTaste.setState({ signals, loaded: true })
  })
  afterEach(() => vi.restoreAllMocks())

  it('the same songs no longer open every shuffle: over 30 shuffles, most of the playlist gets a turn in the first 10', () => {
    const heads = new Set(range(30).flatMap((s) => shuffled(library, s + 1).slice(1, 11).map((t) => t.id)))
    expect(heads.size).toBeGreaterThanOrEqual(70)
  })

  it('the artist you play most is spread through the shuffle, never every other song', () => {
    for (let s = 1; s <= 30; s++) {
      const head = shuffled(library, s).slice(0, 30).map((t) => t.artist)
      for (let i = 0; i < head.length; i++) for (let j = i + 1; j < Math.min(head.length, i + 4); j++) expect(head[j], `seed ${s}, places ${i} and ${j}`).not.toBe(head[i])
      expect(head.slice(1, 21).filter((a) => a === 'Fav').length).toBeLessThanOrEqual(5)
    }
  })

  it('songs you keep skipping come late', () => {
    const places = range(20).flatMap((s) => {
      const order = shuffled(library, s + 1).map((t) => t.id)
      return skippy.map((t) => order.indexOf(t.id))
    })
    expect(places.reduce((a, b) => a + b, 0) / places.length).toBeGreaterThan(70)
  })

  it('a mix from a song keeps its style: your favourites of another style stay out', () => {
    for (let s = 1; s <= 10; s++) {
      const out = mixFromSong({ seed: bands[0], candidates: all, taste: mine, variety: 'balanced', rand: seeded(s), library })
      expect(out.filter((t) => t.artist === 'Fav').length).toBeLessThanOrEqual(2)
      expect(out.filter((t) => t.id < 0 || t.artist === 'Band 1').length).toBeGreaterThanOrEqual(20)
    }
  })

  it('what plays after Up next follows the queue, not your favourites of another style', () => {
    for (let s = 1; s <= 10; s++) {
      const out = pickSimilar(all, bands.slice(0, 10), 9, mine, 'balanced', 15, seeded(s), library)
      expect(out.filter((t) => t.artist === 'Fav').length).toBeLessThanOrEqual(2)
    }
  })

  it('signed out, what you play together leads: songs you play next to the queue come before your favourites', () => {
    // Band 1's songs are played next to Band 3's and Band 4's, never next to Fav's.
    const near = new Map(bands.slice(0, 5).map((t, i) => [t.id, [bands[10 + i].id, bands[15 + i].id]]))
    const taste: Taste = { ...mine, near: (t) => near.get(t.id) ?? [] }
    for (let s = 1; s <= 10; s++) {
      const out = pickSimilar(library.map((track) => ({ track })), bands.slice(0, 5), 4, taste, 'balanced', 15, seeded(s), library)
      expect(out.filter((t) => t.artist === 'Band 3' || t.artist === 'Band 4').length).toBeGreaterThanOrEqual(5)
      expect(out.filter((t) => t.artist === 'Fav').length).toBeLessThanOrEqual(2)
    }
  })

  // Last: the skips it makes stay in this session's memory.
  it('a skip steers the shuffle at once: the next 10 songs carry none by the skipped artist', () => {
    const list = [fav[0], ...library.filter((t) => t !== fav[0])]
    let tried = 0
    for (let s = 1; s <= 20; s++) {
      const before = shuffled(list, s)
      if (!before.slice(1, 11).some((t) => t.artist === 'Fav')) continue
      tried++
      startListen(fav[0].id, 200_000)
      progress(1000)
      progress(4000)
      endListen(false)
      const after = usePlayer.getState().order.map((i) => list[i])
      expect(after[0]).toBe(fav[0])
      expect(after.slice(1, 11).some((t) => t.artist === 'Fav')).toBe(false)
      expect(new Set(after).size).toBe(list.length)
    }
    expect(tried).toBeGreaterThan(5)
  })
})
