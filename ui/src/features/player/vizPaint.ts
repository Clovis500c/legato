import type { VisualizerStyle } from '../../shared/theme/theme'
import { capSegment, litSegments } from './ledBars'
import { columnSpans, columnsFor, dialGeometry, ledRows, ringBars, wavePath, type Dial, type LedRows, type Ring } from './vizDraw'
import { createScene } from './vizScene'
import { colorMap, fillColumn, rowMix, SCROLL, SCROLL_CALM, scrollBy } from './vizSpectro'
import { createVu, vuPos, VU_MARKS } from './vizVu'

/** Lowest bar, as a fraction of the box (a bar never vanishes). */
const FLOOR = 0.04
/** Opacity of the ink: LED segments off, lit (rising with height), cap; plain bars; the wave's fill and line. */
const OFF = 0.09
const LIT_LOW = 0.55
const LIT_HIGH = 0.95
const BAR = 0.85

/** The VU dial's alarm colour when the caller sends none (the theme's danger red). */
const WARN = '#d93a2b'

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
  let inkRgb: [number, number, number] | null = null
  let warn = WARN
  let vu = createVu(false)
  let ring: Ring = ringBars(1, 1)
  let dial: Dial = dialGeometry(1, 1)
  let dialMap: OffscreenCanvas | null = null
  let strip: { img: ImageData; px: Uint32Array; mix: ReturnType<typeof rowMix> } | null = null
  let map = colorMap()
  const acc = { v: 0 }
  let scene = createScene(columnsFor(0), false)
  let rows: LedRows = { y: [], h: [] }
  let sprites: Sprites | null = null
  let spans = columnSpans(1, 1, 0)
  let cols = 0

  /** A CSS colour as [r, g, b] (the canvas parses it). */
  function rgbOf(color: string): [number, number, number] {
    const one = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })
    if (!one) return [128, 128, 128]
    one.fillStyle = '#808080'
    one.fillStyle = color
    one.fillRect(0, 0, 1, 1)
    const d = one.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2]]
  }

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
    if (look === 'radial') ring = ringBars(Math.min(w, h), n)
    dialMap = null
    if (look === 'vu') {
      const m = meterBox()
      dial = dialGeometry(m.w, m.h)
      dialMap = makeDial(m.w, m.h)
    }
    strip = null
    if (look === 'spectrogram') {
      const img = new ImageData(1, h)
      strip = { img, px: new Uint32Array(img.data.buffer), mix: rowMix(h, n) }
    }
  }

  /** One needle meter's box, device px: the two sit side by side. */
  function meterBox() {
    const gap = Math.round(canvas.width * 0.03)
    return { w: Math.floor((canvas.width - gap) / 2), h: canvas.height, gap }
  }

  /** The dial's face, drawn once: the scale's arc, its marks and numbers, the red end. Needles and LEDs go over it. */
  function makeDial(w: number, h: number): OffscreenCanvas {
    const face = new OffscreenCanvas(w, h)
    const c = face.getContext('2d')!
    const d = dial
    const at = (p: number, r: number) => {
      const a = d.swing * (2 * p - 1)
      return [d.px + r * Math.sin(a), d.py - r * Math.cos(a)] as const
    }
    const tick = Math.max(3 * dpr, h * 0.07)
    const arc = (from: number, to: number) => {
      c.beginPath()
      c.arc(d.px, d.py, d.r, -Math.PI / 2 + d.swing * (2 * from - 1), -Math.PI / 2 + d.swing * (2 * to - 1))
    }
    c.lineCap = 'butt'
    c.strokeStyle = ink
    c.globalAlpha = 0.55
    c.lineWidth = Math.max(1, dpr)
    arc(0, vuPos(0))
    c.stroke()
    // The red end: from 0 VU to the scale's last mark.
    c.strokeStyle = warn
    c.globalAlpha = 0.9
    c.lineWidth = Math.max(2 * dpr, tick * 0.6)
    arc(vuPos(0), 1)
    c.stroke()
    c.strokeStyle = ink
    c.lineWidth = Math.max(1, dpr)
    const big = h >= 70 * dpr
    c.fillStyle = ink
    c.font = `${Math.round(h * 0.065)}px system-ui, sans-serif`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    for (const mark of VU_MARKS) {
      const p = vuPos(mark)
      const [x0, y0] = at(p, d.r)
      const [x1, y1] = at(p, d.r - tick)
      c.globalAlpha = 0.7
      c.beginPath()
      c.moveTo(x0, y0)
      c.lineTo(x1, y1)
      c.stroke()
      if (big) {
        const [tx, ty] = at(p, d.r - tick * 2.4)
        c.globalAlpha = 0.6
        c.fillText(mark > 0 ? `+${mark}` : String(-mark), tx, ty)
      }
    }
    return face
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

  /** The ring around the cover: bars start at the inner radius, mirrored left and right. */
  function radial(levels: Float32Array, W: number, H: number) {
    if (!ctx) return
    const n = levels.length
    const lw = Math.max(2 * dpr, ((ring.r0 * Math.PI) / (n * 2)) * 0.7)
    const room = ring.len - lw
    const cx = W / 2
    const cy = H / 2
    const r0 = ring.r0 + lw / 2
    ctx.strokeStyle = ink
    ctx.globalAlpha = BAR
    ctx.lineWidth = lw
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (let i = 0; i < n * 2; i++) {
      const to = r0 + Math.max(0, Math.max(FLOOR, levels[i % n]) * room)
      ctx.moveTo(cx + ring.dx[i] * r0, cy + ring.dy[i] * r0)
      ctx.lineTo(cx + ring.dx[i] * to, cy + ring.dy[i] * to)
    }
    ctx.stroke()
  }

  /** Two needle meters. True = at rest. */
  function needles(dt: number): boolean {
    if (!ctx || !dialMap) return true
    const { pos, on, resting } = vu.step(dt)
    const m = meterBox()
    const d = dial
    const lw = Math.max(1.5 * dpr, m.h * 0.012)
    const led = Math.max(2.5 * dpr, m.h * 0.035)
    for (let k = 0; k < 2; k++) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(k * (m.w + m.gap), 0, m.w, m.h)
      ctx.clip()
      ctx.translate(k * (m.w + m.gap), 0)
      ctx.globalAlpha = 1
      ctx.drawImage(dialMap, 0, 0)
      const a = d.swing * (2 * Math.min(1.04, Math.max(0, pos[k])) - 1)
      ctx.strokeStyle = ink
      ctx.fillStyle = ink
      ctx.globalAlpha = 0.95
      ctx.lineWidth = lw
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(d.px, d.py)
      ctx.lineTo(d.px + d.r * 1.01 * Math.sin(a), d.py - d.r * 1.01 * Math.cos(a))
      ctx.stroke()
      if (d.py < m.h) {
        ctx.beginPath()
        ctx.arc(d.px, d.py, lw * 2.2, 0, Math.PI * 2)
        ctx.fill()
      }
      // Peak LED, top right: the alarm colour when lit, a dim ink when not.
      ctx.beginPath()
      ctx.arc(m.w - led * 2, led * 2, led, 0, Math.PI * 2)
      ctx.fillStyle = on[k] ? warn : ink
      ctx.globalAlpha = on[k] ? 1 : 0.15
      ctx.fill()
      ctx.restore()
    }
    return resting
  }

  /** The picture moves left by the pixels due, a new column of colours at the right edge. */
  function waterfall(levels: Float32Array, dt: number) {
    if (!ctx || !strip) return
    const W = canvas.width
    const n = Math.min(W, scrollBy(acc, dt, calm ? SCROLL_CALM : SCROLL, dpr))
    if (n <= 0) return
    if (n < W) {
      ctx.globalCompositeOperation = 'copy'
      ctx.drawImage(canvas, n, 0, W - n, canvas.height, 0, 0, W - n, canvas.height)
      ctx.globalCompositeOperation = 'source-over'
    } else {
      ctx.clearRect(0, 0, W, canvas.height)
    }
    fillColumn(strip.px, levels, strip.mix, map)
    for (let x = W - n; x < W; x++) ctx.putImageData(strip.img, x, 0)
  }

  return {
    size(w: number, h: number, ratio: number) {
      cssW = w
      cssH = h
      dpr = ratio
      layout()
    },
    set(next: VisualizerStyle, calmer: boolean, color: string, alarm = WARN) {
      const restart = calmer !== calm
      // Another look: a clean canvas (the waterfall keeps its picture otherwise).
      if (next !== look && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
      look = next
      calm = calmer
      if ((color || '#888') !== ink || !inkRgb) {
        ink = color || '#888'
        inkRgb = rgbOf(ink)
        map = colorMap(inkRgb)
      }
      warn = alarm || WARN
      if (restart) {
        cols = 0
        vu = createVu(calm)
      }
      layout()
    },
    frame(l: ArrayLike<number>, r: ArrayLike<number>, rms: ArrayLike<number>) {
      if (look === 'vu') vu.frame(rms)
      else scene.frame(l, r)
    },
    silence() {
      scene.silence()
      vu.silence()
    },
    /** Draws a frame, `dt` seconds after the last. True = at rest (the caller may stop its loop). */
    draw(dt: number): boolean {
      if (!ctx || !cssW || !cssH) return true
      if (look === 'vu') {
        ctx.globalAlpha = 1
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        return needles(dt)
      }
      const { levels, peaks, resting } = scene.step(dt)
      const W = canvas.width
      const H = canvas.height
      ctx.globalAlpha = 1
      if (look === 'spectrogram') {
        waterfall(levels, dt)
        return resting
      }
      ctx.clearRect(0, 0, W, H)
      if (look === 'radial') radial(levels, W, H)
      else if (look === 'led') led(levels, peaks, H)
      else if (look === 'wave') wave(levels, W, H)
      else bars(levels, peaks, H)
      ctx.globalAlpha = 1
      return resting
    },
  }
}
