import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../app/store'
import { api, type LibraryTrack } from '../../shared/api'
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

describe('no fade within an album', () => {
  const post = vi.fn()
  // Volumes sent to the embed, %.
  const volumes = () => post.mock.calls.flatMap(([m]) => (JSON.parse(m as string).func === 'setVolume' ? [JSON.parse(m as string).args[0] as number] : []))
  const track = (id: number, album: string | null): LibraryTrack => ({ ...song(id), album })
  beforeEach(() => {
    post.mockClear()
    bindFrame({ contentWindow: { postMessage: post } } as unknown as HTMLIFrameElement)
    usePlayer.setState({ repeat: 'off', volume: 1, gaplessAlbums: true, fade: { out: 8, in: 8, outCurve: 'linear', inCurve: 'linear', skip: false, pause: 0 } })
  })
  afterEach(() => {
    bindFrame(null)
    usePlayer.setState({ gaplessAlbums: true })
  })

  it('plays on into the album’s next song: no fade out, no overlap, no fade in; another album fades again', async () => {
    usePlayer.getState().playTracks([track(51, 'Live at Pompeii'), track(52, 'Live at Pompeii'), track(53, 'Animals')], 0)
    await settle()
    usePlayer.getState().onYoutube({ state: 1, time: 1, duration: 200 })
    usePlayer.getState().onYoutube({ time: 196 })
    expect(usePlayer.getState().now?.youtubeId).toBe('video51')
    expect(Math.min(...volumes())).toBe(100)
    usePlayer.getState().onYoutube({ state: 0 })
    await settle()
    expect(usePlayer.getState().now?.youtubeId).toBe('video52')
    expect(usePlayer.getState().fadeIn).toBe(0)
    // Animals: the overlap again, the next song fading in.
    usePlayer.getState().onYoutube({ state: 1, time: 1, duration: 200 })
    usePlayer.getState().onYoutube({ time: 192.5 })
    expect(usePlayer.getState().now?.youtubeId).toBe('video53')
    expect(usePlayer.getState().fadeIn).toBe(8)
  })

  it('fades as before with the setting off, or when the album’s songs come out of the list’s order', async () => {
    usePlayer.setState({ gaplessAlbums: false })
    usePlayer.getState().playTracks([track(54, 'Live'), track(55, 'Live')], 0)
    await settle()
    usePlayer.getState().onYoutube({ state: 1, time: 1, duration: 200 })
    usePlayer.getState().onYoutube({ time: 192.5 })
    expect(usePlayer.getState().now?.youtubeId).toBe('video55')
    usePlayer.setState({ gaplessAlbums: true })
    // Shuffled: the album's other song comes next, but not as the list has it.
    usePlayer.getState().playTracks([track(56, 'Live'), track(57, 'Animals'), track(58, 'Live')], 0)
    usePlayer.setState({ order: [0, 2, 1] })
    await settle()
    usePlayer.getState().onYoutube({ state: 1, time: 1, duration: 200 })
    usePlayer.getState().onYoutube({ time: 192.5 })
    expect(usePlayer.getState().now?.youtubeId).toBe('video58')
    expect(usePlayer.getState().fadeIn).toBe(8)
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

describe('pause at once (headphones unplugged)', () => {
  const post = vi.fn()
  // Embed functions called.
  const calls = () => post.mock.calls.map(([m]) => JSON.parse(m as string).func as string)
  beforeEach(() => {
    post.mockClear()
    bindFrame({ contentWindow: { postMessage: post } } as unknown as HTMLIFrameElement)
    usePlayer.setState({ repeat: 'off', fade: { ...NO_FADE, pause: 2000 } })
  })
  afterEach(() => bindFrame(null))

  it('pauses now past a pause fade, stays paused when YouTube plays on, and does nothing more when paused', async () => {
    usePlayer.getState().playTracks([song(61)], 0)
    await settle()
    usePlayer.getState().onYoutube({ state: 1, time: 1 })
    post.mockClear()
    usePlayer.getState().pauseNow()
    expect(usePlayer.getState().playing).toBe(false)
    expect(calls()).toContain('pauseVideo')
    usePlayer.getState().onYoutube({ state: 1, time: 1.1 })
    expect(usePlayer.getState().playing).toBe(false)
    post.mockClear()
    usePlayer.getState().pauseNow()
    expect(calls()).toEqual([])
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

describe('local reports', () => {
  it('keep the queue and a dropped file as they were when only the position moved', () => {
    const report = { path: 'C:/music/a.mp3', positionMs: 1000, durationMs: 200_000, paused: false, upcoming: ['C:/music/b.mp3'], error: null, ended: false, trimEndMs: null }
    usePlayer.setState({ now: undefined, list: [], index: 0, upcoming: [] })
    usePlayer.getState().onLocal(report)
    const { now, upcoming, playId } = usePlayer.getState()
    expect(now).toMatchObject({ path: 'C:/music/a.mp3', via: 'local' })
    // Regression guard: a new array and a new song object 4 times a second re-rendered Up next and Now Playing (2026-11-05).
    usePlayer.getState().onLocal({ ...report, positionMs: 1250, upcoming: ['C:/music/b.mp3'] })
    expect(usePlayer.getState()).toMatchObject({ positionMs: 1250, playId })
    expect(usePlayer.getState().upcoming).toBe(upcoming)
    expect(usePlayer.getState().now).toBe(now)
    usePlayer.getState().onLocal({ ...report, positionMs: 1500, upcoming: [] })
    expect(usePlayer.getState().upcoming).toEqual([])
    usePlayer.getState().onLocal({ ...report, path: 'C:/music/b.mp3', positionMs: 0, upcoming: [] })
    expect(usePlayer.getState()).toMatchObject({ now: { path: 'C:/music/b.mp3' }, playId: playId + 1 })
  })
})

describe('a YouTube video that never starts', () => {
  const post = vi.fn()
  // Videos loaded into the embed by the store (the embed's own first load is PlayerBar's, not mounted here).
  const loads = () => post.mock.calls.flatMap(([m]) => (JSON.parse(m as string).func === 'loadVideoById' ? [JSON.parse(m as string).args[0] as string] : []))
  beforeEach(() => {
    vi.useFakeTimers()
    post.mockClear()
    // No video slot, no box: no room for the watch page.
    bindFrame({ contentWindow: { postMessage: post }, getBoundingClientRect: () => null } as unknown as HTMLIFrameElement)
    usePlayer.setState({ repeat: 'off', fade: NO_FADE, skipNonMusic: false })
  })
  afterEach(() => {
    bindFrame(null)
    vi.useRealTimers()
  })

  it('is loaded again after buffering too long, once', async () => {
    usePlayer.getState().playTracks([song(71), song(72)], 0)
    usePlayer.getState().onYoutube({ state: 3 })
    // Regression guard: waited on for good while it buffered, black (2026-11-01).
    await vi.advanceTimersByTimeAsync(25_000)
    expect(loads()).toEqual([])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(loads()).toEqual(['video71'])
    // Starts this time: nothing more.
    usePlayer.getState().onYoutube({ state: 1, time: 0.3 })
    usePlayer.getState().onYoutube({ time: 2 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(loads()).toEqual(['video71'])
    expect(usePlayer.getState().now?.youtubeId).toBe('video71')
  })

  it('logs its time to sound once, from the ask to its first "playing"', async () => {
    const log = vi.spyOn(api, 'diagLog').mockResolvedValue(undefined)
    usePlayer.getState().playTracks([song(84)], 0)
    await vi.advanceTimersByTimeAsync(1_200)
    usePlayer.getState().onYoutube({ state: 1, time: 0.3 })
    usePlayer.getState().onYoutube({ state: 1, time: 0.6 })
    const timed = log.mock.calls.filter(([, , m]) => String(m).startsWith('youtube: time to sound'))
    expect(timed.map(([, , m]) => m)).toEqual(['youtube: time to sound, asked'])
    expect(Number(String(timed[0][3]).split(' ')[0])).toBeGreaterThanOrEqual(1_200)
    log.mockRestore()
  })

  it('cues the next song in the other embed 5 s in, and Next swaps to it', () => {
    usePlayer.getState().playTracks([song(86), song(87)], 0)
    usePlayer.getState().onYoutube({ state: 1, time: 0.3 })
    usePlayer.getState().onYoutube({ time: 6 })
    const { tail, frameKey } = usePlayer.getState()
    expect(tail).toMatchObject({ videoId: 'video87', done: true, cue: true })
    usePlayer.getState().step(1)
    expect(usePlayer.getState()).toMatchObject({ frameKey: tail!.key, tail: { key: frameKey, videoId: 'video86', done: true } })
    expect(usePlayer.getState().now?.youtubeId).toBe('video87')
    usePlayer.setState({ tail: null })
  })

  it('stuck again once loaded again: refused, then the next song when nothing else can play it', async () => {
    usePlayer.getState().playTracks([song(73), song(74)], 0)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(loads()).toEqual(['video73'])
    // The embed's own "Video unavailable" card: unstarted.
    usePlayer.getState().onYoutube({ state: -1 })
    await vi.advanceTimersByTimeAsync(6_000)
    expect(usePlayer.getState().now?.youtubeId).toBe('video74')
  })

  it('isn’t blocked while the embed says nothing (a network error page): waited on until it answers', async () => {
    usePlayer.getState().playTracks([song(82), song(83)], 0)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(loads()).toEqual(['video82'])
    // Regression guard: blocked for good and skipped 12 s in, 4G without DNS (2026-11-06).
    await vi.advanceTimersByTimeAsync(60_000)
    expect(usePlayer.getState().now?.youtubeId).toBe('video82')
    // Back (ytDown.ts loaded it again): it plays, nothing more asked.
    usePlayer.getState().onYoutube({ state: 1, time: 0.3 })
    usePlayer.getState().onYoutube({ time: 2 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(loads()).toEqual(['video82'])
    expect(usePlayer.getState().now?.youtubeId).toBe('video82')
  })

  it('isn’t hidden by the last song’s “playing”', async () => {
    usePlayer.getState().playTracks([song(75), song(76)], 0)
    usePlayer.getState().onYoutube({ state: 1, time: 1 })
    // Under 5 s: nothing cued yet, Next loads into the same embed (the swap has its own test).
    usePlayer.getState().onYoutube({ time: 4 })
    usePlayer.getState().step(1)
    // The old video's report, sent before the embed took the new one.
    usePlayer.getState().onYoutube({ state: 1, time: 4.25 })
    await vi.advanceTimersByTimeAsync(6_000)
    expect(loads()).toEqual(['video76'])
  })

  it('refused by Google: loaded again at once; refused again: stopped, nothing more asked of it', async () => {
    const notify = vi.fn()
    useStore.setState({ notify })
    usePlayer.getState().playTracks([song(78), song(79)], 0)
    usePlayer.getState().onYoutube({ state: 3 })
    // Regression guard: waited on for 26 s, black and silent (2026-11-01).
    usePlayer.getState().onYoutube({ refused: 403 })
    expect(loads()).toEqual(['video78'])
    usePlayer.getState().onYoutube({ refused: 403 })
    expect(usePlayer.getState().playing).toBe(false)
    expect(notify.mock.calls.map((c) => c[0])).toEqual(['YouTube: Too many requests for now: wait a few minutes, then try again.'])
    // No watch page, no other upload, no next song: the video isn't to blame.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(loads()).toEqual(['video78'])
    expect(usePlayer.getState().now?.youtubeId).toBe('video78')
    // Played by the user: asked once more.
    usePlayer.getState().toggle()
    expect(loads()).toEqual(['video78', 'video78'])
  })

  it('a refusal once started, or while paused, loads nothing until played', async () => {
    usePlayer.getState().playTracks([song(80)], 0)
    usePlayer.getState().onYoutube({ state: 1, time: 0.3 })
    usePlayer.getState().onYoutube({ time: 2 })
    // An older request's late answer.
    usePlayer.getState().onYoutube({ refused: 403 })
    expect(loads()).toEqual([])
    usePlayer.getState().playTracks([song(81)], 0)
    usePlayer.getState().toggle()
    usePlayer.getState().onYoutube({ refused: 403 })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(loads()).toEqual([])
    usePlayer.getState().toggle()
    expect(loads()).toEqual(['video81'])
  })

  it('waits while paused by the user, and is watched again once played', async () => {
    usePlayer.getState().playTracks([song(77)], 0)
    usePlayer.getState().toggle()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(loads()).toEqual([])
    usePlayer.getState().toggle()
    await vi.advanceTimersByTimeAsync(6_000)
    expect(loads()).toEqual(['video77'])
  })
})

describe('Next on the last song of the queue', () => {
  beforeEach(() => usePlayer.setState({ shuffle: false }))

  it('stops there with Repeat off, and starts again with Repeat all', async () => {
    usePlayer.setState({ repeat: 'off' })
    usePlayer.getState().playTracks([song(1), song(2)], 1)
    await settle()
    usePlayer.setState({ playing: true, positionMs: 90_000 })
    usePlayer.getState().step(1)
    await settle()
    expect(usePlayer.getState()).toMatchObject({ index: 1, playing: false, positionMs: 0 })
    usePlayer.setState({ repeat: 'all' })
    usePlayer.getState().playTracks([song(1), song(2)], 1)
    await settle()
    usePlayer.getState().step(1)
    await settle()
    expect(usePlayer.getState().index).toBe(0)
  })

  it('only pauses a radio station: a live stream has no start to seek to', async () => {
    usePlayer.setState({ repeat: 'off' })
    const station: LibraryTrack = { ...song(3), ids: { server: 'radio:https://radio.example/live' } }
    usePlayer.getState().playTracks([song(1), station], 1)
    await settle()
    const player = vi.spyOn(api, 'player').mockResolvedValue(undefined as never)
    usePlayer.setState({ playing: true })
    usePlayer.getState().step(1)
    await settle()
    expect(player.mock.calls.map((c) => c[0].type)).not.toContain('seek')
    expect(usePlayer.getState()).toMatchObject({ index: 1, playing: false })
    player.mockRestore()
  })
})

describe('radio stations in the queue', () => {
  it('each plays alone in the engine: a live stream never hands over to the next one', async () => {
    const sent: string[][] = []
    const spy = vi.spyOn(api, 'player').mockImplementation((cmd) => (cmd.type === 'play' && sent.push(cmd.paths), Promise.resolve()) as never)
    const station = (id: number): LibraryTrack => ({ ...song(-id), id: -id, ids: { server: `radio:https://r${id}.example/live` } })
    usePlayer.setState({ repeat: 'off', shuffle: false })
    usePlayer.getState().playTracks([station(1), station(2), station(3)], 1)
    await settle()
    spy.mockRestore()
    expect(sent).toEqual([['server:radio:https://r2.example/live']])
  })
})
