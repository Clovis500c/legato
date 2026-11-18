import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../app/store'
import type { LibraryTrack, TasteSignal } from '../../shared/api'
import { mergeRadios } from './crowd'
import type { PickWhy } from './pickWhy'
import { endListen, progress, startListen } from './listens'
import type { Candidate, Taste } from './score'
import { pickSimilar } from './similarRank'
import { mixFromSong } from './songMix'
import { markPicks, usePlayer } from './store'
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

// Three radios of the last three songs, overlapping (slice 1 of docs/recommendation.md): each answers 40 songs of its own, and four
// songs come in all of them (the crowd's "played together") at middle places, one more in only one of them, late.
describe('several radios, merged', () => {
  const unique = (r: number) => range(40).map((i) => ({ ...song(-(1000 * (r + 1) + i), `Crowd ${r}-${i % 10}`), ids: { youtube: `c${r}-${i}` } }))
  const shared = range(4).map((i) => ({ ...song(-(9000 + i), `Shared ${i}`), ids: { youtube: `s${i}` } }))
  const lone = { ...song(-9100, 'Lone'), ids: { youtube: 'lone' } }
  const radios = [0, 1, 2].map((r) => {
    const list = unique(r)
    shared.forEach((t, i) => list.splice(10 + 3 * i + r, 0, t))
    if (r === 0) list.splice(35, 0, lone)
    return list
  })
  const merged = mergeRadios(radios)
  const candidates: Candidate[] = [...library.map((track) => ({ track })), ...merged]
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000)
    useStore.setState({ tracks: library, stats })
    useTaste.setState({ signals, loaded: true })
  })
  afterEach(() => vi.restoreAllMocks())
  const queue = bands.slice(0, 3)
  const ids = (out: LibraryTrack[]) => out.map((t) => t.ids.youtube)

  it('songs in all 3 radios come among the first 5 picks; the one in a single radio at a late place comes after them', () => {
    for (let s = 1; s <= 10; s++) {
      const out = ids(pickSimilar(candidates, queue, 2, mine, 'balanced', 15, seeded(s), library))
      const top = out.slice(0, 5).filter((v) => v?.startsWith('s')).length
      expect(top, `seed ${s}`).toBeGreaterThanOrEqual(2)
      if (out.includes('lone')) expect(out.indexOf('lone')).toBeGreaterThan(Math.max(...shared.map((t) => out.indexOf(t.ids.youtube!))))
    }
  })

  it('the caps still hold: at most 2 favourites of another style, no artist more than twice in 10', () => {
    for (let s = 1; s <= 10; s++) {
      const out = pickSimilar(candidates, queue, 2, mine, 'balanced', 15, seeded(s), library)
      expect(out.filter((t) => t.artist === 'Fav').length).toBeLessThanOrEqual(2)
      const n = new Map<string, number>()
      for (const t of out.slice(0, 10)) n.set(t.artist, (n.get(t.artist) ?? 0) + 1)
      expect(Math.max(...n.values())).toBeLessThanOrEqual(2)
    }
  })

  it('signed out or in, the same radios give the same picks', () => {
    const a = pickSimilar(candidates, queue, 2, mine, 'balanced', 15, seeded(3), library).map((t) => t.id)
    const b = pickSimilar([...merged.slice().reverse(), ...library.map((track) => ({ track }))].reverse(), queue, 2, mine, 'balanced', 15, seeded(3), library).map((t) => t.id)
    expect(b).toEqual(a)
  })

  it('a song in all 3 radios that was heard many times today does not take the top spot (the rest term still applies)', () => {
    const heard = shared[0]
    const stat = { ...stats, [heard.id]: [30, NOW - 3600] as [number, number] }
    const sig = new Map(signals).set(heard.id, signal(heard.id, { playsDecayed: 8, playsLong: 12, lastPlayed: NOW - 3600 }))
    useStore.setState({ stats: stat })
    for (let s = 1; s <= 10; s++) {
      const out = pickSimilar(candidates, queue, 2, tasteFor(stat, sig), 'balanced', 15, seeded(s), library)
      expect(ids(out)[0], `seed ${s}`).not.toBe('s0')
    }
  })
})

// An early skip of the algorithm's own picks steers what is queued, outside Shuffle too (docs/recommendation.md › In the session).
describe('an early skip of a pick, shuffle off', () => {
  const by = (artist: string, from: number, n: number) => range(n).map((i) => ({ ...song(from + i, artist), ids: { youtube: `p${from + i}` } }))
  const playlist = [...by('Own', 500, 10)]
  const aPicks = by('Artist A', 600, 6)
  const others = by('Other', 700, 12)
  // What a run-out adds: A's songs spread among others', 18 in all.
  const picks = range(18).map((i) => (i % 3 === 0 ? aPicks[i / 3] : others[i - 1 - Math.floor(i / 3)]))
  const pos = (id: number) => usePlayer.getState().order.map((i) => usePlayer.getState().list[i].id).indexOf(id)
  const start = (extra: LibraryTrack[] = []) => {
    markPicks([])
    usePlayer.setState({ list: playlist, index: 0, order: playlist.map((_, i) => i), added: [], shuffle: false, now: { title: 't', artist: 'a', trackId: playlist[0].id, via: 'youtube' } as never })
    for (const t of extra) usePlayer.getState().enqueue([t], false, true)
    usePlayer.getState().enqueue(picks, false, false)
  }
  /** `t` is heard for 4 s and skipped. */
  const skip = (t: LibraryTrack) => {
    const { list } = usePlayer.getState()
    usePlayer.setState({ index: list.findIndex((x) => x.id === t.id), now: { title: 't', artist: 'a', trackId: t.id, via: 'youtube' } as never })
    startListen(t.id, 200_000)
    progress(1000)
    progress(4000)
    endListen(false)
  }
  const nextTen = () => {
    const { list, order, index } = usePlayer.getState()
    return order.slice(order.indexOf(index) + 1, order.indexOf(index) + 11).map((i) => list[i])
  }
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000)
    useStore.setState({ tracks: library, stats })
    useTaste.setState({ signals, loaded: true })
  })
  afterEach(() => vi.restoreAllMocks())

  it('the other picks of that artist leave the next 10; a song you queued and the playlist keep their places', () => {
    const mineA = { ...song(650, 'Artist A'), ids: { youtube: 'p650' } }
    const ownA = playlist[7]
    start([mineA])
    const before = (id: number) => pos(id)
    const [mineAt, ownAt] = [before(mineA.id), before(ownA.id)]
    const playlistAt = playlist.map((t) => pos(t.id))
    skip(aPicks[0])
    expect(nextTen().filter((t) => t.artist === 'Artist A' && t.id !== mineA.id)).toEqual([])
    expect(pos(mineA.id)).toBe(mineAt)
    expect(pos(ownA.id)).toBe(ownAt)
    expect(new Set(usePlayer.getState().order).size).toBe(usePlayer.getState().list.length)
    expect(playlist.map((t) => pos(t.id))).toEqual(playlistAt)
  })

  it('skipped twice, all of that artist’s picks go to the end', () => {
    start()
    skip(aPicks[0])
    skip(aPicks[1])
    const { list, order, index } = usePlayer.getState()
    const after = order.slice(order.indexOf(index) + 1).map((i) => list[i])
    const firstA = after.findIndex((t) => t.artist === 'Artist A')
    expect(firstA).toBeGreaterThanOrEqual(0)
    expect(after.slice(firstA).every((t) => t.artist === 'Artist A')).toBe(true)
  })

  it('a mix from a song: its songs are picks, the seed and others by the same artist are steered the same way', () => {
    const mix = [aPicks[0], ...picks]
    markPicks([])
    usePlayer.setState({ list: mix, index: 0, order: mix.map((_, i) => i), added: [], shuffle: false, now: { title: 't', artist: 'a', trackId: mix[0].id, via: 'youtube' } as never })
    markPicks(mix.slice(1).map((t) => t.id))
    skip(picks[0])
    expect(nextTen().some((t) => t.artist === 'Artist A')).toBe(false)
  })

  it('a song that is not a pick moves nothing', () => {
    start()
    const before = usePlayer.getState().order
    skip(playlist[0])
    expect(usePlayer.getState().order).toEqual(before)
  })
})

// "Why this song" (docs/recommendation.md, slice 2): every pick carries ONE reason, the part of its fit that counted most.
describe('every pick carries one reason', () => {
  const KINDS = ['radios', 'radio', 'after', 'artist', 'style', 'new']
  const radioOf = (r: number) => range(30).map((i) => ({ ...song(-(2000 * (r + 1) + i), `Why ${r}-${i % 10}`), ids: { youtube: `w${r}-${i}` } }))
  const sharedSong = { ...song(-9500, 'Shared one'), ids: { youtube: 'ws' } }
  const radios = [0, 1, 2].map((r) => {
    const l = radioOf(r)
    l.splice(2 + r, 0, sharedSong)
    return l
  })
  const candidates: Candidate[] = [...library.map((track) => ({ track })), ...mergeRadios(radios)]
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000)
    useStore.setState({ tracks: library, stats })
    useTaste.setState({ signals, loaded: true })
  })
  afterEach(() => vi.restoreAllMocks())

  it('Up next’s end: one known reason per pick, and the song of all 3 radios says so', () => {
    for (let s = 1; s <= 8; s++) {
      const why = new Map<number, PickWhy>()
      const out = pickSimilar(candidates, bands.slice(0, 3), 2, mine, 'balanced', 15, seeded(s), library, undefined, why)
      expect(out).toHaveLength(15)
      for (const t of out) expect(KINDS, `seed ${s} ${t.title}`).toContain(why.get(t.id)?.kind)
      expect(why.size).toBe(out.length)
      const shared = why.get(sharedSong.id)
      if (shared) expect(shared).toEqual({ kind: 'radios', n: 3 })
    }
  })

  it('a mix from a song: every song after the seed carries one', () => {
    const seed = bands[0]
    const why = new Map<number, PickWhy>()
    const out = mixFromSong({ seed, candidates, taste: mine, variety: 'balanced', rand: seeded(4), library, why })
    expect(out[0]).toBe(seed)
    expect(out.length).toBeGreaterThan(5)
    for (const t of out.slice(1)) expect(KINDS, t.title).toContain(why.get(t.id)?.kind)
  })

  it('a pick from an explore slot says it is new; the others never do', () => {
    let news = 0
    for (let s = 1; s <= 8; s++) {
      const why = new Map<number, PickWhy>()
      pickSimilar(candidates, bands.slice(0, 3), 2, mine, 'adventurous', 15, seeded(s), library, undefined, why)
      news += [...why.values()].filter((w) => w.kind === 'new').length
    }
    expect(news).toBeGreaterThan(0)
  })
})
