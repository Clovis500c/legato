import type { VisualizerStyle } from '../../shared/theme/theme'
import { capSegment, litSegments } from './ledBars'
import { columnSpans, columnsFor, ledRows, wavePath, type LedRows } from './vizDraw'
import { createScene } from './vizScene'

/** Lowest bar, as a fraction of the box (a bar never vanishes). */
const FLOOR = 0.04
/** Opacity of the ink: LED segments off, lit (rising with height), cap; plain bars; the wave's fill and line. */
const OFF = 0.09
const LIT_LOW = 0.55
const LIT_HIGH = 0.95
const BAR = 0.85

interface Sprites {
  off: OffscreenCanvas
  lit: OffscreenCanvas
  cap: OffscreenCanvas
}

/**
 * Draws the visualizer on its canvas (runs in the worker; a canvas-2D 'ctx' only, no DOM). The LED look is cached
 * sprites (every segment off, every segment lit, the cap's), copied per column: a frame is a few dozen drawImage calls.
 */
export function createPainter(canvas: OffscreenCanvas) {
  const ctx = canvas.getContext('2d')
  let cssW = 0
  let cssH = 0
  let dpr = 1
  let look: VisualizerStyle = 'led'
  let calm = false
  let ink = '#888'
  let scene = createScene(columnsFor(0), false)
  let rows: LedRows = { y: [], h: [] }
  let sprites: Sprites | null = null
  let spans = columnSpans(1, 1, 0)
  let cols = 0

  /** Everything that depends on the size, the look or the colour. */
  function layout() {
    if (!ctx || !cssW || !cssH) return
    const w = Math.round(cssW * dpr)
    const h = Math.round(cssH * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const n = columnsFor(cssW)
    if (n !== cols) {
      cols = n
      scene = createScene(n, calm)
    }
    const gap = Math.max(1, Math.round((w / n) * 0.2))
    spans = columnSpans(w, n, gap)
    sprites = null
    if (look === 'led') {
      rows = ledRows(h, dpr)
      sprites = makeSprites(Math.max(...spans.w), h)
    }
  }

  function makeSprites(w: number, h: number): Sprites {
    const make = (alpha: (k: number) => number) => {
      const s = new OffscreenCanvas(w, h)
      const c = s.getContext('2d')!
      c.fillStyle = ink
      const r = Math.min(2 * dpr, w / 2)
      rows.y.forEach((y, k) => {
        c.globalAlpha = alpha(k)
        c.beginPath()
        c.roundRect(0, y, w, rows.h[k], Math.min(r, rows.h[k] / 2))
        c.fill()
      })
      return s
    }
    const top = Math.max(1, rows.y.length - 1)
    return { off: make(() => OFF), lit: make((k) => LIT_LOW + (LIT_HIGH - LIT_LOW) * (k / top)), cap: make(() => 1) }
  }

  function led(levels: Float32Array, peaks: Float32Array, H: number) {
    if (!ctx || !sprites) return
    const segs = rows.y.length
    for (let i = 0; i < levels.length; i++) {
      const x = spans.x[i]
      const w = spans.w[i]
      ctx.drawImage(sprites.off, 0, 0, w, H, x, 0, w, H)
      const lit = litSegments(levels[i], segs)
      if (lit > 0) {
        const y0 = rows.y[lit - 1]
        ctx.drawImage(sprites.lit, 0, y0, w, H - y0, x, y0, w, H - y0)
      }
      const cap = capSegment(peaks[i], lit, segs)
      if (cap > 0) ctx.drawImage(sprites.cap, 0, rows.y[cap - 1], w, rows.h[cap - 1], x, rows.y[cap - 1], w, rows.h[cap - 1])
    }
  }

  function bars(levels: Float32Array, peaks: Float32Array, H: number) {
    if (!ctx) return
    ctx.fillStyle = ink
    ctx.globalAlpha = BAR
    for (let i = 0; i < levels.length; i++) {
      const bar = Math.round(Math.max(FLOOR, levels[i]) * H)
      if (look === 'mirror') ctx.fillRect(spans.x[i], Math.round((H - bar) / 2), spans.w[i], bar)
      else ctx.fillRect(spans.x[i], H - bar, spans.w[i], bar)
    }
    if (look === 'peaks') {
      ctx.globalAlpha = 1
      const cap = Math.max(2, Math.round(2 * dpr))
      for (let i = 0; i < levels.length; i++) ctx.fillRect(spans.x[i], Math.round(H - Math.max(FLOOR, peaks[i]) * H - cap), spans.w[i], cap)
    }
  }

  function wave(levels: Float32Array, W: number, H: number) {
    if (!ctx) return
    // Pad so the 2 px line is not clipped at the box's edges.
    const pad = Math.round(dpr)
    ctx.save()
    ctx.translate(0, pad)
    const fill = new Path2D(wavePath(levels, W, H - 2 * pad, true))
    ctx.fillStyle = ink
    ctx.globalAlpha = 0.22
    ctx.fill(fill)
    ctx.strokeStyle = ink
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 2 * dpr
    ctx.lineJoin = 'round'
    ctx.stroke(new Path2D(wavePath(levels, W, H - 2 * pad, false)))
    ctx.restore()
  }

  return {
    size(w: number, h: number, ratio: number) {
      cssW = w
      cssH = h
      dpr = ratio
      layout()
    },
    set(next: VisualizerStyle, calmer: boolean, color: string) {
      const restart = calmer !== calm
      look = next
      calm = calmer
      ink = color || '#888'
      if (restart) cols = 0
      layout()
    },
    frame: (l: ArrayLike<number>, r: ArrayLike<number>) => scene.frame(l, r),
    silence: () => scene.silence(),
    /** Draws a frame, `dt` seconds after the last. True = at rest (the caller may stop its loop). */
    draw(dt: number): boolean {
      if (!ctx || !cssW || !cssH) return true
      const { levels, peaks, resting } = scene.step(dt)
      const W = canvas.width
      const H = canvas.height
      ctx.globalAlpha = 1
      ctx.clearRect(0, 0, W, H)
      if (look === 'led') led(levels, peaks, H)
      else if (look === 'wave') wave(levels, W, H)
      else bars(levels, peaks, H)
      ctx.globalAlpha = 1
      return resting
    },
  }
}
