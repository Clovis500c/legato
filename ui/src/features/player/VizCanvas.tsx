import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../../app/settings'
import { trackArt } from '../../shared/art'
import { tr } from '../../shared/i18n/i18n'
import type { VisualizerStyle, VizColor } from '../../shared/theme/theme'
import type { DrawOp } from '../plugins/drawList'
import { feedPlugin, usePluginViz } from '../plugins/pluginViz'
import { averageColor, coverColors, vivid } from './ambient'
import { subscribeLoud } from './loudFeed'
import { useNowTrack, usePlayer } from './store'
import { viz } from './vizFrames'
import { presetOf } from './vizPresets'
import { frameMessage, type ToWorker } from './vizProtocol'
import { gradientStops } from './vizStops'

/** Drawing rate, frames a second: the sound's own frames come at 60 (step 1), the picture is drawn at half of that. */
const FPS = 30

/** Reduced motion: the app's Animations setting off, or Windows' / the browser's preference. */
export function useCalm() {
  const motion = useSettings((s) => s.settings.motion)
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const q = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return !motion || reduced
}

/** WebGL2 on a worker's canvas, asked once: the Presets look draws with it, the bars stand in where it can't. */
let gl2: boolean | undefined
function canDrawPresets(): boolean {
  if (gl2 === undefined) {
    try {
      const c = new OffscreenCanvas(1, 1).getContext('webgl2')
      gl2 = !!c
      c?.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      gl2 = false
    }
  }
  return gl2
}

/** The page is shown (not minimized, not in the tray). */
function usePageVisible() {
  const [shown, setShown] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const on = () => setShown(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return shown
}

/**
 * The music as moving bars, drawn by a worker on an OffscreenCanvas (vizWorker.ts, vizPaint.ts): this side only sizes
 * the canvas, picks the colour, and hands frames over. It fills its parent's box. Frames, and the worker's animation
 * loop, run only while something is seen: `listen` (the caller shows it), page shown (not hidden in the tray), element
 * on screen, and the music playing; a paused song lets the bars fall to rest, then nothing runs at all.
 */
export function VizCanvas({ look: asked, listen = true }: { look: VisualizerStyle; listen?: boolean }) {
  const pluginId = useSettings((s) => s.settings.visualizerPlugin)
  const pluginOn = usePluginViz((s) => asked === 'plugin' && pluginId in s.looks)
  // A plugin's look while its plugin runs; bars otherwise (stopped, removed, not started yet). Presets: bars without WebGL2.
  const look: VisualizerStyle = (asked === 'plugin' && !pluginOn) || (asked === 'preset' && !canDrawPresets()) ? 'bars' : asked
  const plugin = look === 'plugin'
  const box = useRef<HTMLDivElement>(null)
  const worker = useRef<Worker | null>(null)
  const [ready, setReady] = useState(false)
  const [onScreen, setOnScreen] = useState(true)
  const shown = usePageVisible()
  const calm = useCalm()
  const weighting = useSettings((s) => s.settings.visualizerWeighting)
  const color = useSettings((s) => s.settings.visualizerColor)
  const coverInk = useCoverInk(color === 'cover')
  const coverDots = useCoverColors(look === 'particles')
  const gradient = useSettings((s) => s.settings.visualizerGradient)
  const bands = useSettings((s) => s.settings.visualizerBands)
  const floor = useSettings((s) => s.settings.visualizerFloor)
  const face = useSettings((s) => s.settings.visualizerFace)
  const colormap = useSettings((s) => s.settings.visualizerColormap)
  const darkTheme = useSettings((s) => s.current().dark)
  const playing = usePlayer((s) => s.playing)
  const theme = useSettings((s) => s.settings.theme)
  const accent = useSettings((s) => s.settings.accent)
  const dark = useSettings((s) => s.systemDark)
  const song = usePlayer((s) => s.now?.trackId ?? s.now?.youtubeId ?? '')
  // The loudness meter's words follow the interface's language.
  const language = useSettings((s) => s.settings.language)
  const presetId = useSettings((s) => s.settings.visualizerPreset)
  const presetOwn = useSettings((s) => s.settings.visualizerPresetColors === 'own')
  const saved = useSettings((s) => s.settings.visualizerPresets)
  const meter = look === 'loudness'
  const drawing = listen && shown && onScreen
  const live = drawing && playing

  // The canvas and its worker live as long as this view. Made here (not in JSX): a canvas can be handed over only once.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const canvas = document.createElement('canvas')
    canvas.className = 'block size-full'
    el.append(canvas)
    let w: Worker
    try {
      const offscreen = canvas.transferControlToOffscreen()
      w = new Worker(new URL('./vizWorker.ts', import.meta.url), { type: 'module' })
      w.postMessage({ t: 'init', canvas: offscreen } satisfies ToWorker, [offscreen])
    } catch {
      // No worker or no offscreen canvas: an empty box, nothing else depends on it.
      canvas.remove()
      return
    }
    worker.current = w
    const size = () => w.postMessage({ t: 'size', w: el.clientWidth, h: el.clientHeight, dpr: window.devicePixelRatio || 1 } satisfies ToWorker)
    size()
    const ro = new ResizeObserver(size)
    ro.observe(el)
    // A window moved to another screen changes the density without resizing the box.
    window.addEventListener('resize', size)
    const io = new IntersectionObserver((e) => setOnScreen(e[e.length - 1].isIntersecting))
    io.observe(el)
    setReady(true)
    return () => {
      ro.disconnect()
      io.disconnect()
      window.removeEventListener('resize', size)
      w.terminate()
      worker.current = null
      canvas.remove()
      setReady(false)
    }
  }, [])

  // Look, reduced motion, colour. The theme's text colour, read where it is drawn (Now Playing tints it with the cover):
  // again after its colour transition.
  useEffect(() => {
    const el = box.current
    const w = worker.current
    if (!el || !w) return
    const send = () => {
      const ink = inkOf(el, color, coverInk)
      const warn = getComputedStyle(el).getPropertyValue('--color-danger').trim() || '#d93a2b'
      const words = { momentary: tr('Momentary'), short: tr('Short-term'), integrated: tr('Integrated'), range: tr('Loudness range'), peak: tr('True peak') }
      w.postMessage({ t: 'look', look, calm, weighting, ink, ink2: secondOf(el, color), warn, gradient, stops: gradientStops(gradient, ink, warn, darkTheme), bands, floor, fps: FPS, words, face, colormap } satisfies ToWorker)
    }
    send()
    const late = setTimeout(send, 700)
    return () => clearTimeout(late)
  }, [ready, look, calm, weighting, color, coverInk, gradient, bands, floor, face, colormap, darkTheme, theme, accent, dark, song, language])

  // Particles: the cover's colours (the ink until they are known, or for a grey cover); light that adds up on a dark theme.
  useEffect(() => {
    const w = worker.current
    if (!w || look !== 'particles') return
    w.postMessage({ t: 'palette', colors: coverDots ?? [], glow: darkTheme } satisfies ToWorker)
  }, [ready, look, coverDots, darkTheme])

  // The Presets look: its preset (compiled in the worker) and its colours.
  useEffect(() => {
    const w = worker.current
    if (!w || look !== 'preset') return
    w.postMessage({ t: 'preset', data: presetOf(presetId, saved), own: presetOwn } satisfies ToWorker)
  }, [ready, look, presetId, presetOwn, saved])

  // A plugin's look: its pictures to the worker as they come.
  useEffect(() => {
    const w = worker.current
    if (!w || !plugin) return
    const send = (ops: DrawOp[] | undefined) => w.postMessage({ t: 'ops', ops: ops ?? [] } satisfies ToWorker)
    send(usePluginViz.getState().ops[pluginId])
    return usePluginViz.subscribe((s, prev) => {
      if (s.ops[pluginId] !== prev.ops[pluginId]) send(s.ops[pluginId])
    })
  }, [ready, plugin, pluginId])

  // Something draws: loop and frames. Nothing does: no loop, no subscription.
  useEffect(() => {
    const w = worker.current
    if (!w) return
    w.postMessage({ t: 'run', on: drawing } satisfies ToWorker)
    // The loudness meter: the levels' numbers instead of the frames (loudFeed.ts), its last picture kept while paused.
    if (meter) return live ? subscribeLoud((v) => w.postMessage({ t: 'loud', v } satisfies ToWorker)) : undefined
    // A plugin's look: the frames go to the plugin, its pictures come back (above).
    if (plugin) return live ? feedPlugin(pluginId) : undefined
    if (!live) {
      if (drawing) w.postMessage({ t: 'silence' } satisfies ToWorker)
      return
    }
    // A silent frame (a gap, a stalled buffer, a stop) is silence: the bars fall, then the loop stops.
    return viz.subscribe((f) => w.postMessage(frameMessage(f)))
  }, [ready, drawing, live, meter, plugin, pluginId])

  // The pointer over it: the worker shows its frequency and dB scales (a big enough box only).
  const hover = (on: boolean) => () => worker.current?.postMessage({ t: 'hover', on } satisfies ToWorker)
  return <div ref={box} aria-hidden onPointerEnter={hover(true)} onPointerLeave={hover(false)} className="size-full text-ink" />
}

/** The Curve look's right side: the accent, or the text colour when the visualizer is already the accent. */
function secondOf(el: HTMLElement, color: VizColor): string {
  const css = getComputedStyle(el)
  return (color !== 'accent' && css.getPropertyValue('--color-accent').trim()) || css.color
}

/** The visualizer's colour: the text colour where it is drawn, the theme's accent, or the cover's (text until known). */
function inkOf(el: HTMLElement, color: VizColor, cover: string | null): string {
  const css = getComputedStyle(el)
  if (color === 'accent') return css.getPropertyValue('--color-accent').trim() || css.color
  return (color === 'cover' && cover) || css.color
}

/** The playing song's cover hue, vivid for the theme; null when off, coverless or grey. */
function useCoverInk(on: boolean): string | null {
  const track = useNowTrack()
  const src = on && track ? trackArt(track)[0] : undefined
  const dark = useSettings((s) => s.current().dark)
  const [got, setGot] = useState<{ key: string; ink: string | null }>()
  const key = `${src}|${dark}`
  useEffect(() => {
    if (!src) return
    let live = true
    void averageColor(src).then((rgb) => live && setGot({ key: `${src}|${dark}`, ink: rgb ? vivid(rgb, dark) : null }))
    return () => {
      live = false
    }
  }, [src, dark])
  return src && got?.key === key ? got.ink : null
}

/** The playing song's cover colours, the most present first, vivid for the theme; null when off or not known yet, none when grey. */
function useCoverColors(on: boolean): string[] | null {
  const track = useNowTrack()
  const src = on && track ? trackArt(track)[0] : undefined
  const dark = useSettings((s) => s.current().dark)
  const [got, setGot] = useState<{ key: string; colors: string[] }>()
  const key = `${src}|${dark}`
  useEffect(() => {
    if (!src) return
    let live = true
    void coverColors(src).then((rgbs) => live && setGot({ key: `${src}|${dark}`, colors: (rgbs ?? []).flatMap((rgb) => vivid(rgb, dark) ?? []) }))
    return () => {
      live = false
    }
  }, [src, dark])
  return src && got?.key === key ? got.colors : null
}
