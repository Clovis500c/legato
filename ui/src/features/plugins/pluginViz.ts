import { create } from 'zustand'
import { useSettings } from '../../app/settings'
import { api } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'
import type { VisualizerStyle } from '../../shared/theme/theme'
import { createBeat } from '../player/vizBeat'
import { viz } from '../player/vizFrames'
import { BUILT_IN_LOOKS, VISUALIZER_LABELS } from '../player/vizLooks'
import { weightsOf } from '../player/vizWeigh'
import { OVERLAY_BARS, overlayBars } from '../remote/overlayBars'
import type { DrawOp } from './drawList'

/**
 * Plugins' looks for the visualizer (docs/plugins.md › Visualizer): the looks running plugins offer, each one's last
 * picture, and the frames sent to the one that shows.
 */
export const usePluginViz = create<{ looks: Record<string, string>; ops: Record<string, DrawOp[]> }>(() => ({ looks: {}, ops: {} }))

/** A look as one string: a built-in one, or `plugin:<id>`. */
export const lookValue = (style: VisualizerStyle, plugin: string) => (style === 'plugin' ? `plugin:${plugin}` : style)

/** The settings a look's string stands for. */
export const lookSettings = (v: string): { visualizerStyle: VisualizerStyle; visualizerPlugin?: string } =>
  v.startsWith('plugin:') ? { visualizerStyle: 'plugin', visualizerPlugin: v.slice(7) } : { visualizerStyle: v as VisualizerStyle }

/** Every look to pick (Settings, the visualizer's menu): the built-in ones, then the running plugins'. */
export const lookOptions = (looks: Record<string, string>) => [
  ...BUILT_IN_LOOKS.map((v) => ({ value: v as string, label: tr(VISUALIZER_LABELS[v]) })),
  ...Object.entries(looks).map(([id, name]) => ({ value: `plugin:${id}`, label: tr('{name} (plugin)', { name }) })),
]

/** Frames sent at most this often (ms). */
const EVERY_MS = 33

const feeds = new Map<string, { n: number; stop: () => void }>()

/** Frames to plugin `id` while a canvas draws its look and the music plays: one feed, however many canvases (the strip, the full screen). Returns release. */
export function feedPlugin(id: string): () => void {
  const f = feeds.get(id) ?? { n: 0, stop: startFeed(id) }
  f.n++
  feeds.set(id, f)
  let done = false
  return () => {
    if (done) return
    done = true
    f.n--
    if (f.n > 0) return
    f.stop()
    feeds.delete(id)
  }
}

/**
 * The frame a plugin gets: 31 third-octave bands 0..1 (the overlay's, weighted as the visualizer is), a beat since the
 * last one (every frame is heard, only some are sent), the tempo, the louder side's level and peak in dBFS.
 */
function startFeed(id: string): () => void {
  let last = 0
  let sending = false
  let beat = false
  let both = new Float32Array(0)
  let weighs: { n: number; kind: string; w: ArrayLike<number> } = { n: 0, kind: '', w: [] }
  const out = new Uint8Array(OVERLAY_BARS)
  const beats = createBeat()
  return viz.subscribe((f) => {
    if (both.length !== f.left.length) both = new Float32Array(f.left.length)
    for (let i = 0; i < both.length; i++) both[i] = (f.left[i] + f.right[i]) / 2
    if (beats.push(both, performance.now() / 1000).onset) beat = true
    const now = performance.now()
    if (sending || now - last < EVERY_MS) return
    last = now
    const kind = useSettings.getState().settings.visualizerWeighting
    if (weighs.n !== f.left.length || weighs.kind !== kind) weighs = { n: f.left.length, kind, w: weightsOf(kind, f.left.length) }
    const bands = Array.from(overlayBars(f, weighs.w, out), (v) => Math.round((v / 255) * 1000) / 1000)
    const tempo = beats.tempo()
    const payload = { bands, beat, bpm: tempo ? Math.round(tempo.bpm) : null, level: Math.round(Math.max(f.rms[0], f.rms[1]) * 10) / 10, peak: Math.round(Math.max(f.peak[0], f.peak[1]) * 10) / 10 }
    beat = false
    sending = true
    api
      .pluginFrame(id, payload)
      .catch(() => {})
      .finally(() => (sending = false))
  })
}
