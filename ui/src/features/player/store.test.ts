import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../app/store'
import type { LibraryTrack } from '../../shared/api'
import { rememberEnd } from './ends'
import { NO_FADE } from './fade'
import { useSponsor } from './sponsor'
import { bindFrame, tailVolume, usePlayer } from './store'

const song = (id: number): LibraryTrack => ({ id, added: 0, addedAt: null, title: `Song ${id}`, artist: 'Artist', album: null, durationMs: null, isrc: null, ids: { youtube: `video${id}` } })
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

describe('network gone', () => {
  const notify = vi.fn()
  beforeEach(() => {
    notify.mockClear()
    useStore.setState({ notify })
    usePlayer.setState({ repeat: 'off' })
    // The webview's online / offline events, here.
    vi.stubGlobal('window', new EventTarget())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('blames no video: paused with one notice, the same song again once back online', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    usePlayer.getState().playTracks([song(21), song(22)], 0)
    // Player errors while the Wi-Fi is down (before 2026-10-30: blocked for good, then skipped).
    usePlayer.getState().onYoutube({ error: 5 })
    usePlayer.getState().onYoutube({ error: 5 })
    await settle()
    const p = usePlayer.getState()
    expect(p.now?.youtubeId).toBe('video21')
    expect(p.playing).toBe(false)
    expect(notify).toHaveBeenCalledTimes(1)
    vi.stubGlobal('navigator', { onLine: true })
    window.dispatchEvent(new Event('online'))
    // A new embed (the old one holds an error page), asked to play.
    expect(usePlayer.getState()).toMatchObject({ playing: true, playId: p.playId + 1, frameKey: p.frameKey + 1 })
    expect(usePlayer.getState().now?.youtubeId).toBe('video21')
  })

  it('moved on meanwhile: nothing starts again', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    usePlayer.getState().playTracks([song(23)], 0)
    usePlayer.getState().onYoutube({ error: 5 })
    await settle()
    // A local file now (another source): the YouTube song stays behind.
    usePlayer.setState((s) => ({ playId: s.playId + 1, now: s.now && { ...s.now, via: 'local' } }))
    const { playId } = usePlayer.getState()
    vi.stubGlobal('navigator', { onLine: true })
    window.dispatchEvent(new Event('online'))
    expect(usePlayer.getState().playId).toBe(playId)
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

// YouTube sends a video's length once, as it loads; later reports carry the time alone.
describe('song ends', () => {
  it('fades the overlap’s old song out to its end, then stops it there', async () => {
    usePlayer.setState({ repeat: 'off', volume: 1, fade: { out: 8, in: 8, outCurve: 'linear', inCurve: 'linear', skip: false, pause: 0 } })
    usePlayer.getState().playTracks([song(31), song(32)], 0)
    await settle()
    usePlayer.getState().onYoutube({ state: 1, time: 1, duration: 200 })
    usePlayer.getState().onYoutube({ time: 192.5 })
    expect(usePlayer.getState().now?.youtubeId).toBe('video32')
    expect(usePlayer.getState().tail).toMatchObject({ videoId: 'video31', end: 200_000, done: false })
    // Regression guard: the old song played on at full volume under the next one (2026-10-30).
    expect(tailVolume({ time: 196 })).toBe(50)
    expect(tailVolume({ time: 200 })).toBeUndefined()
    expect(usePlayer.getState().tail?.done).toBe(true)
  })

  it('moves on at a learned early end', async () => {
    usePlayer.setState({ repeat: 'off', fade: NO_FADE })
    rememberEnd('video34', 150)
    usePlayer.getState().playTracks([song(34), song(35)], 0)
    await settle()
    usePlayer.getState().onYoutube({ state: 1, time: 1, duration: 160 })
    expect(usePlayer.getState().durationMs).toBe(150_000)
    usePlayer.getState().onYoutube({ time: 149 })
    expect(usePlayer.getState().now?.youtubeId).toBe('video34')
    usePlayer.getState().onYoutube({ time: 150.2 })
    expect(usePlayer.getState().now?.youtubeId).toBe('video35')
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

// SponsorBlock's marked parts (sponsor.ts); the answer comes from Rust, here it is put in by hand.
describe('skip non-music parts', () => {
  const notify = vi.fn()
  const post = vi.fn()
  // Seconds the player was told to seek to.
  const seeks = () => post.mock.calls.flatMap(([m]) => (JSON.parse(m as string).func === 'seekTo' ? [JSON.parse(m as string).args[0] as number] : []))
  beforeEach(() => {
    notify.mockClear()
    post.mockClear()
    useStore.setState({ notify })
    bindFrame({ contentWindow: { postMessage: post } } as unknown as HTMLIFrameElement)
    usePlayer.setState({ repeat: 'off', fade: NO_FADE, skipNonMusic: true })
  })
  afterEach(() => {
    bindFrame(null)
    usePlayer.setState({ skipNonMusic: false })
  })

  it('starts a video with a known intro at the music, once, with a notice that undoes it', async () => {
    usePlayer.getState().playTracks([song(41), song(42)], 0)
    await settle()
    useSponsor.setState({ video: 'video41', segs: [{ startS: 0, endS: 24 }] })
    usePlayer.getState().onYoutube({ state: 1, time: 0.5, duration: 200 })
    expect(seeks()).toEqual([24])
    expect(notify).toHaveBeenCalledWith('Skipped a non-music part (0:24)', expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }))
    // Seeking back into it stays there.
    usePlayer.getState().onYoutube({ time: 3 })
    expect(seeks()).toEqual([24])
    // Undo: back to the part's start, and this video is left alone.
    notify.mock.calls[0][1].action.run()
    expect(seeks()).toEqual([24, 0])
    usePlayer.getState().playTracks([song(41)], 0)
    await settle()
    useSponsor.setState({ video: 'video41', segs: [{ startS: 0, endS: 24 }] })
    post.mockClear()
    usePlayer.getState().onYoutube({ state: 1, time: 0.5, duration: 200 })
    expect(seeks()).toEqual([])
  })

  it('an outro running to the end is where the song ends: the next one starts there', async () => {
    usePlayer.getState().playTracks([song(43), song(44)], 0)
    await settle()
    useSponsor.setState({ video: 'video43', segs: [{ startS: 150, endS: 160 }] })
    usePlayer.getState().onYoutube({ state: 1, time: 1, duration: 160 })
    expect(usePlayer.getState().durationMs).toBe(150_000)
    usePlayer.getState().onYoutube({ time: 150.3 })
    expect(usePlayer.getState().now?.youtubeId).toBe('video44')
  })

  it('does nothing with the setting off', async () => {
    usePlayer.setState({ skipNonMusic: false })
    usePlayer.getState().playTracks([song(45)], 0)
    await settle()
    useSponsor.setState({ video: 'video45', segs: [{ startS: 0, endS: 24 }] })
    usePlayer.getState().onYoutube({ state: 1, time: 0.5, duration: 200 })
    expect(seeks()).toEqual([])
  })
})
