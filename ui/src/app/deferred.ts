import { api } from '../shared/api'
import { preloadPages } from './pages'

/**
 * What waits for the first screen (Rust side: src-tauri/src/deferred.rs): Discord's presence, Last.fm, Sync Mode's
 * messages, plugins, then the other pages preloaded when idle. Loaded now, not at launch. Their listeners are in before the ready signal, so a plugin that starts
 * right after it misses no call. The signal goes whatever happens here: a broken module must not hold the update rounds
 * (Rust also starts them after a few seconds). Returns cleanup.
 */
export function startDeferred(): () => void {
  let stop = () => {}
  let dead = false
  void Promise.all([import('../features/addons/discord'), import('../features/sources/lastfm'), import('../features/syncmode/syncmode'), import('../features/plugins/host')])
    .then(([discord, lastfm, sync, plugins]) => {
      if (dead) return
      const offs = [discord.startDiscord(), lastfm.startLastfm(), sync.startSyncMode(), plugins.startPlugins()]
      stop = () => offs.forEach((f) => f())
    })
    .catch(() => {})
    .finally(() => {
      void api.appReady().catch(() => {})
      preloadPages()
    })
  return () => {
    dead = true
    stop()
  }
}
