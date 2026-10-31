import { create } from 'zustand'
import { useStore } from '../../app/store'
import { api, type LibraryTrack, type PlayerCommand, type PlayerStatus, type SpotifyCommand, type SpotifyPlayback, type Track } from '../../shared/api'
import type { Box } from '../../shared/artbox'
import { region } from '../../shared/format'
import { endListen, progress, startListen } from './listens'
import { demoGain, demoLength, fadeGain, NO_FADE, overlapDue, PICK_IN_S, type Fade } from './fade'
import { insertAt, keepQueued, moveInOrder, moveToSlot, nextIndex, playOrder, queued, tooLong, type Repeat } from './queue'
import { vias, type Via } from './sources'
import { offerEnd, rememberEnd, rememberStart, songEnd, songStart } from './ends'
import { bindLiveFrame, onEndHeard, onLeadHeard } from './live'
import { closeWatch, openWatch, sendWatch, watching } from './watch'
import { ytPost, type YtUpdate } from './youtube'
import { tr } from '../../shared/i18n/i18n'
import { offline } from '../../shared/online'
import { note, report } from '../../shared/diag'

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
  /** List indexes the user queued (Play next, Add to queue, dropped into Up next): Up next shows them first. */
  added: number[]
  /** What the queue was started from (the page it was played on), for Up next's "Then from …". */
  from?: string
  shuffle: boolean
  repeat: Repeat
  /** Fades between songs and on pause (Settings › Player, Advanced). */
  fade: Fade
  /** Settings › Playback › Skip long songs: minutes, 0 = off. */
  skipLong: number
  /** Settings › Playback › Early endings: a video ends where its song does (ends.ts). */
  earlyEnds: boolean
  /** Settings › Playback › Skip silence: songs start on the music and end where it ends (ends.ts, engine for local files). */
  skipSilence: boolean
  /** Fade in of the current track, s: full after the previous one, short after a skip (if asked), 0 = none. */
  fadeIn: number
  /** Where the current item started (resume), ms. */
  startAt: number
  /** Bumped each time an item starts (song, other upload, gapless move): per-song UI state checks it. */
  playId: number
  /** Restored paused (after an update): the first item loads without playing. */
  hold: boolean
  /**
   * The other embed (overlap): its song fading out while the next one plays, then stopped (done) and kept for the next
   * overlap. Never unmounted while a YouTube song plays: removing an embed stalled the other one's video ~15 s, sound
   * gone after the fade (Chromium, 2026-10-28). key = its frame's; end = its song's end (ms), where the overlap was
   * timed and its fade out reaches silence.
   */
  tail: { key: number; videoId: string; end: number; done: boolean } | null
  /** Key of the playing embed; the two embeds swap roles at each overlap. */
  frameKey: number
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
  /** next = right after the current track, else after the songs already queued (`mine` = false: similar songs, at the end). Nothing playing: plays them. */
  enqueue: (tracks: LibraryTrack[], next: boolean, mine?: boolean) => void
  /** Drops list index `i` from the play order. */
  dequeue: (i: number) => void
  /** Up next, dragged: list index `i` goes where `j` is in the play order. */
  move: (i: number, j: number) => void
  /** Up next, dragged: list index `i` lands at play-order position `at`. */
  moveTo: (i: number, at: number) => void
  /** Songs dropped into Up next at play-order position `at`. Nothing playing: plays them. */
  enqueueAt: (tracks: LibraryTrack[], at: number) => void
  /** Up next emptied: nothing after the current song. */
  clearNext: () => void
  /** Queue item `index` through `via` (default: best source). auto = previous one ended; from = start position, ms. */
  playAt: (index: number, via?: Via, opts?: { auto?: boolean; from?: number; hold?: boolean }) => Promise<void>
  /** Last session's queue, picked up where it stopped. */
  resume: (s: { list: LibraryTrack[]; index: number; order: number[]; added?: number[]; shuffle: boolean; repeat: Repeat; positionMs: number; via?: Via; paused?: boolean }) => void
  /** Plays a song change on the current song: fade out, silence, fade in (curve editor's Try it). */
  previewFade: () => void
  /** Sends volume × fade to whatever plays. force = even if unchanged. */
  applyVolume: (force?: boolean) => void
  playFiles: (paths: string[]) => void
  toggle: () => void
  /** Sleep timer: volume down over `ms`, then pause (volume back for next time). */
  sleep: (ms: number) => void
  seek: (ms: number) => void
  /** auto = track ended by itself (repeat one replays it). */
  step: (delta: 1 | -1, auto?: boolean) => void
  setVolume: (volume: number) => void
  /** Mute, or back to the last audible volume (never a jump to full: half when none is known). */
  toggleMute: () => void
  onYoutube: (u: YtUpdate) => void
  onLocal: (s: PlayerStatus) => void
  /** Spotify Connect poll result. */
  onSpotify: (p: SpotifyPlayback | null) => void
}

// Songs from recommendations play without joining the library: negative ids, one per video for the session.
const remoteIds = new Map<string, number>()

/** Service track → queue item, not in the library (no history, no playlists). */
let queueEnd: (() => Promise<boolean>) | null = null
/** Called when Up next runs out by itself; true = songs were added, playback goes on. */
export const onQueueEnd = (fn: () => Promise<boolean>) => void (queueEnd = fn)

export function remoteTrack(t: Track): LibraryTrack {
  const key = t.ids.youtube ?? `${t.artist}\u0000${t.title}`
  let id = remoteIds.get(key)
  if (id === undefined) remoteIds.set(key, (id = -(remoteIds.size + 1)))
  return { ...t, id, added: 0, addedAt: null }
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

/** Asked when a song ends on its own, before the next one starts: true = taken over (an update installs right there). */
let beforeNext: (() => boolean) | null = null
export const onSongEnd = (f: (() => boolean) | null) => void (beforeNext = f)
// Sleep timer, "end of this song": the next one doesn't start; f runs instead.
let stopAtEnd: (() => void) | null = null
export const stopAfterSong = (f: (() => void) | null) => void (stopAtEnd = f)

// Embed iframe, bound by PlayerBar.
let frame: HTMLIFrameElement | null = null
export const bindFrame = (el: HTMLIFrameElement | null) => void (frame = el)
// Other embed stopped, kept for the next overlap.
const stopTail = (t: PlayerState['tail']) => t && { ...t, done: true }
// The queue passes over it: nothing to play it with, or longer than Skip long songs (known lengths only).
const passOver = (t: LibraryTrack, longMin: number) => !vias(t, spotifyOn()).length || tooLong(t.durationMs, longMin)

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
// Last audible volume, for unmute.
let audible = 0.5
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

// Videos the embed refuses (they play from their watch page; kept between launches, newest 500), videos that can't
// play at all here, and the other uploads still to try for the current track.
const BLOCKED = 'embedBlocked'
const blocked = new Set<string>(
  (() => {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(BLOCKED) ?? '[]')
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length === 11) : []
    } catch {
      return []
    }
  })(),
)
function block(video: string) {
  blocked.delete(video)
  blocked.add(video)
  try {
    localStorage.setItem(BLOCKED, JSON.stringify([...blocked].slice(-500)))
  } catch {
    // Storage off: this session still knows.
  }
}
const unplayable = new Set<string>()
let others: { trackId: number; ids: string[] } | null = null
// Songs skipped for failing since one last played (track ids): once they cover the queue, it stops.
const failedRun = new Set<number>()

/** Where the video shows: the slot, or the embed's own default spot (iframe box). */
function videoRect(): DOMRect | null {
  return useVideoSlot.getState().rect ?? frame?.getBoundingClientRect() ?? null
}

/** Embed refused the video (owner turned embedding off): same video from YouTube's watch page, where it was. */
function playOnWatchPage(video: string, startMs: number) {
  note('playback', 'youtube: the embed refused the video, playing it from its watch page')
  const rect = videoRect()
  // The embed stops for good: no second player in the background.
  ytPost(frame, 'command', 'pauseVideo')
  if (!rect) return void tryOtherUpload(usePlayer.getState().now?.trackId ?? 0, video, tr('This video can’t play in apps'), 'no room for the watch page')
  // Cover mode: made hidden, it plays unseen.
  openWatch(video, startMs / 1000, useVideoSlot.getState().hidden ? null : rect).catch(() => tryOtherUpload(usePlayer.getState().now?.trackId ?? 0, video, tr('This video can’t play in apps'), 'the watch page failed to open'))
  // The watch page can sit unstarted too (cookie wall, sign-in page): checked again, a little longer.
  watchForStuck(usePlayer.getState().playId, 15_000)
}

// Stuck embed (review 2026-10-22): some refused videos never send onError; the frame sits unstarted (-1) on YouTube's
// own "Video unavailable" card. A video asked to play that hasn't started 6 s later (not buffering, not paused, not
// loaded paused at launch) = refused.
let ytState: number | undefined
// New video asked: the embed still reports the old one for a moment (late times, its duration). Ignored until a time
// near the new start comes, else the fade in jumps to full volume (review 2026-10-23: skips started loud).
let ytFresh = false
// When the user last paused. YouTube ignores a pause while a video is still starting, then plays it anyway: a
// "playing" that soon after is paused again (later, one from YouTube's own controls counts).
let pausedAt = 0
const PAUSE_HOLD_MS = 5000
// Current song came by the queue moving on (song ended): Skip long songs applies once its length is known.
let reachedAuto = false
// Length of the playing video, ms (0 = not known yet). YouTube sends it once, as the video loads: kept for the song.
let videoMs = 0
let stuckTimer: ReturnType<typeof setTimeout> | undefined

// No network (Windows says so): a video that won't start isn't refused. Nothing is blocked or skipped; playback pauses
// and the song starts over in a new embed once the network is back (2026-10-30: a dropped Wi-Fi marked every song it
// reached as refused, for good, and skipped through the queue). playId waiting, -1 = none.
let offlineFor = -1
function waitForNetwork(playId: number) {
  clearTimeout(stuckTimer)
  usePlayer.setState({ playing: false })
  const first = offlineFor < 0
  offlineFor = playId
  if (!first) return
  report('warn', 'playback', 'offline: waiting for the network to play again')
  useStore.getState().notify(tr('No internet connection: the song starts again when your PC is back online.'), { kind: 'error' })
  const back = () => {
    window.removeEventListener('online', back)
    note('playback', 'network back: the song starts again')
    const id = offlineFor
    offlineFor = -1
    const p = usePlayer.getState()
    // Moved on meanwhile (another song, a local file): nothing to start again.
    if (p.playId !== id || p.now?.via !== 'youtube') return
    // The embed born offline holds an error page: a new one (key), asked to play (playId arms the stuck check again).
    usePlayer.setState((s) => ({ frameKey: Math.max(s.frameKey, s.tail?.key ?? 0) + 1, playId: s.playId + 1, positionMs: 0, playing: true }))
  }
  window.addEventListener('online', back)
}

function watchForStuck(playId: number, wait = 6_000) {
  clearTimeout(stuckTimer)
  ytState = undefined
  const check = () => {
    const p = usePlayer.getState()
    const id = p.now?.via === 'youtube' ? p.now.youtubeId : undefined
    if (p.playId !== playId || p.hold || !id || p.positionMs > p.startAt || ytState === 1 || ytState === 2) return
    // Slow network: give it longer.
    if (ytState === 3) return void (stuckTimer = setTimeout(check, 10_000))
    if (offline()) return waitForNetwork(playId)
    if (!watching(id)) {
      block(id)
      return playOnWatchPage(id, 0)
    }
    void tryOtherUpload(p.now?.trackId ?? 0, id, tr('This video can’t play in apps'), 'the watch page never started')
  }
  stuckTimer = setTimeout(check, wait)
}

/** `why` = the notice's words; `cause` = the same in English for the diagnostics log (no title, no name). */
async function tryOtherUpload(trackId: number, failed: string, why: string, cause: string) {
  // Offline, nothing can be told about the video (waitForNetwork).
  if (offline()) return waitForNetwork(usePlayer.getState().playId)
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
    note('playback', `youtube: ${cause}, trying another upload`)
    notify(tr('{why}: playing another upload of the song', { why }))
    // Same embed: the frame loads the new id (loadVideoById).
    return usePlayer.setState((s) => (s.now ? { now: { ...s.now, youtubeId: next }, playId: s.playId + 1, positionMs: 0, playing: true } : {}))
  }
  failedRun.add(trackId)
  const p = usePlayer.getState()
  // Whole queue failed in a row: stop once, repeat would loop over it forever (2026-10-28: ~80 songs a second).
  if (p.order.every((j) => failedRun.has(p.list[j].id) || passOver(p.list[j], p.skipLong))) {
    failedRun.clear()
    // Last song's stuck check (10 s) would start the queue again.
    clearTimeout(stuckTimer)
    report('warn', 'playback', `youtube: ${cause}, and no song in the queue can play: stopped`)
    notify(tr('No song in the queue can play here: stopped'), { kind: 'error' })
    return usePlayer.setState({ playing: false })
  }
  report('warn', 'playback', `youtube: ${cause}, no other upload found: skipped`)
  notify(tr('{why}, and no other upload was found: skipped', { why }), { kind: 'error' })
  // Manual step: repeat one would replay the blocked video forever.
  p.step(1)
}

/** The page a queue is played from, for Up next's "Then from …". */
function contextName(): string | undefined {
  const { view, playlists } = useStore.getState()
  if (view.name === 'playlist') return playlists.find((p) => p.id === view.id)?.name
  if (view.name === 'album') return view.album
  if (view.name === 'artist') return view.artist
  if (view.name === 'songs') return tr('Songs')
  return undefined
}

export const usePlayer = create<PlayerState>((set, get) => ({
  playing: false,
  positionMs: 0,
  durationMs: null,
  volume: 1,
  list: [],
  index: 0,
  order: [],
  added: [],
  shuffle: false,
  repeat: 'off',
  fade: NO_FADE,
  skipLong: 0,
  earlyEnds: true,
  skipSilence: false,
  fadeIn: 0,
  startAt: 0,
  playId: 0,
  hold: false,
  tail: null,
  frameKey: 0,
  upcoming: [],
  full: false,
  setFull: (full) => set({ full }),

  playTracks(list, index, via) {
    const i = list.findIndex((t, j) => j >= index && vias(t, spotifyOn()).length > 0)
    if (i < 0) return
    set({ list, order: playOrder(list.length, i, get().shuffle), added: [], from: contextName() })
    void get().playAt(i, i === index ? via : undefined)
  },

  enqueue(tracks, next, mine = true) {
    const { list, order, index, now, added } = get()
    if (!now?.trackId) return get().playTracks(tracks, 0)
    const fresh = tracks.map((_, k) => list.length + k)
    set({ list: [...list, ...tracks], order: queued(order, index, fresh, next, mine ? added : undefined), added: mine ? [...added, ...fresh] : added })
  },

  dequeue: (i) => set({ order: get().order.filter((x) => x !== i || x === get().index) }),

  move(i, j) {
    // Gapless local run queued in list order: engine keeps current only, store picks what's next.
    endRun()
    set({ order: moveInOrder(get().order, i, j) })
  },

  moveTo(i, at) {
    endRun()
    set({ order: moveToSlot(get().order, i, at) })
  },

  enqueueAt(tracks, at) {
    const { list, order, now } = get()
    if (!now?.trackId) return get().playTracks(tracks, 0)
    endRun()
    const fresh = tracks.map((_, k) => list.length + k)
    set({ list: [...list, ...tracks], order: insertAt(order, fresh, at), added: [...get().added, ...fresh] })
  },

  clearNext() {
    const { order, index } = get()
    endRun()
    set({ order: order.slice(0, order.indexOf(index) + 1) })
  },

  toggleShuffle() {
    const { shuffle, list, index, order, added } = get()
    // Gapless local run queued in list order: engine keeps current only, store picks what's next.
    if (!shuffle) endRun()
    set({ shuffle: !shuffle, order: keepQueued(playOrder(list.length, index, !shuffle), order, index, added) })
  },

  cycleRepeat() {
    const repeat = ({ off: 'all', all: 'one', one: 'off' } as const)[get().repeat]
    if (repeat === 'one') endRun()
    set({ repeat })
  },

  resume({ list, index, order, added = [], shuffle, repeat, positionMs, via, paused = false }) {
    const valid = order.length === list.length && order.includes(index)
    // Queued songs come back with their order (session.ts); a rebuilt order makes them part of the list again.
    set({ list, shuffle, repeat, order: valid ? order : playOrder(list.length, index, shuffle), added: valid ? added : [], from: undefined })
    void get().playAt(index, via, { from: positionMs, hold: paused })
  },

  async playAt(index, via, { auto = false, from = 0, hold = false } = {}) {
    const { list } = get()
    // Fresh row: sources may have changed since the queue was built (Find versions).
    const t = useStore.getState().tracks.find((x) => x.id === list[index]?.id) ?? list[index]
    const how = via ?? (t && vias(t, spotifyOn())[0])
    if (!t || !how || !vias(t, spotifyOn()).includes(how)) return
    const mine = ++seq
    reachedAuto = auto
    // Watch page belongs to one video: anything else plays elsewhere.
    if (how !== 'youtube') closeWatch()
    // Leaving Spotify: pause the user's Spotify app.
    if (get().now?.via === 'spotify' && how !== 'spotify') void spotify({ type: 'pause' })
    // Recommendations: no history (not in the library).
    startListen(isRemote(t) ? undefined : t.id, t.durationMs)
    const base: NowPlaying = { title: t.title, artist: t.artist, trackId: t.id, via: how }
    // Preview: 30 s from Apple, no resume point.
    const start = how === 'preview' ? 0 : from
    set({ index, playId: get().playId + 1, playing: !hold, hold, positionMs: start, startAt: start, durationMs: t.durationMs, upcoming: [], tail: how === 'youtube' ? stopTail(get().tail) : null, fadeIn: auto ? get().fade.in : get().fade.skip ? Math.min(get().fade.in, PICK_IN_S) : 0 })
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
      } else videoMs = 0
      ytFresh = true
      set({ now: { ...base, youtubeId: video } })
      // Fade in starts silent: volume set before the embed loads the next video (it keeps the last one).
      get().applyVolume(true)
      // Refused by the embed before: its watch page at once.
      if (blocked.has(video) && !watching(video)) playOnWatchPage(video, start)
      // Not known yet: oEmbed says whether its owner turned embedding off, for this one and the next ones (Rust caches
      // it a day), so the switch doesn't wait for the embed to fail. Late answer for a song gone: only remembered.
      const playId = get().playId
      const ahead = list.slice(index + 1, index + 3).flatMap((x) => (x.ids.youtube ? [x.ids.youtube] : []))
      const ask = [...(blocked.has(video) ? [] : [video]), ...ahead.filter((v) => !blocked.has(v))]
      if (ask.length)
        void api
          .embedRefused(ask)
          .then((refused) => {
            refused.forEach(block)
            const p = get()
            if (refused.includes(video) && p.playId === playId && p.now?.youtubeId === video && !watching(video)) playOnWatchPage(video, p.positionMs)
          })
          .catch(() => {})
      return
    }
    if (how === 'local') {
      // Consecutive local tracks go to the engine as one run: gapless between them. List order only.
      let end = index + 1
      while (!get().shuffle && get().repeat !== 'one' && end < list.length && vias(list[end])[0] === 'local') end++
      const paths = list.slice(index, end).map((x) => x.ids.local!)
      // Skip silence: the engine learns where the music starts before the song does (cached; a failure plays it as it is).
      if (get().skipSilence) {
        await api.silencePrepare(paths).catch(() => {})
        if (mine !== seq) return
      }
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
    set({ now: { title: fileTitle(paths[0]), artist: tr('Local file'), path: paths[0], via: 'local' }, playId: get().playId + 1, list: [], order: [], index: 0, playing: true, positionMs: 0, durationMs: null, fadeIn: 0, startAt: 0 })
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
    set({ playing: !playing, ...(playing && { tail: stopTail(get().tail) }) })
    pausedAt = playing ? Date.now() : 0
    // Fade on pause: down, then pause. On play: play silent, then up. Spotify: no volume control fast enough.
    if (!fade.pause || now.via === 'spotify') return pause()
    if (playing) return ramp((t) => 1 - t, fade.pause, pause)
    gainNow = 0
    get().applyVolume(true)
    pause()
    ramp((t) => t, fade.pause)
  },

  sleep(ms) {
    const { now, playing } = get()
    if (!now || !playing) return
    const pause = () => {
      if (!get().playing) return
      set({ playing: false })
      if (now.via === 'youtube') yt('pauseVideo')
      else if (now.via === 'spotify') void spotify({ type: 'pause' })
      else send({ type: 'toggle' })
    }
    if (now.via === 'spotify') return pause()
    ramp((t) => (1 - t) ** 2, ms, pause)
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
    if (auto && delta > 0 && stopAtEnd) {
      const f = stopAtEnd
      stopAtEnd = null
      set({ playing: false })
      return f()
    }
    if (auto && delta > 0 && beforeNext?.()) return
    const { now, list, index, order, repeat } = get()
    if (now && !now.trackId) return void send({ type: delta > 0 ? 'next' : 'prev' })
    const i = nextIndex(order, index, delta, repeat, auto, (j) => passOver(list[j], get().skipLong))
    if (i !== null) return void get().playAt(i, undefined, { auto })
    if (delta <= 0) return
    // Up next ran out: similar songs when the setting says so (autoplay.ts), else stop.
    if (auto && queueEnd) return void queueEnd().then((added) => (added ? get().step(1, true) : set({ playing: false })), () => set({ playing: false }))
    set({ playing: false })
  },

  setVolume(volume) {
    if (volume > 0.02) audible = volume
    set({ volume })
    get().applyVolume(true)
  },

  toggleMute() {
    get().setVolume(get().volume > 0 ? 0 : audible)
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
    const value = Math.round(volume * fadeGain(positionMs, durationMs, { ...fade, in: fadeIn }, true) * gainNow * 100) / 100
    if (!force && value === sent) return
    sent = value
    if (via === 'youtube') yt('setVolume', Math.round(value * 100))
    else send({ type: 'volume', value })
  },

  onYoutube(u) {
    const { now } = get()
    // Watch page can't play it either (region, age, removed): another upload of the song, else the next song.
    if (u.unplayable !== undefined) {
      if (now?.trackId && now.youtubeId) return void tryOtherUpload(now.trackId, now.youtubeId, tr('This video can’t play here ({reason})', { reason: u.unplayable }), 'unplayable on the watch page')
      useStore.getState().notify(tr('This video can’t play here ({reason}): skipped', { reason: u.unplayable }), { kind: 'error' })
      return get().step(1)
    }
    if (u.error !== undefined) {
      // Network gone mid-song (player error 5…): the video isn't to blame, nothing is blocked.
      if (offline()) return waitForNetwork(get().playId)
      // 100: removed. Another upload of the same song, else the next song.
      if (now?.trackId && now.youtubeId && u.error === 100) return void tryOtherUpload(now.trackId, now.youtubeId, tr('This video was removed'), 'removed (error 100)')
      // Any other refusal (101 / 150 embedding off, 152 / 153 player configuration, 5 player error…): same video from
      // its watch page, invisible switch. Refused there too: another upload, never a dead stop.
      if (now?.youtubeId && !watching(now.youtubeId)) {
        block(now.youtubeId)
        return playOnWatchPage(now.youtubeId, get().positionMs)
      }
      if (now?.trackId && now.youtubeId) return void tryOtherUpload(now.trackId, now.youtubeId, tr('YouTube playback failed (error {code}).', { code: u.error }), `player error ${u.error}`)
      useStore.setState({ error: tr('YouTube playback failed (error {code}).', { code: u.error }) })
      return set({ playing: false })
    }
    if (ytFresh) {
      if (u.time === undefined || u.time * 1000 > get().startAt + 3000) {
        // Old video's last words: its time, duration and end don't count.
        if (u.state === 0) return
        u = { ...u, time: undefined, duration: undefined }
      } else ytFresh = false
    }
    if (u.state !== undefined) ytState = u.state
    // Paused (or restored paused) while it was starting, and YouTube plays it anyway: paused again.
    if (u.state === 1 && !get().playing && (get().hold || Date.now() - pausedAt < PAUSE_HOLD_MS)) {
      yt('pauseVideo')
      u = { ...u, state: undefined }
    }
    // The song's own end (learned early end) is the length everywhere: fades, overlap, times shown.
    if (u.duration) videoMs = u.duration * 1000
    const songMs = videoMs && get().earlyEnds ? songEnd(now?.youtubeId, videoMs) : videoMs
    set({
      ...(u.state !== undefined && u.state !== 3 && { playing: u.state === 1 }),
      ...(u.time !== undefined && { positionMs: u.time * 1000 }),
      ...(u.duration && { durationMs: songMs }),
    })
    if (u.time !== undefined) {
      // Skip silence: this video's music starts later (learned by live.js): one seek past it, once per play, from the
      // start only (a resume or a seek back stays where it is).
      let time = u.time
      const lead = skipLeadId !== get().playId && get().skipSilence && now?.youtubeId && time < 1.5 && get().startAt === 0 && get().playing ? songStart(now.youtubeId) : 0
      if (lead > time + 1.5) {
        skipLeadId = get().playId
        yt('seekTo', lead, true)
        time = lead
        set({ positionMs: lead * 1000 })
      }
      progress(time * 1000, videoMs || undefined)
      get().applyVolume()
      overlap()
      // Past the song's own end, silence left: over (unless the overlap just moved on). Checked at each report: the
      // length came once (2026-10-30: read from each report, an early end was only ever reached by the overlap).
      if (songMs < videoMs && time * 1000 >= songMs && get().now === now) return songOver()
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
      // The run moved on: the engine learns the silences of the songs now ahead of it.
      if (get().skipSilence) void api.silencePrepare(list.slice(i, i + 4).flatMap((x) => (x.ids.local ? [x.ids.local] : []))).catch(() => {})
    }
    // Skip silence: the engine says where the music of this file ends; from there it is a video with an early end.
    const skip = get().skipSilence
    const key = s.path ? `local:${s.path}` : undefined
    if (key) offerEnd(key, skip && s.trimEndMs ? s.trimEndMs / 1000 : null)
    const songMs = skip && s.durationMs ? songEnd(key, s.durationMs) : s.durationMs
    if (s.path) progress(s.positionMs, songMs)
    set({
      playing: !!s.path && !s.paused,
      positionMs: s.positionMs,
      upcoming: now?.trackId ? [] : s.upcoming,
      ...(songMs && { durationMs: songMs }),
      ...(i > index && { index: i, playId: get().playId + 1, fadeIn: get().fade.in, now: { title: list[i].title, artist: list[i].artist, trackId: list[i].id, via: 'local', path: s.path! } }),
      ...(s.path && !now?.trackId && { now: { title: fileTitle(s.path), artist: tr('Local file'), path: s.path, via: 'local' }, ...(s.path !== now?.path && { playId: get().playId + 1 }) }),
    })
    if (s.path) get().applyVolume()
    // Past the music's end, silence left: over, as for a video (once per song).
    if (s.durationMs && songMs && songMs < s.durationMs && !s.paused && s.positionMs >= songMs && get().now?.path === s.path) songOver()
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

/**
 * YouTube → YouTube overlap (user's request 2026-10-26): as the fade out begins, the next song starts in a new embed
 * and the old one plays on as the tail (PlayerBar), fading out. Watch page, other sources, sleep timer: fade out, then in.
 */
function overlap() {
  const p = usePlayer.getState()
  const { now, list, order, index, repeat } = p
  if (p.tail?.done === false || !p.playing || ytFresh || stopAtEnd || now?.via !== 'youtube' || !now.youtubeId || watching() || !overlapDue(p.positionMs, p.durationMs, p.fade)) return
  const i = nextIndex(order, index, 1, repeat, true, (j) => passOver(list[j], p.skipLong))
  const next = i === null ? undefined : (useStore.getState().tracks.find((x) => x.id === list[i].id) ?? list[i])
  if (i === null || i === index || !next || vias(next, spotifyOn())[0] !== 'youtube' || next.ids.youtube === now.youtubeId) return
  if (beforeNext?.()) return
  endListen(true)
  // In the tray: a new embed's video never starts in a hidden page (Chromium); a reused one has played there before.
  if (!p.tail) void api.holdPage().catch(() => {})
  // Old embed plays on: commands meant for the new song go nowhere until its embed binds. Live settings too: the old
  // one keeps its Adaptive Sound held through its fade out.
  bindFrame(null)
  bindLiveFrame(null)
  void p.playAt(i, undefined, { auto: true })
  // The stopped embed takes the next song into its running player; the first overlap makes it.
  usePlayer.setState({ tail: { key: p.frameKey, videoId: now.youtubeId, end: p.durationMs!, done: false }, frameKey: p.tail?.key ?? p.frameKey + 1 })
}

/**
 * Report of the overlap's tail (PlayerBar): its fade out to its song's end, then stopped there. Volume to send it, if
 * any. The end comes from the overlap: YouTube sends a video's length once, as it loads (2026-10-30: read from each
 * report, the tail never faded and played on at full volume under the next song).
 */
export function tailVolume(u: YtUpdate): number | undefined {
  const { tail, volume, fade } = usePlayer.getState()
  if (!tail || tail.done) return
  if (u.state === 0 || u.error !== undefined || (u.time !== undefined && u.time * 1000 >= tail.end)) return void usePlayer.setState({ tail: stopTail(tail) })
  if (u.time !== undefined) return Math.round(volume * fadeGain(u.time * 1000, tail.end, fade, false) * 100)
}

// A new song, or its video: playAt counts the play before it sets what plays, so the video is watched once it's set.
// Watched on playId alone, the first YouTube song of a session (or after a file) never was (2026-10-30).
usePlayer.subscribe((s, prev) => {
  if (s.now?.via === 'youtube' && (s.playId !== prev.playId || s.now.youtubeId !== prev.now?.youtubeId)) watchForStuck(s.playId)
})

// Play (playId) whose silent start was skipped: one seek per play, never a loop.
let skipLeadId = -1
// Song whose early end was reached (playId): over once.
let overId = -1
/** The playing song is over before its video or file (silence left): on to the next, as at the video's own end. */
function songOver() {
  const p = usePlayer.getState()
  if (p.playId === overId) return
  overId = p.playId
  endListen(true)
  p.step(1, true)
  // Nothing started (queue done, sleep timer, an update installing): the silence doesn't play on to end again.
  if (usePlayer.getState().playId === overId) {
    if (p.now?.via === 'youtube') yt('pauseVideo')
    else if (usePlayer.getState().playing) send({ type: 'toggle' })
  }
}

// Early end heard (live.js, in the silence after the song): kept for the next plays. The overlap's tail stops; the
// playing song is over now. Its position checks the report is about this video (not one skipped from meanwhile).
onEndHeard((end, tail) => {
  const p = usePlayer.getState()
  if (!p.earlyEnds) return
  if (tail) {
    if (!p.tail) return
    rememberEnd(p.tail.videoId, end)
    return usePlayer.setState({ tail: stopTail(p.tail) })
  }
  if (p.now?.via !== 'youtube' || !p.now.youtubeId || p.positionMs < end * 1000) return
  rememberEnd(p.now.youtubeId, end)
  songOver()
})

// Skip silence on / off: the engine skips the starts it knows (and says where music ends) only when asked.
usePlayer.subscribe((s, prev) => {
  if (s.skipSilence !== prev.skipSilence) send({ type: 'skipSilence', on: s.skipSilence })
})

// Late start heard (live.js: 2 s or more of silence from the start, then music): kept for the next plays of the video,
// which seek past it once (below). Not for a video that began elsewhere (resume, a seek): live.js checks that.
onLeadHeard((lead) => {
  const p = usePlayer.getState()
  if (!p.skipSilence || p.now?.via !== 'youtube' || !p.now.youtubeId || p.startAt > 0) return
  rememberStart(p.now.youtubeId, Math.max(0, lead - 0.3))
})

// A song plays: earlier failures no longer in a row.
usePlayer.subscribe((s) => {
  if (s.positionMs > s.startAt) failedRun.clear()
})

// Length known once playing (some YouTube cards come without): too long, and the queue got here on its own = next. The
// queue keeps the length, so a second pass skips it before it starts (no endless loop on repeat).
usePlayer.subscribe((s, prev) => {
  const t = s.list[s.index]
  if (!t || s.now?.trackId !== t.id || s.playId !== prev.playId || prev.durationMs !== null || s.durationMs === null || !reachedAuto || s.repeat === 'one') return
  const known = { ...t, durationMs: s.durationMs }
  if (!passOver(known, s.skipLong)) return
  usePlayer.setState({ list: s.list.map((x, j) => (j === s.index ? known : x)) })
  s.step(1, true)
})

/** Where the YouTube iframe should sit. Null = mini player. Moving the iframe in DOM would reload it. */
export const useVideoSlot = create<{ rect: DOMRect | null; hidden: boolean; fill: boolean; box: Box | null; set: (rect: DOMRect | null) => void }>((set, get) => ({
  rect: null,
  // Slot not 16:9 (sidebar): the video fills it, sides cut, like object-fit: cover.
  fill: false,
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
