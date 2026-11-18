import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../app/store'
import type { LibraryTrack, TasteSignal } from '../../shared/api'
import { usePlayer } from './store'
import { useTaste } from './taste'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string) => p, invoke: vi.fn(async () => undefined) }))

const song = (id: number): LibraryTrack => ({ id, added: 0, addedAt: null, title: `Song ${id}`, artist: `Artist ${id}`, album: null, durationMs: null, isrc: null, ids: { youtube: `v${id}` } })
const list = Array.from({ length: 60 }, (_, i) => song(i + 1))
const signal = (id: number): TasteSignal => ({ id, playsDecayed: 5, playsLong: 5, lastPlayed: 0, skipsRecent: 0, liked: true, less: false, never: false, hours: 0, near: [] })

describe('Shuffle reads the taste store', () => {
  afterEach(() => {
    useTaste.setState({ signals: new Map(), loaded: false })
    vi.restoreAllMocks()
  })

  const meanPlace = (ids: number[]) => {
    let sum = 0
    for (let r = 0; r < 40; r++) {
      usePlayer.setState({ list, index: 0, order: [], shuffle: false, smartShuffle: true, shuffleVariety: 'alike' })
      usePlayer.getState().toggleShuffle()
      const { order } = usePlayer.getState()
      sum += ids.reduce((s, id) => s + order.indexOf(id - 1), 0) / ids.length
    }
    return sum / 40
  }

  it('a loaded store brings the songs you like sooner; a cold store still shuffles, with no wait', () => {
    useStore.setState({ tracks: list, stats: {} })
    const loved = [20, 21, 22, 23, 24, 25]
    // Cold: a plain smart order, nothing awaited (the call returns an order at once).
    const cold = meanPlace(loved)
    expect(usePlayer.getState().order).toHaveLength(60)
    useTaste.setState({ signals: new Map(loved.map((id) => [id, signal(id)])), loaded: true })
    const warm = meanPlace(loved)
    expect(warm).toBeLessThan(cold - 5)
    expect(usePlayer.getState().order[0]).toBe(0)
  })
})
