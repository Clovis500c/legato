import { create } from 'zustand'
import { useStore } from '../../app/store'
import { api, type LibraryTrack, type PlayerCommand, type PlayerStatus, type SpotifyCommand, type SpotifyPlayback } from '../../shared/api'
import { region } from '../../shared/format'
import { endListen, progress, startListen } from './listens'
import { vias, type Via } from './sources'
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
  /** Dropped files (not in library): engine queue after current file. */
  upcoming: string[]
  /** Full-screen Now Playing. */
  full: boolean
  setFull: (full: boolean) => void
  playTracks: (list: LibraryTrack[], index: number) => void
  /** Queue item `index` through `via` (default: best source). */
  playAt: (index: number, via?: Via) => Promise<void>
  playFiles: (paths: string[]) => void
  toggle: () => void
  seek: (ms: number) => void
  step: (delta: 1 | -1) => void
  setVolume: (volume: number) => void
  onYoutube: (u: YtUpdate) => void
  onLocal: (s: PlayerStatus) => void
  /** Spotify Connect poll result. */
  onSpotify: (p: SpotifyPlayback | null) => void
}

// Embed iframe, bound by PlayerBar.
let frame: HTMLIFrameElement | null = null
export const bindFrame = (el: HTMLIFrameElement | null) => void (frame = el)

// Engine status lags commands: until it reports one of these paths, statuses are stale. [] = ignore all.
let expect: string[] | null = null
// Bumped per playAt: a slow preview download must not override a later choice.
let seq = 0

const send = (cmd: PlayerCommand) => api.player(cmd).catch((e) => useStore.setState({ error: String(e) }))
const yt = (func: string, ...args: unknown[]) => ytPost(frame, 'command', func, args)
export const fileTitle = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
const previewPath = (t: LibraryTrack) => `apple:${t.ids.apple}`
const spotifyOn = () => useStore.getState().status.spotify.connected
const spotify = (cmd: SpotifyCommand) => api.spotifyPlayer(cmd).catch((e) => useStore.setState({ error: String(e) }))
// Knob drags fire many changes: one Spotify call per pause.
let volumeTimer: ReturnType<typeof setTimeout> | undefined

export const usePlayer = create<PlayerState>((set, get) => ({
  playing: false,
  positionMs: 0,
  durationMs: null,
  volume: 1,
  list: [],
  index: 0,
  upcoming: [],
  full: false,
  setFull: (full) => set({ full }),

  playTracks(list, index) {
    const i = list.findIndex((t, j) => j >= index && vias(t, spotifyOn()).length > 0)
    if (i < 0) return
    set({ list })
    void get().playAt(i)
  },

  async playAt(index, via) {
    const { list, volume } = get()
    // Fresh row: sources may have changed since the queue was built (Find versions).
    const t = useStore.getState().tracks.find((x) => x.id === list[index]?.id) ?? list[index]
    const how = via ?? (t && vias(t, spotifyOn())[0])
    if (!t || !how || !vias(t, spotifyOn()).includes(how)) return
    const mine = ++seq
    // Leaving Spotify: pause the user's Spotify app.
    if (get().now?.via === 'spotify' && how !== 'spotify') void spotify({ type: 'pause' })
    startListen(t.id, t.durationMs)
    const base: NowPlaying = { title: t.title, artist: t.artist, trackId: t.id, via: how }
    set({ index, playing: true, positionMs: 0, durationMs: t.durationMs, upcoming: [] })

    if (how === 'youtube') {
      expect = null
      // Unconditional: engine may hold a paused item the store forgot (reload).
      send({ type: 'stop' })
      return set({ now: { ...base, youtubeId: t.ids.youtube } })
    }
    if (how === 'local') {
      // Consecutive local tracks go to the engine as one run: gapless between them.
      let end = index + 1
      while (end < list.length && vias(list[end])[0] === 'local') end++
      const paths = list.slice(index, end).map((x) => x.ids.local!)
      expect = paths
      send({ type: 'play', paths, start: 0 })
      send({ type: 'volume', value: volume })
      return set({ now: { ...base, path: t.ids.local } })
    }
    if (how === 'spotify') {
      expect = []
      send({ type: 'stop' })
      set({ now: { ...base, spotifyId: t.ids.spotify } })
      try {
        await api.spotifyPlayer({ type: 'play', trackId: t.ids.spotify! })
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
    startListen(undefined, null)
    expect = paths
    send({ type: 'play', paths, start: 0 })
    send({ type: 'volume', value: get().volume })
    // Clearing youtubeId unmounts embed.
    set({ now: { title: fileTitle(paths[0]), artist: 'Local file', path: paths[0], via: 'local' }, list: [], index: 0, playing: true, positionMs: 0, durationMs: null })
  },

  toggle() {
    const { now, playing } = get()
    if (!now) return
    if (now.via === 'youtube') yt(playing ? 'pauseVideo' : 'playVideo')
    else if (now.via === 'spotify') void spotify({ type: playing ? 'pause' : 'resume' })
    else send({ type: 'toggle' })
    set({ playing: !playing })
  },

  seek(ms) {
    const via = get().now?.via
    if (via === 'youtube') yt('seekTo', ms / 1000, true)
    else if (via === 'spotify') void spotify({ type: 'seek', ms: Math.round(ms) })
    else send({ type: 'seek', ms })
    set({ positionMs: ms })
  },

  step(delta) {
    const { now, list, index } = get()
    if (now && !now.trackId) return void send({ type: delta > 0 ? 'next' : 'prev' })
    for (let i = index + delta; i >= 0 && i < list.length; i += delta) {
      if (vias(list[i], spotifyOn()).length) return void get().playAt(i)
    }
    if (delta > 0) set({ playing: false })
  },

  setVolume(volume) {
    const via = get().now?.via
    if (via === 'youtube') yt('setVolume', Math.round(volume * 100))
    else if (via === 'spotify') {
      clearTimeout(volumeTimer)
      volumeTimer = setTimeout(() => void spotify({ type: 'volume', percent: Math.round(volume * 100) }), 300)
    } else send({ type: 'volume', value: volume })
    set({ volume })
  },

  onYoutube(u) {
    if (u.error !== undefined) {
      useStore.setState({ error: `YouTube playback failed (error ${u.error}).` })
      return set({ playing: false })
    }
    set({
      ...(u.state !== undefined && u.state !== 3 && { playing: u.state === 1 }),
      ...(u.time !== undefined && { positionMs: u.time * 1000 }),
      ...(u.duration && { durationMs: u.duration * 1000 }),
    })
    if (u.time !== undefined) progress(u.time * 1000, u.duration && u.duration * 1000)
    if (u.state === 0) {
      endListen(true)
      get().step(1)
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
      return get().step(1)
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
      ...(i > index && { index: i, now: { title: list[i].title, artist: list[i].artist, trackId: list[i].id, via: 'local', path: s.path! } }),
      ...(s.path && !now?.trackId && { now: { title: fileTitle(s.path), artist: 'Local file', path: s.path, via: 'local' } }),
    })
  },

  onSpotify(p) {
    const { now, positionMs, durationMs } = get()
    if (now?.via !== 'spotify') return
    const ours = !!p && p.trackId === now.spotifyId
    // Our track ran out: Spotify moved on (autoplay) or stopped at 0.
    const ended = (!ours || (!p.playing && p.positionMs === 0)) && !!durationMs && positionMs > durationMs - 4000
    if (ended) {
      endListen(true)
      return get().step(1)
    }
    if (!p || !ours) return set({ playing: false })
    progress(p.positionMs, p.durationMs)
    set({ playing: p.playing, positionMs: p.positionMs, ...(p.durationMs && { durationMs: p.durationMs }) })
  },
}))

/** Where the YouTube iframe should sit. Null = mini player. Moving the iframe in DOM would reload it. */
export const useVideoSlot = create<{ rect: DOMRect | null; set: (rect: DOMRect | null) => void }>((set) => ({ rect: null, set: (rect) => set({ rect }) }))
