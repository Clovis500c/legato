import { useSyncExternalStore } from 'react'

const watch = (changed: () => void) => {
  window.addEventListener('online', changed)
  window.addEventListener('offline', changed)
  return () => {
    window.removeEventListener('online', changed)
    window.removeEventListener('offline', changed)
  }
}

/** Windows says this PC has a network (the webview's navigator.onLine). False is sure; true may still be a dead Wi-Fi. */
export const useOnline = () => useSyncExternalStore(watch, () => navigator.onLine)

/** No network at all, for code outside React (the player). Unknown counts as online: nothing is blamed on a guess. */
export const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false
