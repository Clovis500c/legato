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
