import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../app/store'
import type { LibraryTrack } from '../../shared/api'
import { usePlayer } from './store'

const song = (id: number): LibraryTrack => ({ id, added: 0, title: `Song ${id}`, artist: 'Artist', album: null, durationMs: null, isrc: null, ids: { youtube: `video${id}` } })
// No Tauri here: IPC calls fail, other uploads come back empty. A macrotask lets their awaits settle.
const settle = () => new Promise((r) => setTimeout(r))
const STOPPED = 'No song in the queue can play here: stopped'

describe('queue of refused videos on repeat all', () => {
  const notify = vi.fn()
  beforeEach(() => {
    notify.mockClear()
    useStore.setState({ notify })
    usePlayer.setState({ repeat: 'all' })
  })

  it('stops after one pass, with one notice for the stop', async () => {
    // Regression guard: an endless loop ends here (repeat off) instead of hanging the run.
    const guard = usePlayer.subscribe((s) => void (s.playId > 50 && s.repeat === 'all' && usePlayer.setState({ repeat: 'off' })))
    usePlayer.getState().playTracks([song(1), song(2)], 0)
    // Embed refuses each one (embedding off), no video slot for the watch page.
    usePlayer.getState().onYoutube({ error: 150 })
    await settle()
    expect(usePlayer.getState().now?.youtubeId).toBe('video2')
    usePlayer.getState().onYoutube({ error: 150 })
    await settle()
    guard()
    expect(usePlayer.getState().playing).toBe(false)
    expect(notify.mock.calls.map((c) => c[0] === STOPPED)).toEqual([false, true])
  })

  it('still plays the one song that can', async () => {
    usePlayer.getState().playTracks([song(3), song(4)], 0)
    usePlayer.getState().onYoutube({ error: 150 })
    await settle()
    // Song 4 plays to its end: song 3 refused again, song 4 again.
    usePlayer.getState().onYoutube({ state: 1, time: 1 })
    usePlayer.getState().onYoutube({ state: 0 })
    await settle()
    expect(usePlayer.getState().now?.youtubeId).toBe('video4')
    expect(usePlayer.getState().playing).toBe(true)
    expect(notify.mock.calls.map((c) => c[0])).not.toContain(STOPPED)
  })
})

describe('fade in', () => {
  it('is short for a song picked by hand, full for one that follows on its own', async () => {
    usePlayer.setState({ repeat: 'off', fade: { out: 5, in: 5, outCurve: 'scurve', inCurve: 'scurve', skip: true, pause: 0 } })
    usePlayer.getState().playTracks([song(5), song(6)], 0)
    expect(usePlayer.getState().fadeIn).toBe(1)
    usePlayer.getState().onYoutube({ state: 1, time: 1 })
    usePlayer.getState().onYoutube({ state: 0 })
    await settle()
    expect(usePlayer.getState().now?.youtubeId).toBe('video6')
    expect(usePlayer.getState().fadeIn).toBe(5)
  })
})

describe('resume', () => {
  it('brings back the songs the user queued with their order, not with a rebuilt one', () => {
    const list = [song(7), song(8), song(9)]
    usePlayer.getState().resume({ list, index: 0, order: [0, 2, 1], added: [2], shuffle: false, repeat: 'off', positionMs: 0, paused: true })
    expect(usePlayer.getState().added).toEqual([2])
    usePlayer.getState().resume({ list, index: 0, order: [], added: [2], shuffle: false, repeat: 'off', positionMs: 0, paused: true })
    expect(usePlayer.getState().added).toEqual([])
  })
})

describe('pause while a YouTube video starts', () => {
  it('stays paused when YouTube plays it anyway; a play from its own controls later counts', async () => {
    usePlayer.setState({ repeat: 'off', fade: { out: 5, in: 5, outCurve: 'scurve', inCurve: 'scurve', skip: true, pause: 0 } })
    usePlayer.getState().playTracks([song(11)], 0)
    await settle()
    usePlayer.getState().toggle()
    usePlayer.getState().onYoutube({ state: 1, time: 0.2 })
    expect(usePlayer.getState().playing).toBe(false)
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 6_000)
    usePlayer.getState().onYoutube({ state: 1, time: 3 })
    expect(usePlayer.getState().playing).toBe(true)
    vi.restoreAllMocks()
  })
})
