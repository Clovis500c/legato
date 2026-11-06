import { api } from '../shared/api'
import { reportError } from '../shared/diag'
import { preloadPages } from './pages'

/**
 * What waits for the first screen (Rust side: src-tauri/src/deferred.rs): Discord's presence, Last.fm, ListenBrainz, Sync Mode's
 * messages, plugins, YouTube Music's 15-minute sync, the phone remote, a phone's songs scanned again, the taskbar's Jump List, the alarm, listening rooms, then the other pages preloaded when idle. Loaded now, not at launch. Their listeners are in before the ready signal, so a plugin that starts
 * right after it misses no call. The signal goes whatever happens here: a broken module must not hold the update rounds
 * (Rust also starts them after a few seconds). Returns cleanup.
 */
export function startDeferred(): () => void {
  const offs: Array<() => void> = []
  let dead = false
  // Each module on its own: one chunk that fails to load or start leaves the others running. Reported, not silent.
  const starts: Array<[string, () => Promise<() => void>]> = [
    ['Discord', () => import('../features/addons/discord').then((m) => m.startDiscord())],
    ['Last.fm', () => import('../features/sources/lastfm').then((m) => m.startLastfm())],
    ['ListenBrainz', () => import('../features/sources/listenbrainz').then((m) => m.startListenbrainz())],
    ['Sync Mode', () => import('../features/syncmode/syncmode').then((m) => m.startSyncMode())],
    ['Plugins', () => import('../features/plugins/host').then((m) => m.startPlugins())],
    ['Auto sync', () => import('../features/sources/autosync').then((m) => m.startAutoSync())],
    ['Phone remote', () => import('../features/remote/remote').then((m) => m.startRemote())],
    ['Streaming overlay', () => import('../features/remote/remote').then((m) => m.startOverlay())],
    ['Phone songs', () => import('../features/add/phoneMusic').then((m) => m.startPhoneMusic())],
    ['Jump List', () => import('../features/home/jumpList').then((m) => m.startJumpList())],
    ['Alarm', () => import('../features/player/alarm').then((m) => m.startAlarm())],
    ['Listening rooms', () => import('../features/rooms/rooms').then((m) => m.startRooms())],
  ]
  void Promise.allSettled(
    starts.map(async ([name, start]) => {
      try {
        const off = await start()
        if (dead) off()
        else offs.push(off)
      } catch (e) {
        reportError('startup', e, `${name} did not start`)
      }
    }),
  ).finally(() => {
    void api.appReady().catch(() => {})
    preloadPages()
  })
  return () => {
    dead = true
    offs.splice(0).forEach((f) => f())
  }
}
