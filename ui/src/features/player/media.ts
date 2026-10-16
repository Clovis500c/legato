import { listen } from '@tauri-apps/api/event'
import { useStore } from '../../app/store'
import { api, type LibraryTrack, type MediaNow } from '../../shared/api'
import { usePlayer, type NowPlaying } from './store'

/** Windows media panel / tray payload. Library row gives album and cover. */
export function mediaNow(now: NowPlaying | undefined, playing: boolean, track?: LibraryTrack, positionMs = 0, durationMs: number | null = null): MediaNow | null {
  if (!now) return null
  return { title: now.title, artist: now.artist, album: track?.album ?? null, playing, positionMs: Math.max(0, Math.round(positionMs)), durationMs: durationMs && Math.round(durationMs) }
}

/** Media keys and panel buttons; toggle comes from the tray menu. */
export type MediaKey = 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'stop'

/** Media key → store action. Play / pause only act when they change something. */
export function keyAction(key: MediaKey, playing: boolean): 'toggle' | 'next' | 'prev' | null {
  if (key === 'next') return 'next'
  if (key === 'previous') return 'prev'
  if (key === 'toggle') return 'toggle'
  if (key === 'play') return playing ? null : 'toggle'
  // pause, stop: our player has no stop, pausing keeps the queue.
  return playing ? 'toggle' : null
}

/** Last pushed state, to decide whether position changed beyond normal playback. */
export interface Pushed {
  info: MediaNow | null
  at: number
}

/**
 * Push needed? Windows moves the bar itself while playing: resend on track, play state or duration change, on a jump
 * (seek, > 2 s off the expected position), and every 10 s to stay in step.
 */
export function needsPush(last: Pushed | null, info: MediaNow | null, now: number): boolean {
  if (!last || !last.info || !info) return last?.info !== info
  const a = last.info
  if (a.title !== info.title || a.artist !== info.artist || a.album !== info.album || a.playing !== info.playing || a.durationMs !== info.durationMs) return true
  const expected = a.positionMs + (a.playing ? now - last.at : 0)
  return Math.abs(info.positionMs - expected) > 2000 || (info.playing && now - last.at > 10_000)
}

/** Media keys, tray and Windows media panel follow the player. Returns cleanup. */
export function startMedia(): () => void {
  let last: Pushed | null = null
  let lastTrack: number | undefined
  const push = () => {
    const { now, playing, positionMs, durationMs } = usePlayer.getState()
    const track = now?.trackId ? useStore.getState().tracks.find((t) => t.id === now.trackId) : undefined
    const info = mediaNow(now, playing, track, positionMs, durationMs)
    const at = Date.now()
    // New track: always (same title twice in a row is still a new item).
    if (now?.trackId === lastTrack && !needsPush(last, info, at)) return
    last = { info, at }
    lastTrack = now?.trackId
    void api.mediaUpdate(info, track?.ids.local ? track.id : null, track?.art ?? null).catch(() => {})
  }
  const unsub = usePlayer.subscribe((s, prev) => {
    if (s.now !== prev.now || s.playing !== prev.playing || s.positionMs !== prev.positionMs || s.durationMs !== prev.durationMs) push()
  })
  const offKey = listen<MediaKey>('media-key', ({ payload }) => {
    const p = usePlayer.getState()
    const action = keyAction(payload, p.playing)
    if (action === 'toggle') p.toggle()
    else if (action) p.step(action === 'next' ? 1 : -1)
  })
  const offSeek = listen<number>('media-seek', ({ payload }) => {
    if (usePlayer.getState().now) usePlayer.getState().seek(payload)
  })
  return () => {
    unsub()
    void offKey.then((f) => f())
    void offSeek.then((f) => f())
  }
}
