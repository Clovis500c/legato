import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettings } from '../../app/settings'
import { startFlow, type Flow } from './flow'
import { usePlayer } from './store'

/** Drift of the immersive backdrop at t seconds: there and back in 48 s, eased (scale 1.2 → 1.35, a little shift and turn). */
export function driftTransform(t: number): string {
  const phase = (t / 48) % 2
  const x = phase < 1 ? phase : 2 - phase
  const e = x * x * (3 - 2 * x)
  const lerp = (a: number, b: number) => +(a + (b - a) * e).toFixed(4)
  return `scale(${lerp(1.2, 1.35)}) translate3d(${lerp(-3, 3)}%, ${lerp(-2, 2)}%, 0) rotate(${lerp(0, 6)}deg)`
}

/** The flowing backdrop's canvas (flow.ts): the blurred cover warped while the song plays. No WebGL: `onFail`. */
function FlowCanvas({ url, onFail }: { url: string; onFail: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const flow = useRef<Flow | null>(null)
  const playing = usePlayer((s) => s.playing)
  useEffect(() => {
    flow.current = canvas.current && startFlow(canvas.current)
    if (!flow.current) onFail()
    return () => flow.current?.stop()
  }, [onFail])
  useEffect(() => {
    const img = new Image()
    img.onload = () => flow.current?.show(img)
    img.src = url
    return () => void (img.onload = null)
  }, [url])
  useEffect(() => flow.current?.run(playing), [playing])
  return <canvas ref={canvas} className="absolute inset-0 size-full" />
}

/**
 * Blurred cover layers: each new one fades in over the last, which goes once covered. Veil in the theme's color keeps
 * text readable. Flowing background on (and animations): the shader's canvas instead, on every screen with a backdrop.
 */
export function Backdrop({ url, dim, motion, flowing }: { url?: string; dim: number; motion: boolean; flowing?: boolean }) {
  const [layers, setLayers] = useState<string[]>([])
  const box = useRef<HTMLDivElement>(null)
  const wantFlow = useSettings((s) => (flowing ?? s.settings.backdropFlow) && s.settings.motion)
  const [noGl, setNoGl] = useState(false)
  const noFlow = useCallback(() => setNoGl(true), [])
  const flow = wantFlow && !noGl
  useEffect(() => {
    if (!url) return
    setLayers((l) => (l[l.length - 1] === url ? l : [...l, url].slice(-2)))
    const id = setTimeout(() => setLayers((l) => l.slice(-1)), 1000)
    return () => clearTimeout(id)
  }, [url])
  // Slow drift at 15 updates a second: a CSS animation restyled the page every frame in WebView2 (~250 recalcs/s,
  // 2026-10-21 profile); at this speed a step is under a pixel.
  useEffect(() => {
    const el = box.current
    if (!motion || flow || !el) return
    const start = performance.now()
    const id = setInterval(() => el.style.setProperty('--drift', driftTransform((performance.now() - start) / 1000)), 66)
    return () => clearInterval(id)
  }, [motion, flow, !!url])
  if (!url) return null
  return (
    <div ref={box} aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {flow && <FlowCanvas url={url} onFail={noFlow} />}
      {!flow && layers.map((u) => (
        <div key={u} className="backdrop-layer absolute -inset-[10%] bg-cover bg-center" style={{ backgroundImage: `url(${u})`, transform: motion ? 'var(--drift, scale(1.2))' : undefined }} />
      ))}
      <div className="absolute inset-0" style={{ background: `color-mix(in srgb, var(--bg) ${dim}%, transparent)` }} />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[color-mix(in_srgb,var(--bg)_70%,transparent)] to-transparent" />
    </div>
  )
}

