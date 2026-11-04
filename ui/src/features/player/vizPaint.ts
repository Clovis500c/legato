import type { VisualizerStyle, VizBanding, VizGradient, VizWeighting } from '../../shared/theme/theme'
import { capSegment, levelOf, litSegments } from './ledBars'
import { bandCount, DB_MARKS, FREQ_MARKS, framesFor, freqAt } from './vizBands'
import { columnSpans, columnsFor, dialGeometry, ledRows, ringBars, wavePath, type Dial, type LedRows, type Ring } from './vizDraw'
import { fillFor, type Stops } from './vizFill'
import { LOUD_MARKS, LOUD_WORDS, loudPos, loudText, type LoudReading, type LoudWords } from './vizLoud'
import { createScene } from './vizScene'
import { monoWave, SPAN, trigger } from './vizScope'
import { colorMap, fillColumn, rowMix, SCROLL, SCROLL_CALM, scrollBy } from './vizSpectro'
import { createVu, vuPos, VU_MARKS } from './vizVu'
import { VIZ_WAVE } from './vizUnpack'
import { weightsOf } from './vizWeigh'

/** Lowest bar, as a fraction of the box (a bar never vanishes). */
const FLOOR = 0.04
/** Opacity of the ink: LED segments off, lit (rising with height), cap; plain bars; the wave's fill and line. */
const OFF = 0.09
const LIT_LOW = 0.55
const LIT_HIGH = 0.95
const BAR = 0.85

/** The VU dial's alarm colour when the caller sends none (the theme's danger red). */
const WARN = '#d93a2b'

/** Glossy floor: the bars' share of the box (their reflection fades below), its opacity at the floor. */
const GROUND = 0.76
const SHINE = 0.4
/** Looks standing on the bottom edge: the floor reflects them. Looks along frequency: the scales on hover. */
const REFLECTED = new Set<VisualizerStyle>(['led', 'bars', 'peaks', 'wave', 'curve'])
const SCALED = new Set<VisualizerStyle>(['led', 'bars', 'peaks', 'mirror', 'wave', 'curve'])
/** Scales only in a box this tall, CSS px (the strip under the cover has no room). */
const SCALE_MIN_H = 120
/** The loudness meter in words, with the peak, its scale and the range, in a box this tall (CSS px); letters and three bars below. */
const LOUD_BIG_H = 120
/** Oscilloscope: the phosphor's afterglow, s (what was drawn fades to a third in this long; three times it when calm). */
const GLOW_S = 0.05

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
  let weighting: VizWeighting = 'flat'
  let weighs = weightsOf('flat')
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
  let gradient: VizGradient = 'none'
  let stops: Stops = []
  let fill: CanvasGradient | null = null
  let banding: VizBanding = 'sixth'
  let floor = false
  let hover = false
  // The bars' height, device px: the whole box, or above the floor.
  let barH = 0
  let fade: CanvasGradient | null = null
  // Curve: the right side's colour and heights (`scene` takes the left then).
  let ink2 = '#888'
  let sceneR: ReturnType<typeof createScene> | null = null
  // Loudness meter: its words and its latest numbers.
  let words: LoudWords = LOUD_WORDS
  let loudNow: LoudReading = { momentary: -120, short: -120, integrated: null, range: null, peak: -120, top: -120 }
  // Oscilloscope: the newest wave block, both sides as one; null while nothing sounds.
  const scopeWave = new Float32Array(VIZ_WAVE)
  let waveNow: Float32Array | null = null

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
    const n = columnsFor(cssW, bandCount(banding))
    if (n !== cols) {
      cols = n
      scene = createScene(n, calm, weighs, banding)
      sceneR = null
    }
    // Curve: the right side's own heights beside the left's.
    if (look !== 'curve') sceneR = null
    else if (!sceneR) sceneR = createScene(n, calm, weighs, banding)
    const gap = Math.max(1, Math.round((w / n) * 0.2))
    spans = columnSpans(w, n, gap)
    const reflects = floor && REFLECTED.has(look)
    barH = reflects ? Math.round(h * GROUND) : h
    fade = null
    if (reflects) {
      // Wipes the reflection out toward the bottom (destination-out): nothing at the floor, all of it at the edge.
      fade = ctx.createLinearGradient(0, barH, 0, h)
      fade.addColorStop(0, 'rgba(0,0,0,0)')
      fade.addColorStop(1, 'rgba(0,0,0,1)')
    }
    sprites = null
    if (look === 'led') {
      rows = ledRows(barH, dpr)
      sprites = makeSprites(Math.max(...spans.w), barH)
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
    fill = makeFill(w, barH)
  }

  /** The bars upside down below the floor, faint and fading: the box's top part copied flipped. */
  function reflect(W: number, H: number) {
    if (!ctx || !fade) return
    const r = H - barH
    ctx.save()
    ctx.globalAlpha = SHINE
    // y → 2·floor − y: the rows just above the floor land just below it.
    ctx.setTransform(1, 0, 0, -1, 0, 2 * barH)
    ctx.drawImage(canvas, 0, barH - r, W, r, 0, barH - r, W, r)
    ctx.restore()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = fade
    ctx.fillRect(0, barH, W, r)
    ctx.globalCompositeOperation = 'source-over'
  }

  /** Hover: the frequency marks along the top, the dB grid with its numbers on the right (not for the mirror). */
  function scales(W: number) {
    if (!ctx || !hover || cssH < SCALE_MIN_H || !SCALED.has(look)) return
    const size = Math.round(10 * dpr)
    ctx.save()
    ctx.fillStyle = ink
    ctx.strokeStyle = ink
    ctx.font = `${size}px system-ui, sans-serif`
    ctx.textBaseline = 'top'
    ctx.textAlign = 'center'
    ctx.globalAlpha = 0.7
    for (const [hz, label] of FREQ_MARKS) ctx.fillText(label, Math.round(freqAt(hz, banding) * W), Math.round(4 * dpr))
    if (look !== 'mirror') {
      ctx.textAlign = 'right'
      ctx.textBaseline = 'bottom'
      ctx.lineWidth = Math.max(1, Math.round(dpr))
      for (const db of DB_MARKS) {
        const y = Math.round(barH - levelOf(db) * barH) + 0.5
        ctx.globalAlpha = 0.18
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(W, y)
        ctx.stroke()
        ctx.globalAlpha = 0.7
        ctx.fillText(`−${-db} dB`, W - Math.round(4 * dpr), y - Math.round(2 * dpr))
      }
    }
    ctx.restore()
  }

  /** The gradient over the bars for this size and look; null = the one colour. */
  function makeFill(w: number, h: number): CanvasGradient | null {
    const f = fillFor(gradient, look, w, h, stops, ring)
    if (!ctx || !f) return null
    try {
      const g = f.kind === 'linear' ? ctx.createLinearGradient(f.x0, f.y0, f.x1, f.y1) : f.kind === 'radial' ? ctx.createRadialGradient(f.x, f.y, f.r0, f.x, f.y, f.r1) : ctx.createConicGradient(f.start, f.x, f.y)
      for (const [at, color] of f.stops) g.addColorStop(at, color)
      return g
    } catch {
      // A colour the canvas can't read: the bars keep theirs.
      return null
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

  /** Left and right as two smooth glowing lines, each area filled faintly: where they part is the stereo. */
  function curve(left: Float32Array, right: Float32Array, W: number, H: number) {
    if (!ctx) return
    const pad = Math.round(2 * dpr)
    ctx.save()
    ctx.translate(0, pad)
    const h = H - 2 * pad
    ctx.lineWidth = 2 * dpr
    ctx.lineJoin = 'round'
    for (const [levels, color] of [
      [right, ink2],
      [left, ink],
    ] as const) {
      ctx.shadowBlur = 0
      ctx.fillStyle = color
      ctx.globalAlpha = 0.12
      ctx.fill(new Path2D(wavePath(levels, W, h, true)))
      // The glow: none with reduced motion (a blur a frame is the costly part).
      ctx.shadowBlur = calm ? 0 : 8 * dpr
      ctx.shadowColor = color
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.95
      ctx.stroke(new Path2D(wavePath(levels, W, h, false)))
    }
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

  /**
   * The loudness meter: momentary, short-term and integrated as bars along one scale, their numbers at the right. A big
   * box says them in words and adds the peak (a mark at the song's highest), the scale and the loudness range.
   */
  function loudness(W: number, H: number) {
    if (!ctx) return
    const v = loudNow
    const big = cssH >= LOUD_BIG_H
    const rows: { label: string; value: number | null; bar: number | null; unit: string; held?: number; alarm?: boolean }[] = [
      { label: big ? words.momentary : 'M', value: v.momentary, bar: v.momentary, unit: 'LUFS' },
      { label: big ? words.short : 'S', value: v.short, bar: v.short, unit: 'LUFS' },
      { label: big ? words.integrated : 'I', value: v.integrated, bar: v.integrated, unit: 'LUFS' },
    ]
    // Over -1 dBTP (EBU R128's ceiling): the song's highest in the alarm colour.
    if (big) rows.push({ label: words.peak, value: v.top, bar: v.peak, unit: 'dBTP', held: v.top, alarm: v.top > -1 })
    const n = rows.length
    // Small: the box shared by three rows. Big: rows of a readable size, centred, the scale and the range under them.
    const gap = big ? 0 : Math.max(1, Math.round(2 * dpr))
    const rowH = big ? Math.min(Math.round(44 * dpr), Math.floor(H / (n * 1.6 + 2.6))) : Math.floor((H - (n - 1) * gap) / n)
    const step = big ? Math.round(rowH * 1.6) : rowH + gap
    const font = Math.round(rowH * (big ? 0.42 : 0.72))
    const text = font >= 9 * dpr
    const pad = Math.round(8 * dpr)
    const width = big ? Math.min(W - 2 * pad, Math.round(960 * dpr)) : W
    const left = Math.round((W - width) / 2)
    const right = left + width
    ctx.font = `${font}px system-ui, sans-serif`
    // A number with its unit in a big box; a dash alone.
    const say = (value: number | null, unit: string) => {
      const t = loudText(value)
      return big && t !== '—' ? `${t} ${unit}` : t
    }
    const labelW = text ? Math.max(...rows.map((r) => ctx.measureText(r.label).width)) + font * 0.8 : 0
    const valueW = text ? Math.max(...(big ? ['−88.8 LUFS', '−88.8 dBTP'] : ['−88.8']).map((t) => ctx.measureText(t).width)) + font * 0.8 : 0
    const x0 = Math.round(left + labelW)
    const barW = Math.max(1, Math.round(right - valueW - x0))
    const top = big ? Math.round((H - (step * (n - 1) + rowH + font * 4.2)) / 2) : 0
    const r = Math.min(rowH / 2, 3 * dpr)
    ctx.fillStyle = ink
    ctx.strokeStyle = ink
    ctx.textBaseline = 'middle'
    rows.forEach((row, i) => {
      const y = top + i * step
      ctx.globalAlpha = OFF
      ctx.beginPath()
      ctx.roundRect(x0, y, barW, rowH, r)
      ctx.fill()
      const w = Math.round(loudPos(row.bar) * barW)
      if (w > 0) {
        ctx.globalAlpha = BAR
        ctx.beginPath()
        ctx.roundRect(x0, y, w, rowH, Math.min(r, w / 2))
        ctx.fill()
      }
      if (row.held !== undefined && row.held > -120) {
        const lw = Math.max(2, Math.round(2 * dpr))
        ctx.globalAlpha = 1
        if (row.alarm) ctx.fillStyle = warn
        ctx.fillRect(Math.round(x0 + loudPos(row.held) * (barW - lw)), y, lw, rowH)
        ctx.fillStyle = ink
      }
      if (text) {
        ctx.textAlign = 'left'
        ctx.globalAlpha = 0.7
        ctx.fillText(row.label, left, y + rowH / 2)
        ctx.textAlign = 'right'
        ctx.globalAlpha = 0.95
        if (row.alarm) ctx.fillStyle = warn
        ctx.fillText(say(row.value, row.unit), right, y + rowH / 2)
      }
      ctx.fillStyle = ink
    })
    if (!big) return
    // The scale under the bars, every 6 dB, numbered every 12; then the range.
    const y = top + step * (n - 1) + rowH + Math.round(font * 0.6)
    const tick = Math.round(font * 0.4)
    const small = Math.round(font * 0.8)
    ctx.font = `${small}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const mark of LOUD_MARKS) {
      const x = Math.round(x0 + loudPos(mark) * (barW - 1))
      ctx.globalAlpha = 0.45
      ctx.fillRect(x, y, Math.max(1, Math.round(dpr)), tick)
      if (mark % 12) continue
      ctx.globalAlpha = 0.6
      ctx.fillText(mark ? `−${-mark}` : '0', x, y + tick + Math.round(2 * dpr))
    }
    ctx.font = `${font}px system-ui, sans-serif`
    ctx.textAlign = 'left'
    ctx.globalAlpha = 0.85
    ctx.fillText(`${words.range}  ${say(v.range, 'LU')}`, left, y + tick + small + Math.round(font * 0.9))
  }

  /**
   * Oscilloscope: the newest wave block from its trigger (vizScope.ts), `SPAN` samples across the box, full scale at the
   * edges, over the pictures before fading out (a phosphor's afterglow: their alpha cut each frame, never cleared).
   */
  function scope(W: number, H: number, dt: number, resting: boolean) {
    if (!ctx) return
    ctx.globalCompositeOperation = 'destination-out'
    ctx.globalAlpha = 1 - Math.exp(-dt / (calm ? 3 * GLOW_S : GLOW_S))
    ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    // Nothing sounds: the glow fades, and its last 8-bit traces (a fade never takes them) go once at rest.
    if (!waveNow) {
      if (resting) ctx.clearRect(0, 0, W, H)
      return
    }
    const from = trigger(waveNow)
    const mid = H / 2
    const amp = mid * 0.95
    ctx.beginPath()
    for (let i = 0; i < SPAN; i++) {
      const x = (i / (SPAN - 1)) * W
      const y = mid - waveNow[from + i] * amp
      if (i) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
    }
    ctx.lineWidth = Math.max(1, 1.5 * dpr)
    ctx.lineJoin = 'round'
    ctx.strokeStyle = ink
    ctx.stroke()
  }

  return {
    size(w: number, h: number, ratio: number) {
      cssW = w
      cssH = h
      dpr = ratio
      layout()
    },
    set(next: VisualizerStyle, calmer: boolean, color: string, alarm = WARN, weigh: VizWeighting = 'flat', grad: VizGradient = 'none', colors: Stops = [], bands: VizBanding = 'sixth', glossy = false, second = '', said: LoudWords = LOUD_WORDS) {
      words = said
      gradient = grad
      stops = colors
      floor = glossy
      ink2 = second || color || '#888'
      // Reduced motion, the weighting or the bands changed: a new scene (and needles).
      const restart = calmer !== calm || weigh !== weighting || bands !== banding
      weighting = weigh
      banding = bands
      weighs = weightsOf(weigh, framesFor(bands))
      // Another look: a clean canvas (the waterfall keeps its picture otherwise).
      if (next !== look && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
      // Back to the Oscilloscope: no stale trace before its frames come.
      if (next !== look) waveNow = null
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
    frame(l: ArrayLike<number>, r: ArrayLike<number>, rms: ArrayLike<number>, w?: [ArrayLike<number>, ArrayLike<number>]) {
      // A frame without its wave blocks (a stream starting again, the silence after a stop): no trace.
      waveNow = w ? monoWave(w[0], w[1], scopeWave) : null
      if (look === 'vu') vu.frame(rms)
      else if (sceneR) {
        // Curve: each side on its own.
        scene.frame(l, l)
        sceneR.frame(r, r)
      } else scene.frame(l, r)
    },
    silence() {
      waveNow = null
      scene.silence()
      sceneR?.silence()
      vu.silence()
    },
    /** The pointer over the visualizer: its scales shown. */
    hover(on: boolean) {
      hover = on
    },
    /** The loudness meter's numbers. */
    loud(v: LoudReading) {
      loudNow = v
    },
    /** Draws a frame, `dt` seconds after the last. True = at rest (the caller may stop its loop). */
    draw(dt: number): boolean {
      if (!ctx || !cssW || !cssH) return true
      if (look === 'vu') {
        ctx.globalAlpha = 1
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        return needles(dt)
      }
      // The meter moves with its numbers only: one picture per update, then at rest.
      if (look === 'loudness') {
        ctx.globalAlpha = 1
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        loudness(canvas.width, canvas.height)
        return true
      }
      const { levels, peaks, resting: restingL } = scene.step(dt)
      // Curve: the right side's heights too, at rest only when both are.
      const right = sceneR?.step(dt)
      const resting = restingL && (right?.resting ?? true)
      const W = canvas.width
      const H = canvas.height
      ctx.globalAlpha = 1
      if (look === 'spectrogram') {
        waterfall(levels, dt)
        return resting
      }
      // The trace over its afterglow, while the bars fall (no reflection, no scales: no bands).
      if (look === 'scope') {
        scope(W, H, dt, resting)
        return resting
      }
      ctx.clearRect(0, 0, W, H)
      // Standing on the floor when there is one (barH < H): the bars' box is above it.
      if (look === 'radial') radial(levels, W, H)
      else if (look === 'led') led(levels, peaks, barH)
      else if (look === 'wave') wave(levels, W, barH)
      else if (look === 'curve' && right) curve(levels, right.levels, W, barH)
      else bars(levels, peaks, barH)
      ctx.globalAlpha = 1
      // The gradient takes the bars' place, their shapes and opacities kept.
      if (fill) {
        ctx.globalCompositeOperation = 'source-atop'
        ctx.fillStyle = fill
        ctx.fillRect(0, 0, W, H)
        ctx.globalCompositeOperation = 'source-over'
      }
      reflect(W, H)
      scales(W)
      return resting
    },
  }
}
