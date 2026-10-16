import { listen } from '@tauri-apps/api/event'
import { useStore } from '../../app/store'
import { api, type LibraryTrack, type MediaNow } from '../../shared/api'
import { usePlayer, type NowPlaying } from './store'

/** Windows media panel payload. Library row gives album and cover. */
export function mediaNow(now: NowPlaying | undefined, playing: boolean, track?: LibraryTrack): MediaNow | null {
  if (!now) return null
  return { title: now.title, artist: now.artist, album: track?.album ?? null, playing }
}

export type MediaKey = 'play' | 'pause' | 'next' | 'previous' | 'stop'

/** Media key → store action. Play / pause only act when they change something. */
export function keyAction(key: MediaKey, playing: boolean): 'toggle' | 'next' | 'prev' | null {
  if (key === 'next') return 'next'
  if (key === 'previous') return 'prev'
  if (key === 'play') return playing ? null : 'toggle'
  // pause, stop: our player has no stop, pausing keeps the queue.
  return playing ? 'toggle' : null
}

/** Media keys and Windows media panel follow the player. Returns cleanup. */
export function startMedia(): () => void {
  let last = ''
  const push = () => {
    const { now, playing } = usePlayer.getState()
    const track = now?.trackId ? useStore.getState().tracks.find((t) => t.id === now.trackId) : undefined
    const info = mediaNow(now, playing, track)
    const key = JSON.stringify(info)
    if (key === last) return
    last = key
    void api.mediaUpdate(info, track?.ids.local ? track.id : null, track?.art ?? null).catch(() => {})
  }
  const unsub = usePlayer.subscribe((s, prev) => {
    if (s.now !== prev.now || s.playing !== prev.playing) push()
  })
  const off = listen<MediaKey>('media-key', ({ payload }) => {
    const p = usePlayer.getState()
    const action = keyAction(payload, p.playing)
    if (action === 'toggle') p.toggle()
    else if (action) p.step(action === 'next' ? 1 : -1)
  })
  return () => {
    unsub()
    void off.then((f) => f())
  }
}
