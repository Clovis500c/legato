import { api } from '../shared/api'
import { reportError } from '../shared/diag'
import { preloadPages } from './pages'

/**
 * What waits for the first screen (Rust side: src-tauri/src/deferred.rs): Discord's presence, Last.fm, Sync Mode's
 * messages, plugins, then the other pages preloaded when idle. Loaded now, not at launch. Their listeners are in before the ready signal, so a plugin that starts
 * right after it misses no call. The signal goes whatever happens here: a broken module must not hold the update rounds
 * (Rust also starts them after a few seconds). Returns cleanup.
 */
export function startDeferred(): () => void {
  const offs: Array<() => void> = []
  let dead = false
  // Each module on its own: one chunk that fails to load or start leaves the other three running. Reported, not silent.
  const starts: Array<[string, () => Promise<() => void>]> = [
    ['Discord', () => import('../features/addons/discord').then((m) => m.startDiscord())],
    ['Last.fm', () => import('../features/sources/lastfm').then((m) => m.startLastfm())],
    ['Sync Mode', () => import('../features/syncmode/syncmode').then((m) => m.startSyncMode())],
    ['Plugins', () => import('../features/plugins/host').then((m) => m.startPlugins())],
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
