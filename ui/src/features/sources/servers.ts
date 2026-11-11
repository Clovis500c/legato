import { create } from 'zustand'
import { useStore } from '../../app/store'
import { api, type ServerStatus } from '../../shared/api'
import { counts } from './listenbrainzRules'
import { onListenEnd } from '../player/listens'
import { usePlayer } from '../player/store'

/** Your music servers (Settings › Accounts): what Rust says, and which one syncs now. */
export const useServers = create<{ list: ServerStatus[]; syncing: string | null; refresh: () => Promise<void> }>((set) => ({
  list: [],
  syncing: null,
  refresh: async () => set({ list: await api.serverStatus().catch(() => []) }),
}))

/** A server's playlist that takes adds and removals from here: a signed-in Subsonic kind's (Jellyfin, Plex: not yet). */
export const takesEdits = (p: { custom: boolean; source: string; sourceId: string }) => !p.custom && p.source === 'server' && useServers.getState().list.some((s) => s.kind === 'subsonic' && p.sourceId.startsWith(`${s.key}:`))

/** One server read whole into the library, then the library and the row refreshed. Returns the songs, or throws. */
export async function syncServer(key: string) {
  useServers.setState({ syncing: key })
  try {
    const done = await api.serverSync(key)
    await useStore.getState().refresh()
    return done
  } finally {
    useServers.setState({ syncing: null })
    void useServers.getState().refresh()
  }
}

/** Plays back to the server a song came from: now playing at its start; at its end the time heard and whether it
 * counts (past half of it or 4 minutes). Each kind takes what it knows (Subsonic: the listen; Jellyfin: the stop
 * too; Plex: the listen). */
export function startServers() {
  void useServers.getState().refresh()
  const serverId = (trackId: number) => (usePlayer.getState().list.find((t) => t.id === trackId) ?? useStore.getState().tracks.find((t) => t.id === trackId))?.ids.server
  // When each song started (unix ms), for its listen's end (the next song has started by then).
  const started = new Map<number, number>()
  const offEnd = onListenEnd((play, durationMs) => {
    const id = serverId(play.trackId)
    if (!id || !started.has(play.trackId)) return
    void api.serverScrobble(id, started.get(play.trackId) ?? play.startedAt * 1000, counts(durationMs, play.listenedMs), Math.max(0, Math.round(play.listenedMs))).catch(() => {})
  })
  let last: number | undefined
  const off = usePlayer.subscribe((s) => {
    const trackId = s.now?.trackId
    if (!s.now || !s.playing || trackId === undefined || trackId === last) return
    last = trackId
    // Heard from the server only: a song played from a file or YouTube isn't the server's play.
    if (s.now.via !== 'server') return
    const id = serverId(trackId)
    if (!id) return
    started.set(trackId, Date.now())
    if (started.size > 8) started.delete(started.keys().next().value!)
    void api.serverScrobble(id, Date.now(), false).catch(() => {})
  })
  return () => {
    off()
    offEnd()
  }
}
