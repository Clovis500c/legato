import { create } from 'zustand'
import { api } from '../../shared/api'
import { fromBase64, isSilent, toBytes, unpackViz, type VizFrame } from './vizUnpack'

/**
 * Visualizer frames (Visualizer v2) from whichever twin plays: the native engine (a Tauri channel, 60 Hz, only while
 * someone subscribes: src-tauri viz.rs) or YouTube's frame (live.js, text over postMessage, 60 Hz only while the wish
 * asks for it: live.ts `viz`). Same shape either way; `latest()` is the newest frame as it came, no smoothing and no
 * interpolation (the renderer's). A twin that does not play is ignored; both send one silent frame when their sound
 * stops, and then nothing, so `latest()` keeps the last frame (silent after a stop) until sound moves again. Frames
 * carry 61 bands, or 121 once `setFine` asks for twelfths (the engine's stream starts again; YouTube's follows the
 * wish, live.ts `fine`).
 */
export type VizSource = 'native' | 'youtube' | null

interface Io {
  start: (onBytes: (b: unknown) => void, fine: boolean) => Promise<() => void>
  stop: () => Promise<void>
  /** Who plays now. */
  source: () => VizSource
}

export function createViz(io: Io, counted?: (n: number) => void) {
  const subs = new Set<(f: VizFrame) => void>()
  let newest: VizFrame | null = null
  // start / stop one after the other: the engine may run two commands in either order.
  let chain: Promise<unknown> = Promise.resolve()
  let release: (() => void) | null = null
  let fine = false
  const queue = (f: () => Promise<unknown>) => void (chain = chain.then(f).catch(() => {}))
  // The engine's stream, in the bands asked now (a start there replaces the stream before it).
  const open = async () => {
    release?.()
    release = await io.start((b) => take('native', toBytes(b)), fine)
  }

  function take(from: 'native' | 'youtube', bytes: Uint8Array | null) {
    const frame = bytes && unpackViz(bytes)
    if (!frame) return
    // Another source plays: its frames are not ours. Nothing plays (Spotify, stopped): only the silence that follows a stop.
    const now = io.source()
    if (now !== from && !(now === null && isSilent(frame))) return
    newest = frame
    subs.forEach((f) => f(frame))
  }

  return {
    /** Frames to `fn` as they come. Returns the unsubscribe. The first subscriber starts the engine's stream, the last stops it. */
    subscribe(fn: (f: VizFrame) => void): () => void {
      subs.add(fn)
      counted?.(subs.size)
      if (subs.size === 1) queue(open)
      return () => {
        if (!subs.delete(fn)) return
        counted?.(subs.size)
        if (subs.size === 0) {
          queue(async () => {
            release?.()
            release = null
            await io.stop()
          })
        }
      }
    },
    /** The newest frame, or null before the first. */
    latest: () => newest,
    /** A frame from live.js (base64). */
    fromYoutube: (text: string) => take('youtube', fromBase64(text)),
    /** Twelfths (121 bands) or sixths from now on: a running stream starts again in them. */
    setFine(on: boolean) {
      if (on === fine) return
      fine = on
      if (subs.size > 0) queue(open)
    },
    /** Subscribers now. */
    count: () => subs.size,
  }
}

/** Who plays now (set by startLive). */
let source: () => VizSource = () => null
export const bindVizSource = (f: () => VizSource) => void (source = f)

/** How many views listen: the live wish asks YouTube's frame for 60 Hz frames while it is above zero. */
export const useVizListeners = create<{ n: number }>(() => ({ n: 0 }))

export const viz = createViz(
  {
    start: (onBytes, fine) => api.vizStart(onBytes, fine),
    stop: () => api.vizStop(),
    source: () => source(),
  },
  (n) => useVizListeners.setState({ n }),
)

/** The page claims the stream (once, at start-up): see api.vizPage. Returns nothing to clean up. */
export function claimViz() {
  void api.vizPage().catch(() => {})
}
