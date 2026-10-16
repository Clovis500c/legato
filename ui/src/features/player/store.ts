import { create } from 'zustand'
import { useStore } from '../../app/store'
import { api, type LibraryTrack, type PlayerCommand, type PlayerStatus } from '../../shared/api'
import { ytPost, type YtUpdate } from './youtube'

/** youtubeId set = embed plays it, else Rust engine plays local files. */
export interface NowPlaying {
  title: string
  artist: string
  youtubeId?: string
  /** Library row, to highlight it in lists. */
  trackId?: number
  /** Local file path (format shown in readout). */
  path?: string
}

interface PlayerState {
  now?: NowPlaying
  playing: boolean
  positionMs: number
  durationMs: number | null
  volume: number
  /** List a YouTube track was started from: next/prev walk it. */
  list: LibraryTrack[]
  index: number
  /** Local engine queue after current file. */
  upcoming: string[]
  /** Full-screen Now Playing. */
  full: boolean
  setFull: (full: boolean) => void
  playTracks: (list: LibraryTrack[], index: number) => void
  playFiles: (paths: string[]) => void
  toggle: () => void
  seek: (ms: number) => void
  step: (delta: 1 | -1) => void
  setVolume: (volume: number) => void
  onYoutube: (u: YtUpdate) => void
  onLocal: (s: PlayerStatus) => void
}

// Embed iframe, bound by PlayerBar.
let frame: HTMLIFrameElement | null = null
export const bindFrame = (el: HTMLIFrameElement | null) => void (frame = el)

const send = (cmd: PlayerCommand) => api.player(cmd).catch((e) => useStore.setState({ error: String(e) }))
const yt = (func: string, ...args: unknown[]) => ytPost(frame, 'command', func, args)
export const fileTitle = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
/** Library metadata for a playing file when known, file name otherwise. */
const localNow = (list: LibraryTrack[], path: string): NowPlaying => {
  const t = list.find((x) => x.ids.local === path)
  return t ? { title: t.title, artist: t.artist, path, trackId: t.id } : { title: fileTitle(path), artist: 'Fichier local', path }
}

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
    const t = list[index]
    if (t?.ids.local) {
      const queue = list.slice(index).filter((x) => x.ids.local)
      send({ type: 'play', paths: queue.map((x) => x.ids.local!), start: 0 })
      send({ type: 'volume', value: get().volume })
      return set({ now: { title: t.title, artist: t.artist, path: t.ids.local, trackId: t.id }, list: queue, index: 0, playing: true, positionMs: 0, durationMs: t.durationMs })
    }
    if (!t?.ids.youtube) return
    if (get().now && !get().now?.youtubeId) send({ type: 'stop' })
    set({ now: { title: t.title, artist: t.artist, youtubeId: t.ids.youtube, trackId: t.id }, list, index, playing: true, positionMs: 0, durationMs: t.durationMs })
  },

  playFiles(paths) {
    send({ type: 'play', paths, start: 0 })
    send({ type: 'volume', value: get().volume })
    // Clearing youtubeId unmounts embed.
    set({ now: { title: fileTitle(paths[0]), artist: 'Fichier local', path: paths[0] }, playing: true, positionMs: 0, durationMs: null })
  },

  toggle() {
    const { now, playing } = get()
    if (!now) return
    if (now.youtubeId) yt(playing ? 'pauseVideo' : 'playVideo')
    else send({ type: 'toggle' })
    set({ playing: !playing })
  },

  seek(ms) {
    if (get().now?.youtubeId) yt('seekTo', ms / 1000, true)
    else send({ type: 'seek', ms })
    set({ positionMs: ms })
  },

  step(delta) {
    const { now, list, index, playTracks } = get()
    if (!now?.youtubeId) return void send({ type: delta > 0 ? 'next' : 'prev' })
    for (let i = index + delta; i >= 0 && i < list.length; i += delta) {
      if (list[i].ids.youtube) return playTracks(list, i)
    }
  },

  setVolume(volume) {
    if (get().now?.youtubeId) yt('setVolume', Math.round(volume * 100))
    else send({ type: 'volume', value: volume })
    set({ volume })
  },

  onYoutube(u) {
    if (u.error !== undefined) {
      useStore.setState({ error: `Lecture YouTube impossible (erreur ${u.error}).` })
      return set({ playing: false })
    }
    set({
      ...(u.state !== undefined && u.state !== 3 && { playing: u.state === 1 }),
      ...(u.time !== undefined && { positionMs: u.time * 1000 }),
      ...(u.duration && { durationMs: u.duration * 1000 }),
    })
    if (u.state === 0) get().step(1)
  },

  onLocal(s) {
    if (s.error) useStore.setState({ error: s.error })
    // Path null = engine idle or command not processed yet: keep last title.
    set({
      playing: !!s.path && !s.paused,
      positionMs: s.positionMs,
      upcoming: s.upcoming,
      ...(s.path && { now: localNow(get().list, s.path), durationMs: s.durationMs }),
    })
  },
}))

/** Where the YouTube iframe should sit. Null = mini player. Moving the iframe in DOM would reload it. */
export const useVideoSlot = create<{ rect: DOMRect | null; set: (rect: DOMRect | null) => void }>((set) => ({ rect: null, set: (rect) => set({ rect }) }))
