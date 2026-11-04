import { listen } from '@tauri-apps/api/event'
import { useSettings } from '../../app/settings'
import { api } from '../../shared/api'
import { viz } from '../player/vizFrames'
import { weightsOf } from '../player/vizWeigh'
import { OVERLAY_BARS, overlayBars } from './overlayBars'

/** Bars sent at most this often (ms): OBS draws a Browser Source 30 times a second by default. */
const EVERY_MS = 33

/**
 * The streaming overlay's visualizer (Settings › Playback › Visualizer on the overlay): while OBS shows the page (the
 * server's `overlay-viz` event, src-tauri remote.rs), the frames of whichever twin plays as its bars, 30 a second at
 * most. The server answers each with whether a page still reads them: none, the frames stop (no FFT for nobody).
 * Returns cleanup.
 */
export function startOverlayViz(): () => void {
  let off: (() => void) | null = null
  let last = 0
  let sending = false
  let weighs: { n: number; kind: string; w: ArrayLike<number> } = { n: 0, kind: '', w: [] }
  const out = new Uint8Array(OVERLAY_BARS)
  const stop = () => {
    off?.()
    off = null
  }
  const start = () => {
    if (off) return
    off = viz.subscribe((f) => {
      const now = performance.now()
      if (sending || now - last < EVERY_MS) return
      last = now
      const kind = useSettings.getState().settings.visualizerWeighting
      if (weighs.n !== f.left.length || weighs.kind !== kind) weighs = { n: f.left.length, kind, w: weightsOf(kind, f.left.length) }
      sending = true
      api
        .overlayBars(Array.from(overlayBars(f, weighs.w, out)))
        .then((read) => {
          if (!read) stop()
        })
        .catch(stop)
        .finally(() => (sending = false))
    })
  }
  const offEvent = listen<boolean>('overlay-viz', ({ payload }) => (payload && useSettings.getState().settings.visualizerOverlay ? start() : stop()))
  return () => {
    stop()
    void offEvent.then((f) => f())
  }
}
