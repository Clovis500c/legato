import { create } from 'zustand'
import { useStore } from '../../app/store'
import { api, type ListenbrainzStatus } from '../../shared/api'
import { counts, toListen, type PlayedFrom } from './listenbrainzRules'
import { onListenEnd } from '../player/listens'
import { usePlayer } from '../player/store'

/** ListenBrainz account state (Settings › Accounts). */
export const useListenbrainz = create<ListenbrainzStatus & { refresh: () => Promise<void> }>((set) => ({
  user: null,
  waiting: 0,
  refresh: async () => set(await api.listenbrainzStatus().catch(() => ({ user: null, waiting: 0 }))),
}))

/** Token set: what plays now goes to the profile, and every real listen is sent. */
export function startListenbrainz() {
  void useListenbrainz.getState().refresh()
  const on = () => !!useListenbrainz.getState().user
  const trackOf = (id: number) => usePlayer.getState().list.find((t) => t.id === id) ?? useStore.getState().tracks.find((t) => t.id === id)
  // Where the last songs played from, for their listens' end (the next song has started by then).
  const from = new Map<number, PlayedFrom>()
  const offEnd = onListenEnd((play, durationMs) => {
    const t = trackOf(play.trackId)
    const length = durationMs ?? t?.durationMs ?? null
    if (!on() || !t || !counts(length, play.listenedMs)) return
    api.listenbrainzSubmit(toListen(t, play.startedAt, from.get(play.trackId), length)).then(
      (waiting) => useListenbrainz.setState({ waiting }),
      (e) => (useStore.getState().notify(String(e), { kind: 'error' }), void useListenbrainz.getState().refresh()),
    )
  })
  let last: number | undefined
  const off = usePlayer.subscribe((s) => {
    const id = s.now?.trackId
    if (!s.now || !s.playing || id === undefined || id === last) return
    last = id
    from.delete(id)
    from.set(id, { via: s.now.via, youtubeId: s.now.youtubeId, spotifyId: s.now.spotifyId })
    if (from.size > 8) from.delete(from.keys().next().value!)
    const t = trackOf(id)
    if (on() && t) void api.listenbrainzNowPlaying(toListen(t, Math.floor(Date.now() / 1000), from.get(id))).catch(() => {})
  })
  return () => {
    off()
    offEnd()
  }
}
