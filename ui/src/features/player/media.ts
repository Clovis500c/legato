import { listen } from '@tauri-apps/api/event'
import { api, type LibraryTrack, type MediaNow } from '../../shared/api'
import { sizedArt, trackArt } from '../../shared/art'
import { useBlind } from '../blind/blindOpen'
import { nowTrack, type NowPlaying, usePlayer } from './store'

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

/** The phone's notification and lock screen (Android's MediaSession, `MainActivity.kt`): what plays, as JSON. */
export function phoneMessage(info: MediaNow | null): string {
  if (!info) return '{}'
  return JSON.stringify({ title: info.title, artist: info.artist, playing: info.playing, positionMs: info.positionMs, durationMs: info.durationMs ?? -1 })
}

/** A button of the phone's notification: play, pause, next, previous or seek:<ms>. */
export function phoneButton(text: string): { key: MediaKey } | { seek: number } | null {
  if (text.startsWith('seek:')) {
    const ms = Number(text.slice(5))
    return Number.isFinite(ms) ? { seek: ms } : null
  }
  return ['play', 'pause', 'next', 'previous'].includes(text) ? { key: text as MediaKey } : null
}

/**
 * A picture read back as JPEG base64 through a canvas; null = failed. The page's CSP keeps `fetch` off the art scheme,
 * and its answers allow any origin, so the canvas stays readable.
 */
function jpeg(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        c.getContext('2d')?.drawImage(img, 0, 0)
        resolve(c.toDataURL('image/jpeg', 0.9).split(',')[1] || null)
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** The phone notification's cover: the first candidate the art scheme serves, as its 256 px thumbnail; '' = none. */
export async function phoneCover(urls: string[], load: (src: string) => Promise<string | null> = jpeg): Promise<string> {
  for (const url of urls) {
    const data = await load(sizedArt(url, 256))
    if (data) return data
  }
  return ''
}

/** The native side of the phone's media session, there only (Android's WebView). */
interface PhoneBridge {
  postMessage(text: string): void
  onmessage: ((e: { data: unknown }) => void) | null
}

/** Media keys, tray and Windows media panel follow the player. Returns cleanup. */
export function startMedia(): () => void {
  const phone = (window as unknown as { LegatoMedia?: PhoneBridge }).LegatoMedia
  let last: Pushed | null = null
  let lastTrack: number | undefined
  const push = () => {
    const { playing, positionMs, durationMs } = usePlayer.getState()
    // A blind test: Windows' media panel and the phone's notification would give the song away.
    const now = useBlind.getState().open ? undefined : usePlayer.getState().now
    const track = now && nowTrack()
    const info = mediaNow(now, playing, track, positionMs, durationMs)
    const at = Date.now()
    const fresh = now?.trackId !== lastTrack
    // New track: always (same title twice in a row is still a new item).
    if (!fresh && !needsPush(last, info, at)) return
    last = { info, at }
    lastTrack = now?.trackId
    if (!phone) {
      void api.mediaUpdate(info, track?.ids.local ? track.id : null, track?.art ?? null).catch(() => {})
      return
    }
    phone.postMessage(phoneMessage(info))
    // Its cover follows, unless another song came first.
    if (fresh && info) {
      const id = lastTrack
      void phoneCover(track ? trackArt(track) : []).then((cover) => {
        if (lastTrack === id) phone.postMessage(JSON.stringify({ cover }))
      })
    }
  }
  const unsub = usePlayer.subscribe((s, prev) => {
    if (s.now !== prev.now || s.playing !== prev.playing || s.positionMs !== prev.positionMs || s.durationMs !== prev.durationMs) push()
  })
  const offBlind = useBlind.subscribe(push)
  const offKey = listen<MediaKey>('media-key', ({ payload }) => {
    const p = usePlayer.getState()
    const action = keyAction(payload, p.playing)
    if (action === 'toggle') p.toggle()
    else if (action) p.step(action === 'next' ? 1 : -1)
  })
  const offSeek = listen<number>('media-seek', ({ payload }) => {
    if (usePlayer.getState().now) usePlayer.getState().seek(payload)
  })
  if (phone) {
    phone.onmessage = (e) => {
      const b = typeof e.data === 'string' ? phoneButton(e.data) : null
      const p = usePlayer.getState()
      if (!b) return
      if ('seek' in b) {
        if (p.now) p.seek(b.seek)
      } else {
        const action = keyAction(b.key, p.playing)
        if (action === 'toggle') p.toggle()
        else if (action) p.step(action === 'next' ? 1 : -1)
      }
    }
    push()
  }
  return () => {
    if (phone) phone.onmessage = null
    unsub()
    offBlind()
    void offKey.then((f) => f())
    void offSeek.then((f) => f())
  }
}
