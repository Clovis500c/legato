import { create } from 'zustand'
import { api, type Effects, type LiveLevels } from '../../shared/api'
import { NEUTRAL } from './effects'
import { useWatch, watching } from './watch'
import { YT_ORIGIN } from './youtube'

/**
 * Live processing of what plays (Adaptive Sound, the moving cover, the Live Editor): settings to the native
 * engine (local files, previews) and to the YouTube player (embed or watch page, crates/shield live.js), levels back
 * from whichever plays. The YouTube side runs only when a feature needs it and "Process YouTube's sound" is on; when it
 * can't (blocked, capture gives nothing) the video plays as usual and `error` says why. Spotify plays in its own app:
 * nothing to process there.
 */
export interface LiveWish {
  /** A feature wants processing or levels. */
  on: boolean
  /** YouTube only: early ends heard (ends.ts), which needs levels too. */
  ends: boolean
  /** Levels only (cover pulse, early ends): YouTube's sound stays its own, live.js only listens. */
  listen: boolean
  adaptive: boolean
  targetLufs: number
  /** YouTube's sound may be processed (Settings › Advanced). */
  youtube: boolean
  /** Live Editor settings (neutral = untouched). */
  effects: Effects
}

export const useLive = create<{ levels: LiveLevels | null; attached: boolean; error?: string }>(() => ({ levels: null, attached: false }))

/** Loudness → 0..1 for animations: -40 LUFS (quiet) to -8 (loud). */
export const energy = (l: LiveLevels | null) => (l ? Math.min(1, Math.max(0, (l.momentary + 40) / 32)) : 0)

/** How hard the music hits now, 0..1: its last 50 ms against its last 3 s (a beat swells), some overall loudness too. */
export function punch(l: LiveLevels | null): number {
  if (!l || l.momentary < -60) return 0
  const hit = Math.min(1, Math.max(0, (l.fast - l.short + 2) / 8))
  return 0.3 * energy(l) + 0.7 * hit
}

/** What the YouTube player gets. */
export function frameSettings(w: LiveWish) {
  return { on: (w.on || w.ends) && w.youtube, listen: w.listen, adaptive: w.adaptive, targetLufs: w.targetLufs }
}

/** end = the song ended there (s of the video), silence after it (live.js, ends.ts). */
type Report = { attached?: boolean; error?: string | null; levels?: LiveLevels | null; end?: number }

/** A frame message from live.js, if it is one. */
export function parseLive(origin: string, data: unknown): Report | null {
  if (origin !== YT_ORIGIN || typeof data !== 'string' || !data.includes('"musicApp":"live"')) return null
  try {
    const m = JSON.parse(data)
    return m && typeof m === 'object' && m.musicApp === 'live' ? m : null
  } catch {
    return null
  }
}

let wish: LiveWish = { on: false, ends: false, listen: false, adaptive: false, targetLufs: -14, youtube: true, effects: NEUTRAL }
// Early end heard (the store's): tail = from the overlap's fading-out embed, not what plays now.
let ended: ((end: number, tail: boolean) => void) | null = null
export const onEndHeard = (f: (end: number, tail: boolean) => void) => void (ended = f)
let frame: HTMLIFrameElement | null = null
// The app fades the song out: Adaptive Sound holds (its fades are never bent or brought up).
let ending = false

type FrameSettings = ReturnType<typeof frameSettings> & { ending: boolean; gain: number | null }
const post = (settings: FrameSettings, effects: Effects) => frame?.contentWindow?.postMessage(JSON.stringify({ musicApp: 'live', settings, effects }), YT_ORIGIN)

/**
 * Sends the current wish (or a new one) everywhere: engine always (cheap); YouTube where it plays, off elsewhere.
 * newSong = a frame is about to play a new song: its Adaptive Sound starts from the last song's gain, which may have
 * played in the other embed (overlap) or the engine.
 */
export function sendLive(next?: LiveWish, newSong = false) {
  if (next) wish = next
  void api.playerLive({ adaptive: wish.adaptive, targetLufs: wish.targetLufs, ending }).catch(() => {})
  void api.playerEffects(wish.effects).catch(() => {})
  const s = { ...frameSettings(wish), ending, gain: newSong ? (useLive.getState().levels?.gain ?? null) : null }
  if (watching()) {
    void api.ytwatchCmd({ type: 'live', ...s, effects: wish.effects }).catch(() => {})
    // The embed stopped for the watch page: no second processing in the background.
    post({ ...s, on: false }, NEUTRAL)
  } else post(s, wish.effects)
  if (!s.on) useLive.setState({ attached: false, error: undefined })
}

/** The app's fade out began (true) or is over (false): sent once per change. */
export function setEnding(on: boolean) {
  if (on === ending) return
  ending = on
  sendLive()
}

/** The embed element (PlayerBar). Each load starts idle: sendLive() again then. */
export const bindLiveFrame = (el: HTMLIFrameElement | null) => void (frame = el)

/**
 * Takes levels from whatever plays now (`playing()`: 'native' engine, 'youtube', or null) and polls the engine while
 * it plays and a feature needs them. Returns cleanup.
 */
export function startLive(playing: () => 'native' | 'youtube' | null): () => void {
  const take = (m: Report) => {
    if (m.levels) useLive.setState({ levels: m.levels })
    if (m.attached !== undefined) useLive.setState({ attached: m.attached, error: m.error ?? undefined })
  }
  const onMessage = (e: MessageEvent) => {
    const m = parseLive(e.origin, e.data)
    if (!m || playing() !== 'youtube' || watching()) return
    // Another of our embeds: the overlap's fading-out tail, not what plays now (its end only).
    const now = e.source === frame?.contentWindow
    if (typeof m.end === 'number') ended?.(m.end, !now)
    if (now) take(m)
  }
  window.addEventListener('message', onMessage)
  const off = api.onLive((m) => {
    if (playing() !== 'youtube' || !watching()) return
    if (typeof m.end === 'number') ended?.(m.end, false)
    take(m)
  })
  // Embed ↔ watch page: settings follow the video.
  const unwatch = useWatch.subscribe((s, prev) => {
    if (s.video !== prev.video) sendLive()
  })
  // Engine levels at ~30 Hz, only when asked for and playing natively (hidden window: timers slow down by themselves).
  const poll = setInterval(() => {
    if (!wish.on || playing() !== 'native') return
    void api
      .playerLevels()
      .then((levels) => useLive.setState({ levels }))
      .catch(() => {})
  }, 33)
  return () => {
    window.removeEventListener('message', onMessage)
    void off.then((f) => f())
    unwatch()
    clearInterval(poll)
  }
}
