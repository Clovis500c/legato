import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { restore, snapshot } from './session'

const t = (id: number): LibraryTrack => ({ id, added: id, title: `T${id}`, artist: 'A', album: null, durationMs: null, isrc: null, ids: { youtube: `v${id}` } })
const lib = [t(1), t(2), t(3), t(4)]
const player = { now: { trackId: 3, via: 'youtube' as const }, list: lib, index: 2, order: [2, 0, 3, 1], shuffle: true, repeat: 'all' as const, positionMs: 61_234.5, volume: 0.4 }

describe('session', () => {
  it('nothing from the library playing: nothing saved', () => {
    expect(snapshot({ ...player, now: undefined })).toBeNull()
    expect(snapshot({ ...player, now: { via: 'local' } })).toBeNull()
  })

  it('round trip gives the same queue, position and volume', () => {
    const s = JSON.parse(JSON.stringify(snapshot(player)))
    expect(restore(s, lib)).toEqual({ volume: 0.4, queue: { list: lib, index: 2, order: [2, 0, 3, 1], shuffle: true, repeat: 'all', positionMs: 61_235, via: 'youtube', paused: false } })
  })

  it('remembers a pause (an update relaunch comes back paused)', () => {
    const s = JSON.parse(JSON.stringify(snapshot({ ...player, playing: false })))
    expect(restore(s, lib)?.queue?.paused).toBe(true)
    expect(restore(snapshot({ ...player, playing: true }), lib)?.queue?.paused).toBe(false)
  })

  it('tracks deleted since are dropped, order rebuilt', () => {
    const r = restore(snapshot(player), [t(1), t(3), t(4)])
    expect(r?.queue).toMatchObject({ list: [t(1), t(3), t(4)], index: 1, order: [] })
  })

  it('current track gone or junk: no queue, volume kept when valid', () => {
    expect(restore(snapshot(player), [t(1)])).toEqual({ volume: 0.4, queue: null })
    expect(restore('junk', lib)).toBeNull()
    expect(restore({ ids: ['x'], index: 0, volume: 7 }, lib)).toEqual({ volume: 1, queue: null })
  })
})
