import { create } from 'zustand'
import { useStore } from '../../app/store'
import { api, type LibraryTrack, type PlayerCommand, type PlayerStatus, type SpotifyCommand, type SpotifyPlayback, type Track } from '../../shared/api'
import type { Box } from '../../shared/artbox'
import { region } from '../../shared/format'
import { endListen, progress, startListen } from './listens'
import { demoGain, demoLength, fadeGain, NO_FADE, type Fade } from './fade'
import { nextIndex, playOrder, queued, type Repeat } from './queue'
import { vias, type Via } from './sources'
import { closeWatch, openWatch, sendWatch, watching } from './watch'
import { ytPost, type YtUpdate } from './youtube'

/** via youtube = embed plays it, else Rust engine (local file, or Apple preview held in memory). */
export interface NowPlaying {
  title: string
  artist: string
  via: Via
  youtubeId?: string
  /** Library row, to highlight it in lists. None = dropped file. */
  trackId?: number
  /** Local file path (format shown in readout). */
  path?: string
  /** Apple Music page of a preview (Apple terms: previews link to the store). */
  page?: string
  spotifyId?: string
}

interface PlayerState {
  now?: NowPlaying
  playing: boolean
  positionMs: number
  durationMs: number | null
  volume: number
  /** One queue for every source: next/prev walk it, each track through its best source. */
  list: LibraryTrack[]
  index: number
  /** List indexes in play order (shuffled or not). */
  order: number[]
  shuffle: boolean
  repeat: Repeat
  /** Fades between songs and on pause (Settings › Player, Advanced). */
  fade: Fade
  /** Current track started on its own after the previous one (or a skip, if asked): fades in. */
  fadeIn: boolean
  /** Where the current item started (resume), ms. */
  startAt: number
  /** Bumped each time an item starts (song, other upload, gapless move): per-song UI state checks it. */
  playId: number
  /** Restored paused (after an update): the first item loads without playing. */
  hold: boolean
  toggleShuffle: () => void
  /** off → all → one → off. */
  cycleRepeat: () => void
  /** Dropped files (not in library): engine queue after current file. */
  upcoming: string[]
  /** Full-screen Now Playing. */
  full: boolean
  setFull: (full: boolean) => void
  /** via = force a source for the first track (context menu "Play via"). */
  playTracks: (list: LibraryTrack[], index: number, via?: Via) => void
  /** next = right after the current track, else at the end. Nothing playing: plays them. */
  enqueue: (tracks: LibraryTrack[], next: boolean) => void
  /** Drops list index `i` from the play order. */
  dequeue: (i: number) => void
  /** Queue item `index` through `via` (default: best source). auto = previous one ended; from = start position, ms. */
  playAt: (index: number, via?: Via, opts?: { auto?: boolean; from?: number; hold?: boolean }) => Promise<void>
  /** Last session's queue, picked up where it stopped. */
  resume: (s: { list: LibraryTrack[]; index: number; order: number[]; shuffle: boolean; repeat: Repeat; positionMs: number; via?: Via; paused?: boolean }) => void
  /** Plays a song change on the current song: fade out, silence, fade in (curve editor's Try it). */
  previewFade: () => void
  /** Sends volume × fade to whatever plays. force = even if unchanged. */
  applyVolume: (force?: boolean) => void
  playFiles: (paths: string[]) => void
  toggle: () => void
  seek: (ms: number) => void
  /** auto = track ended by itself (repeat one replays it). */
  step: (delta: 1 | -1, auto?: boolean) => void
  setVolume: (volume: number) => void
  onYoutube: (u: YtUpdate) => void
  onLocal: (s: PlayerStatus) => void
  /** Spotify Connect poll result. */
  onSpotify: (p: SpotifyPlayback | null) => void
}

// Songs from recommendations play without joining the library: negative ids, one per video for the session.
const remoteIds = new Map<string, number>()

/** Service track → queue item, not in the library (no history, no playlists). */
export function remoteTrack(t: Track): LibraryTrack {
  const key = t.ids.youtube ?? `${t.artist}\u0000${t.title}`
  let id = remoteIds.get(key)
  if (id === undefined) remoteIds.set(key, (id = -(remoteIds.size + 1)))
  return { ...t, id, added: 0 }
}

export const isRemote = (t: { id: number }) => t.id < 0

/** Library row of what plays, else its queue item (a recommendation). */
export function nowTrack(): LibraryTrack | undefined {
  const { now, list } = usePlayer.getState()
  if (now?.trackId === undefined) return undefined
  return useStore.getState().tracks.find((t) => t.id === now.trackId) ?? list.find((t) => t.id === now.trackId)
}

/** Same, as a hook. */
export function useNowTrack(): LibraryTrack | undefined {
  const id = usePlayer((s) => s.now?.trackId)
  const lib = useStore((s) => (id === undefined ? undefined : s.tracks.find((t) => t.id === id)))
  const queued = usePlayer((s) => (id === undefined ? undefined : s.list.find((t) => t.id === id)))
  return lib ?? queued
}

// Embed iframe, bound by PlayerBar.
let frame: HTMLIFrameElement | null = null
export const bindFrame = (el: HTMLIFrameElement | null) => void (frame = el)

// Engine status lags commands: until it reports one of these paths, statuses are stale. [] = ignore all.
let expect: string[] | null = null
// Bumped per playAt: a slow preview download must not override a later choice.
let seq = 0

const send = (cmd: PlayerCommand) => api.player(cmd).catch((e) => useStore.setState({ error: String(e) }))
// Embed, or the watch page when the embed refused the video: same commands.
const yt = (func: string, ...args: unknown[]) => (watching() ? sendWatch(func, args) : ytPost(frame, 'command', func, args))
export const fileTitle = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
const previewPath = (t: LibraryTrack) => `apple:${t.ids.apple}`
const spotifyOn = () => useStore.getState().status.spotify.connected
const spotify = (cmd: SpotifyCommand) => api.spotifyPlayer(cmd).catch((e) => useStore.setState({ error: String(e) }))
// Library local run in engine: drop files queued after current (dropped files keep theirs).
const endRun = () => {
  const now = usePlayer.getState().now
  if (now?.via === 'local' && now.trackId) void send({ type: 'truncate' })
}
// Knob drags fire many changes: one Spotify call per pause.
let volumeTimer: ReturnType<typeof setTimeout> | undefined
// Last volume sent to the playing source (fades send many).
let sent = -1

// Extra volume factor over time (pause fades, fade preview), stepped at 30 Hz. A new ramp replaces the running one.
let gainNow = 1
let rampTimer: ReturnType<typeof setInterval> | undefined
function ramp(gain: (t: number) => number, ms: number, done?: () => void) {
  clearInterval(rampTimer)
  const start = performance.now()
  const tick = () => {
    const t = Math.min(1, (performance.now() - start) / ms)
    gainNow = gain(t)
    usePlayer.getState().applyVolume()
    if (t < 1) return
    clearInterval(rampTimer)
    gainNow = 1
    done?.()
    usePlayer.getState().applyVolume(true)
  }
  rampTimer = setInterval(tick, 33)
  tick()
}

// Videos the embed refused this session (they play from their watch page), videos that can't play at all here, and the
// other uploads still to try for the current track.
const blocked = new Set<string>()
const unplayable = new Set<string>()
let others: { trackId: number; ids: string[] } | null = null

/** Where the video shows: the slot, or the embed's own default spot (iframe box). */
function videoRect(): DOMRect | null {
  return useVideoSlot.getState().rect ?? frame?.getBoundingClientRect() ?? null
}

/** Embed refused the video (owner turned embedding off): same video from YouTube's watch page, where it was. */
function playOnWatchPage(video: string, startMs: number) {
  const rect = videoRect()
  // The embed stops for good: no second player in the background.
  ytPost(frame, 'command', 'pauseVideo')
  if (!rect) return void tryOtherUpload(usePlayer.getState().now?.trackId ?? 0, video, 'This video can’t play in apps')
  // Cover mode: made hidden, it plays unseen.
  openWatch(video, startMs / 1000, useVideoSlot.getState().hidden ? null : rect).catch(() => tryOtherUpload(usePlayer.getState().now?.trackId ?? 0, video, 'This video can’t play in apps'))
}

async function tryOtherUpload(trackId: number, failed: string, why: string) {
  unplayable.add(failed)
  closeWatch()
  const mine = seq
  if (others?.trackId !== trackId) {
    const ids = await api.alternativeVideos(trackId, [...blocked]).catch(() => [])
    if (mine !== seq) return
    others = { trackId, ids }
  }
  const next = others.ids.find((v) => !unplayable.has(v))
  const { notify } = useStore.getState()
  if (next) {
    notify(`${why}: playing another upload of the song`)
    // Same embed: the frame loads the new id (loadVideoById).
    return usePlayer.setState((s) => (s.now ? { now: { ...s.now, youtubeId: next }, playId: s.playId + 1, positionMs: 0, playing: true } : {}))
  }
  notify(`${why}, and no other upload was found: skipped`, { kind: 'error' })
  // Manual step: repeat one would replay the blocked video forever.
  usePlayer.getState().step(1)
}

export const usePlayer = create<PlayerState>((set, get) => ({
  playing: false,
  positionMs: 0,
  durationMs: null,
  volume: 1,
  list: [],
  index: 0,
  order: [],
  shuffle: false,
  repeat: 'off',
  fade: NO_FADE,
  fadeIn: false,
  startAt: 0,
  playId: 0,
  hold: false,
  upcoming: [],
  full: false,
  setFull: (full) => set({ full }),

  playTracks(list, index, via) {
    const i = list.findIndex((t, j) => j >= index && vias(t, spotifyOn()).length > 0)
    if (i < 0) return
    set({ list, order: playOrder(list.length, i, get().shuffle) })
    void get().playAt(i, i === index ? via : undefined)
  },

  enqueue(tracks, next) {
    const { list, order, index, now } = get()
    if (!now?.trackId) return get().playTracks(tracks, 0)
    set({ list: [...list, ...tracks], order: queued(order, index, tracks.map((_, k) => list.length + k), next) })
  },

  dequeue: (i) => set({ order: get().order.filter((x) => x !== i || x === get().index) }),

  toggleShuffle() {
    const { shuffle, list, index } = get()
    // Gapless local run queued in list order: engine keeps current only, store picks what's next.
    if (!shuffle) endRun()
    set({ shuffle: !shuffle, order: playOrder(list.length, index, !shuffle) })
  },

  cycleRepeat() {
    const repeat = ({ off: 'all', all: 'one', one: 'off' } as const)[get().repeat]
    if (repeat === 'one') endRun()
    set({ repeat })
  },

  resume({ list, index, order, shuffle, repeat, positionMs, via, paused = false }) {
    const valid = order.length === list.length && order.includes(index)
    set({ list, shuffle, repeat, order: valid ? order : playOrder(list.length, index, shuffle) })
    void get().playAt(index, via, { from: positionMs, hold: paused })
  },

  async playAt(index, via, { auto = false, from = 0, hold = false } = {}) {
    const { list } = get()
    // Fresh row: sources may have changed since the queue was built (Find versions).
    const t = useStore.getState().tracks.find((x) => x.id === list[index]?.id) ?? list[index]
    const how = via ?? (t && vias(t, spotifyOn())[0])
    if (!t || !how || !vias(t, spotifyOn()).includes(how)) return
    const mine = ++seq
    // Watch page belongs to one video: anything else plays elsewhere.
    if (how !== 'youtube') closeWatch()
    // Leaving Spotify: pause the user's Spotify app.
    if (get().now?.via === 'spotify' && how !== 'spotify') void spotify({ type: 'pause' })
    // Recommendations: no history (not in the library).
    startListen(isRemote(t) ? undefined : t.id, t.durationMs)
    const base: NowPlaying = { title: t.title, artist: t.artist, trackId: t.id, via: how }
    // Preview: 30 s from Apple, no resume point.
    const start = how === 'preview' ? 0 : from
    set({ index, playId: get().playId + 1, playing: !hold, hold, positionMs: start, startAt: start, durationMs: t.durationMs, upcoming: [], fadeIn: (auto || get().fade.skip) && get().fade.in > 0 })
    sent = -1

    if (how === 'youtube') {
      expect = null
      // Unconditional: engine may hold a paused item the store forgot (reload).
      send({ type: 'stop' })
      // Can't play here at all (seen this session): straight to the upload that worked.
      const video = unplayable.has(t.ids.youtube!) && others?.trackId === t.id ? (others.ids.find((v) => !unplayable.has(v)) ?? t.ids.youtube!) : t.ids.youtube!
      if (watching() && !watching(video)) closeWatch()
      // Same video (repeat one): the embed stays mounted, so rewind it.
      if (get().now?.youtubeId === video) {
        yt('seekTo', start / 1000, true)
        yt('playVideo')
      }
      set({ now: { ...base, youtubeId: video } })
      // Refused by the embed earlier this session: its watch page at once.
      if (blocked.has(video) && !watching(video)) playOnWatchPage(video, start)
      return
    }
    if (how === 'local') {
      // Consecutive local tracks go to the engine as one run: gapless between them. List order only.
      let end = index + 1
      while (!get().shuffle && get().repeat !== 'one' && end < list.length && vias(list[end])[0] === 'local') end++
      const paths = list.slice(index, end).map((x) => x.ids.local!)
      expect = paths
      send({ type: 'play', paths, start: 0 })
      if (start) send({ type: 'seek', ms: start })
      if (hold) send({ type: 'toggle' })
      set({ now: { ...base, path: t.ids.local } })
      return get().applyVolume(true)
    }
    if (how === 'spotify') {
      expect = []
      send({ type: 'stop' })
      set({ now: { ...base, spotifyId: t.ids.spotify } })
      // Held: shown, not started (Spotify plays on the user's own app).
      if (hold) return
      try {
        await api.spotifyPlayer({ type: 'play', trackId: t.ids.spotify! })
        if (start) void spotify({ type: 'seek', ms: Math.round(start) })
      } catch (e) {
        if (mine !== seq) return
        useStore.setState({ error: String(e) })
        set({ playing: false })
      }
      return
    }
    // Preview: silence while it downloads (Rust side, memory only).
    expect = [previewPath(t)]
    send({ type: 'stop' })
    set({ now: base, durationMs: 30_000 })
    try {
      const page = await api.playPreview(t.ids.apple!, region())
      if (mine === seq) return set({ now: { ...base, page } })
      // User moved on meanwhile: our preview replaced their choice in the engine, so replay it.
      const cur = get().now
      if (cur?.via === 'youtube') send({ type: 'stop' })
      else if (cur) void get().playAt(get().index, cur.via)
    } catch (e) {
      if (mine !== seq) return
      expect = []
      useStore.setState({ error: String(e) })
      set({ playing: false })
    }
  },

  playFiles(paths) {
    seq++
    closeWatch()
    startListen(undefined, null)
    expect = paths
    send({ type: 'play', paths, start: 0 })
    send({ type: 'volume', value: get().volume })
    // Clearing youtubeId unmounts embed.
    set({ now: { title: fileTitle(paths[0]), artist: 'Local file', path: paths[0], via: 'local' }, playId: get().playId + 1, list: [], order: [], index: 0, playing: true, positionMs: 0, durationMs: null, fadeIn: false, startAt: 0 })
  },

  toggle() {
    const { now, playing, fade } = get()
    if (!now) return
    set({ hold: false })
    const pause = () => {
      if (now.via === 'youtube') yt(playing ? 'pauseVideo' : 'playVideo')
      else if (now.via === 'spotify') void spotify({ type: playing ? 'pause' : 'resume' })
      else send({ type: 'toggle' })
    }
    set({ playing: !playing })
    // Fade on pause: down, then pause. On play: play silent, then up. Spotify: no volume control fast enough.
    if (!fade.pause || now.via === 'spotify') return pause()
    if (playing) return ramp((t) => 1 - t, fade.pause, pause)
    gainNow = 0
    get().applyVolume(true)
    pause()
    ramp((t) => t, fade.pause)
  },

  previewFade() {
    const f = get().fade
    ramp((t) => demoGain(t * demoLength(f), f), demoLength(f) * 1000)
  },

  seek(ms) {
    const via = get().now?.via
    if (via === 'youtube') yt('seekTo', ms / 1000, true)
    else if (via === 'spotify') void spotify({ type: 'seek', ms: Math.round(ms) })
    else send({ type: 'seek', ms })
    set({ positionMs: ms })
  },

  step(delta, auto = false) {
    const { now, list, index, order, repeat } = get()
    if (now && !now.trackId) return void send({ type: delta > 0 ? 'next' : 'prev' })
    const i = nextIndex(order, index, delta, repeat, auto, (j) => !vias(list[j], spotifyOn()).length)
    if (i !== null) return void get().playAt(i, undefined, { auto })
    if (delta > 0) set({ playing: false })
  },

  setVolume(volume) {
    set({ volume })
    get().applyVolume(true)
  },

  applyVolume(force = false) {
    const { now, volume, positionMs, durationMs, fade, fadeIn } = get()
    const via = now?.via
    if (via === 'spotify') {
      // Spotify Connect: rate-limited API, no fades.
      clearTimeout(volumeTimer)
      if (force) volumeTimer = setTimeout(() => void spotify({ type: 'volume', percent: Math.round(volume * 100) }), 300)
      return
    }
    const value = Math.round(volume * fadeGain(positionMs, durationMs, fade, fadeIn) * gainNow * 100) / 100
    if (!force && value === sent) return
    sent = value
    if (via === 'youtube') yt('setVolume', Math.round(value * 100))
    else send({ type: 'volume', value })
  },

  onYoutube(u) {
    const { now } = get()
    // Watch page can't play it either (region, age, removed): another upload of the song, else the next song.
    if (u.unplayable !== undefined) {
      if (now?.trackId && now.youtubeId) return void tryOtherUpload(now.trackId, now.youtubeId, `This video can’t play here (${u.unplayable})`)
      useStore.getState().notify(`This video can’t play here (${u.unplayable}): skipped`, { kind: 'error' })
      return get().step(1)
    }
    if (u.error !== undefined) {
      // 101 / 150: owner turned embedding off. Same video from its watch page, invisible switch.
      if (now?.youtubeId && [101, 150].includes(u.error) && !watching(now.youtubeId)) {
        blocked.add(now.youtubeId)
        return playOnWatchPage(now.youtubeId, get().positionMs)
      }
      // 100: removed. Another upload of the same song, else the next song.
      if (now?.trackId && now.youtubeId && u.error === 100) return void tryOtherUpload(now.trackId, now.youtubeId, 'This video was removed')
      useStore.setState({ error: `YouTube playback failed (error ${u.error}).` })
      return set({ playing: false })
    }
    set({
      ...(u.state !== undefined && u.state !== 3 && { playing: u.state === 1 }),
      ...(u.time !== undefined && { positionMs: u.time * 1000 }),
      ...(u.duration && { durationMs: u.duration * 1000 }),
    })
    if (u.time !== undefined) {
      progress(u.time * 1000, u.duration && u.duration * 1000)
      get().applyVolume()
    }
    if (u.state === 0) {
      endListen(true)
      get().step(1, true)
    }
  },

  onLocal(s) {
    if (s.error) useStore.setState({ error: s.error })
    const via = get().now?.via
    if (via === 'youtube' || via === 'spotify') return
    if (expect) {
      // Error = engine already tried our items (bad file skipped): status is ours.
      if (!(s.path && expect.includes(s.path)) && !s.error) return
      expect = null
    }
    if (s.ended) {
      expect = []
      endListen(true)
      return get().step(1, true)
    }
    const { list, index, now } = get()
    // Gapless run moved on: follow it in the queue.
    const i = s.path && now?.trackId ? list.findIndex((t, j) => j >= index && t.ids.local === s.path) : -1
    if (i > index) {
      endListen(true)
      startListen(list[i].id, s.durationMs)
    }
    if (s.path) progress(s.positionMs, s.durationMs)
    set({
      playing: !!s.path && !s.paused,
      positionMs: s.positionMs,
      upcoming: now?.trackId ? [] : s.upcoming,
      ...(s.durationMs && { durationMs: s.durationMs }),
      ...(i > index && { index: i, playId: get().playId + 1, fadeIn: get().fade.in > 0, now: { title: list[i].title, artist: list[i].artist, trackId: list[i].id, via: 'local', path: s.path! } }),
      ...(s.path && !now?.trackId && { now: { title: fileTitle(s.path), artist: 'Local file', path: s.path, via: 'local' }, ...(s.path !== now?.path && { playId: get().playId + 1 }) }),
    })
    if (s.path) get().applyVolume()
  },

  onSpotify(p) {
    const { now, positionMs, durationMs } = get()
    if (now?.via !== 'spotify') return
    const ours = !!p && p.trackId === now.spotifyId
    // Our track ran out: Spotify moved on (autoplay) or stopped at 0.
    const ended = (!ours || (!p.playing && p.positionMs === 0)) && !!durationMs && positionMs > durationMs - 4000
    if (ended) {
      endListen(true)
      return get().step(1, true)
    }
    if (!p || !ours) return set({ playing: false })
    progress(p.positionMs, p.durationMs)
    set({ playing: p.playing, positionMs: p.positionMs, ...(p.durationMs && { durationMs: p.durationMs }) })
  },
}))

/** Where the YouTube iframe should sit. Null = mini player. Moving the iframe in DOM would reload it. */
export const useVideoSlot = create<{ rect: DOMRect | null; hidden: boolean; box: Box | null; set: (rect: DOMRect | null) => void }>((set, get) => ({
  rect: null,
  // Picture inside the video's 16:9 frame (bars cut): the frame is enlarged and clipped to it. Now Playing only.
  box: null,
  // Now Playing in cover mode: video transparent (user's choice).
  hidden: false,
  set: (rect) => {
    const r = get().rect
    // Same box: skip (live slots report every frame).
    if (rect && r && rect.x === r.x && rect.y === r.y && rect.width === r.width && rect.height === r.height) return
    set({ rect })
  },
}))
