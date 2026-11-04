import { create } from 'zustand'
import { useSettings } from '../../app/settings'
import { api, type RemoteLink } from '../../shared/api'
import { reportError } from '../../shared/diag'
import { tr, useLang } from '../../shared/i18n/i18n'
import { usePlayer } from '../player/store'
import { startOverlayViz } from './overlayViz'
import { upNextSongs } from './upNext'

/** Phone remote (Settings › Playback): the link to show, null while off or starting; `failed` = the server didn't start. */
export const useRemote = create<{ link: RemoteLink | null; failed: boolean }>(() => ({ link: null, failed: false }))

// The page's words (src-tauri/src/remote.html), keyed by the English text.
const words = (): Record<string, string> => ({
  Play: tr('Play'),
  Pause: tr('Pause'),
  Next: tr('Next'),
  Previous: tr('Previous'),
  'Nothing playing': tr('Nothing playing'),
  Position: tr('Position'),
  'Up next': tr('Up next'),
  'No answer from Legato. Is it open on the PC, and this phone on the same network?': tr('No answer from Legato. Is it open on the PC, and this phone on the same network?'),
})

/** Starts the server (the running one kept) and shows its link. `fresh`: a new secret, older links stop working. */
export async function remoteLink(fresh: boolean): Promise<void> {
  try {
    useRemote.setState({ link: await api.remoteStart(words(), fresh), failed: false })
    // Same secret: the overlay's link changes with it.
    if (fresh && useOverlay.getState().url) void overlayLink()
  } catch (e) {
    useRemote.setState({ link: null, failed: true })
    reportError('remote', e, 'Phone remote did not start')
  }
}

/** Runs the remote while its setting is on (this PC's own, not synced): words again when the language changes, Up next
 *  sent as it changes (half a second after the last change). Returns cleanup. */
export function startRemote(): () => void {
  let on = false
  let offPlayer: (() => void) | undefined
  let timer = 0
  const sendQueue = () => {
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      const { list, order, index } = usePlayer.getState()
      void api.remoteQueue(upNextSongs(list, order, index)).catch(() => {})
    }, 500)
  }
  const stop = () => {
    on = false
    offPlayer?.()
    offPlayer = undefined
    clearTimeout(timer)
    useRemote.setState({ link: null, failed: false })
    void api.remoteStop().catch(() => {})
  }
  const apply = () => {
    const want = useSettings.getState().settings.phoneRemote
    if (want === on) return
    if (!want) return stop()
    on = true
    void remoteLink(false)
    offPlayer = usePlayer.subscribe((s, p) => {
      if (s.list !== p.list || s.order !== p.order || s.index !== p.index) sendQueue()
    })
    sendQueue()
  }
  const offSettings = useSettings.subscribe(apply)
  const offLang = useLang.subscribe(() => on && void remoteLink(false))
  apply()
  return () => {
    offSettings()
    offLang()
    if (on) stop()
  }
}

/** Streaming overlay (Settings › Playback): its link for OBS, null while off or starting. */
export const useOverlay = create<{ url: string | null; failed: boolean }>(() => ({ url: null, failed: false }))

async function overlayLink(): Promise<void> {
  try {
    useOverlay.setState({ url: await api.overlayStart(useSettings.getState().settings.visualizerOverlay), failed: false })
  } catch (e) {
    useOverlay.setState({ url: null, failed: true })
    reportError('remote', e, 'Streaming overlay did not start')
  }
}

/** Runs the overlay's server while its setting is on (this PC's own), with its visualizer's bars; its link again when the
 *  phone remote moves the server (on or off) or the visualizer is turned on or off. Returns cleanup. */
export function startOverlay(): () => void {
  let on = false
  let stopViz: (() => void) | undefined
  let { phoneRemote: phone, visualizerOverlay: bars } = useSettings.getState().settings
  const apply = () => {
    const { streamOverlay: want, phoneRemote, visualizerOverlay } = useSettings.getState().settings
    const moved = phoneRemote !== phone || visualizerOverlay !== bars
    phone = phoneRemote
    bars = visualizerOverlay
    if (want && (!on || moved)) {
      on = true
      stopViz ??= startOverlayViz()
      void overlayLink()
    } else if (!want && on) {
      on = false
      stopViz?.()
      stopViz = undefined
      useOverlay.setState({ url: null, failed: false })
      void api.overlayStop().catch(() => {})
    }
  }
  const off = useSettings.subscribe(apply)
  apply()
  return () => {
    off()
    stopViz?.()
    if (on) void api.overlayStop().catch(() => {})
  }
}
