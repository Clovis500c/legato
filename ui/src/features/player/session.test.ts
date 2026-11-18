import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { restore, snapshot } from './session'

const t = (id: number): LibraryTrack => ({ id, added: id, addedAt: null, title: `T${id}`, artist: 'A', album: null, durationMs: null, isrc: null, ids: { youtube: `v${id}` } })
const lib = [t(1), t(2), t(3), t(4)]
// T4 (index 3) queued by the user: next after T3 in the shuffled order.
const player = { now: { trackId: 3, via: 'youtube' as const }, list: lib, index: 2, order: [2, 3, 0, 1], added: [3], shuffle: true, repeat: 'all' as const, positionMs: 61_234.5, volume: 0.4 }

describe('session', () => {
  it('nothing from the library playing: nothing saved', () => {
    expect(snapshot({ ...player, now: undefined })).toBeNull()
    expect(snapshot({ ...player, now: { via: 'local' } })).toBeNull()
  })

  it('round trip gives the same queue, position and volume, and what the user queued', () => {
    const s = JSON.parse(JSON.stringify(snapshot(player)))
    expect(restore(s, lib)).toEqual({ volume: 0.4, queue: { list: lib, index: 2, order: [2, 3, 0, 1], added: [3], shuffle: true, repeat: 'all', positionMs: 61_235, via: 'youtube', paused: false } })
    // Older sessions (no added) and junk: nothing queued.
    expect(restore({ ...s, added: undefined }, lib)?.queue?.added).toEqual([])
    expect(restore({ ...s, added: [3, -1, 9, 'x'] }, lib)?.queue?.added).toEqual([3])
    // A song from your music server comes back from it, not from its next source.
    const served = JSON.parse(JSON.stringify(snapshot({ ...player, now: { trackId: 3, via: 'server' } })))
    expect(restore(served, lib)?.queue?.via).toBe('server')
    expect(restore({ ...served, via: 'elsewhere' }, lib)?.queue?.via).toBeUndefined()
  })

  it('keeps where the queue was started (Now Playing\'s "From …") through a relaunch, junk dropped', () => {
    const s = JSON.parse(JSON.stringify(snapshot({ ...player, from: 'Road trip', fromKind: 'playlist', fromId: 7 })))
    expect(restore(s, lib)?.queue).toMatchObject({ from: 'Road trip', fromKind: 'playlist', fromId: 7 })
    const odd = restore({ ...s, fromKind: 'elsewhere', fromId: -1 }, lib)?.queue
    expect([odd?.from, odd?.fromKind, odd?.fromId]).toEqual(['Road trip', undefined, undefined])
    const none = restore({ ...s, from: 5 }, lib)?.queue
    expect([none?.from, none?.fromKind, none?.fromId]).toEqual([undefined, undefined, undefined])
  })

  it('remembers a pause (an update relaunch comes back paused)', () => {
    const s = JSON.parse(JSON.stringify(snapshot({ ...player, playing: false })))
    expect(restore(s, lib)?.queue?.paused).toBe(true)
    expect(restore(snapshot({ ...player, playing: true }), lib)?.queue?.paused).toBe(false)
  })

  it('tracks deleted since are dropped, order rebuilt, queued songs back in the list', () => {
    const r = restore(snapshot(player), [t(1), t(3), t(4)])
    expect(r?.queue).toMatchObject({ list: [t(1), t(3), t(4)], index: 1, order: [], added: [] })
  })

  it('songs not in the library come back too (radio, similar songs): an update between two of them resumes', () => {
    const radio = (id: number, v: string): LibraryTrack => ({ ...t(0), id, title: v, ids: { youtube: v } })
    const list = [t(1), radio(-1, 'r1'), radio(-2, 'r2')]
    const s = JSON.parse(JSON.stringify(snapshot({ ...player, list, index: 2, order: [0, 1, 2], now: { trackId: -2, via: 'youtube' } })))
    const q = restore({ ...s, remote: [...s.remote, 'junk', { id: 5, title: 'x', artist: 'y', ids: {} }] }, lib)?.queue
    expect(q?.list.map((x) => x.ids.youtube)).toEqual(['v1', 'r1', 'r2'])
    expect(q?.index).toBe(2)
    expect(q?.list[2].id).toBeLessThan(0)
  })

  it('the parts of a split video come back each as its part; a part saved wrong comes back as the whole video', () => {
    const part = (id: number, startMs: number, endMs: number | null) => ({ ...t(0), id, title: `P${id}`, ids: { youtube: 'mix' }, part: { startMs, endMs } }) as LibraryTrack
    const list = [part(-1, 0, 60_000), part(-2, 60_000, null)]
    const s = JSON.parse(JSON.stringify(snapshot({ ...player, list, index: 1, order: [0, 1], added: [], now: { trackId: -2, via: 'youtube' } })))
    const q = restore(s, lib)?.queue
    expect(q?.list.map((x) => [x.title, (x as { part?: unknown }).part])).toEqual([
      ['P-1', { startMs: 0, endMs: 60_000 }],
      ['P-2', { startMs: 60_000, endMs: null }],
    ])
    expect(new Set(q?.list.map((x) => x.id)).size).toBe(2)
    s.remote[1].part = { startMs: 'x', endMs: -4 }
    expect((restore(s, lib)?.queue?.list[1] as { part?: unknown }).part).toBeUndefined()
  })

  it('current track gone or junk: no queue, volume kept when valid', () => {
    expect(restore(snapshot(player), [t(1)])).toEqual({ volume: 0.4, queue: null })
    expect(restore('junk', lib)).toBeNull()
    expect(restore({ ids: ['x'], index: 0, volume: 7 }, lib)).toEqual({ volume: 1, queue: null })
  })
})
