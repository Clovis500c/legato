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
  return { on: w.on && w.youtube, adaptive: w.adaptive, targetLufs: w.targetLufs }
}

type Report = { attached?: boolean; error?: string | null; levels?: LiveLevels | null }

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

let wish: LiveWish = { on: false, adaptive: false, targetLufs: -14, youtube: true, effects: NEUTRAL }
let frame: HTMLIFrameElement | null = null

const post = (settings: ReturnType<typeof frameSettings>, effects: Effects) => frame?.contentWindow?.postMessage(JSON.stringify({ musicApp: 'live', settings, effects }), YT_ORIGIN)

/** Sends the current wish (or a new one) everywhere: engine always (cheap); YouTube where it plays, off elsewhere. */
export function sendLive(next?: LiveWish) {
  if (next) wish = next
  void api.playerLive({ adaptive: wish.adaptive, targetLufs: wish.targetLufs }).catch(() => {})
  void api.playerEffects(wish.effects).catch(() => {})
  const s = frameSettings(wish)
  if (watching()) {
    void api.ytwatchCmd({ type: 'live', ...s, effects: wish.effects }).catch(() => {})
    // The embed stopped for the watch page: no second processing in the background.
    post({ ...s, on: false }, NEUTRAL)
  } else post(s, wish.effects)
  if (!s.on) useLive.setState({ attached: false, error: undefined })
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
    if (m && playing() === 'youtube' && !watching()) take(m)
  }
  window.addEventListener('message', onMessage)
  const off = api.onLive((m) => {
    if (playing() === 'youtube' && watching()) take(m)
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
