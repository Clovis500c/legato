import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../../app/settings'
import { trackArt } from '../../shared/art'
import type { VisualizerStyle, VizColor } from '../../shared/theme/theme'
import { averageColor, vivid } from './ambient'
import { useNowTrack, usePlayer } from './store'
import { viz } from './vizFrames'
import { frameMessage, type ToWorker } from './vizProtocol'

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
export function VizCanvas({ look, listen = true }: { look: VisualizerStyle; listen?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const worker = useRef<Worker | null>(null)
  const [ready, setReady] = useState(false)
  const [onScreen, setOnScreen] = useState(true)
  const shown = usePageVisible()
  const calm = useCalm()
  const weighting = useSettings((s) => s.settings.visualizerWeighting)
  const color = useSettings((s) => s.settings.visualizerColor)
  const coverInk = useCoverInk(color === 'cover')
  const playing = usePlayer((s) => s.playing)
  const theme = useSettings((s) => s.settings.theme)
  const accent = useSettings((s) => s.settings.accent)
  const dark = useSettings((s) => s.systemDark)
  const song = usePlayer((s) => s.now?.trackId ?? s.now?.youtubeId ?? '')
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
    const send = () => w.postMessage({ t: 'look', look, calm, weighting, ink: inkOf(el, color, coverInk), warn: getComputedStyle(el).getPropertyValue('--color-danger').trim(), fps: FPS } satisfies ToWorker)
    send()
    const late = setTimeout(send, 700)
    return () => clearTimeout(late)
  }, [ready, look, calm, weighting, color, coverInk, theme, accent, dark, song])

  // Something draws: loop and frames. Nothing does: no loop, no subscription.
  useEffect(() => {
    const w = worker.current
    if (!w) return
    w.postMessage({ t: 'run', on: drawing } satisfies ToWorker)
    if (!live) {
      if (drawing) w.postMessage({ t: 'silence' } satisfies ToWorker)
      return
    }
    // A silent frame (a gap, a stalled buffer, a stop) is silence: the bars fall, then the loop stops.
    return viz.subscribe((f) => w.postMessage(frameMessage(f)))
  }, [ready, drawing, live])

  return <div ref={box} aria-hidden className="size-full text-ink" />
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
