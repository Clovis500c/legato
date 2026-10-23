import { create } from 'zustand'
import { useStore } from '../../app/store'
import { api, type LastfmStatus } from '../../shared/api'
import { scrobbles, toScrobble } from './lastfmRules'
import { onListenEnd } from '../player/listens'
import { usePlayer } from '../player/store'

/** Last.fm account state (Settings › Accounts). */
export const useLastfm = create<LastfmStatus & { refresh: () => Promise<void> }>((set) => ({
  configured: false,
  user: null,
  waiting: 0,
  refresh: async () => set(await api.lastfmStatus().catch(() => ({ configured: false, user: null, waiting: 0 }))),
}))

/** Signed in: what plays now goes to the profile, and every real listen is scrobbled. */
export function startLastfm() {
  void useLastfm.getState().refresh()
  const on = () => !!useLastfm.getState().user
  const trackOf = (id: number) => usePlayer.getState().list.find((t) => t.id === id) ?? useStore.getState().tracks.find((t) => t.id === id)
  onListenEnd((play, durationMs) => {
    const t = trackOf(play.trackId)
    if (!on() || !t || !scrobbles(durationMs ?? t.durationMs, play.listenedMs)) return
    api.lastfmScrobble(toScrobble(t, play.startedAt)).then(
      (waiting) => useLastfm.setState({ waiting }),
      (e) => (useStore.getState().notify(String(e), { kind: 'error' }), void useLastfm.getState().refresh()),
    )
  })
  let last: number | undefined
  const off = usePlayer.subscribe((s) => {
    const id = s.now?.trackId
    if (!s.playing || id === undefined || id === last) return
    last = id
    const t = trackOf(id)
    if (on() && t) void api.lastfmNowPlaying(toScrobble(t, Math.floor(Date.now() / 1000))).catch(() => {})
  })
  return () => {
    off()
    onListenEnd(null)
  }
}
