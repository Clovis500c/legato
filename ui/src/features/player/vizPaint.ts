import type { VisualizerStyle, VizBanding, VizColormap, VizFace, VizGradient, VizWeighting } from '../../shared/theme/theme'
import { capSegment, levelOf, litSegments } from './ledBars'
import { bandCount, DB_MARKS, FREQ_MARKS, framesFor, freqAt } from './vizBands'
import { createBeat } from './vizBeat'
import { columnSpans, columnsFor, dialGeometry, ledRows, ringBars, wavePath, type Dial, type LedRows, type Ring } from './vizDraw'
import { fillFor, type Stops } from './vizFill'
import { LOUD_MARKS, LOUD_WORDS, loudPos, loudText, type LoudReading, type LoudWords } from './vizLoud'
import { createParticles, moodOf } from './vizParticles'
import { createScene } from './vizScene'
import { monoWave, SPAN, trigger } from './vizScope'
import { advance, COLS, createTerrain, depthOf, fadeOf, flat, project, ROW_S, ROWS } from './vizTerrain'
import { colorMap, fillColumn, namedMap, rowMix, SCROLL, SCROLL_CALM, scrollBy } from './vizSpectro'
import { createVu, needleLook, ppmPos, PPM_MARKS, PPM_RED, vuPos, VU_MARKS } from './vizVu'
import { VIZ_WAVE } from './vizUnpack'
import { correlation, easeCorrelation, vectorPoints } from './vizVector'
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
/** Oscilloscope, Vectorscope: the phosphor's afterglow, s (what was drawn fades to a third in this long; three times it when calm). */
const GLOW_S = 0.05
/** Vectorscope: from this height (CSS px) the meter goes under the square, else beside it. */
const VECTOR_BIG_H = 120
/** The vintage dial: a warm cream lit from behind, its rim, black print, an old red. */
const VINTAGE = { face: '#f3e6c2', edge: '#dcc58e', glow: 'rgba(255, 190, 100, 0.5)', rim: '#2a241c', ink: '#1e1a13', red: '#b3342a' }
/** The vintage face's rim width, from its box. */
const rimOf = (w: number, h: number) => Math.max(1, Math.round(Math.min(w, h) * 0.03))
/** Radial: how much the ring steps out on a kick (of its radius), and how fast it settles (s). */
const KICK_GROW = 0.04
const KICK_S = 0.12
/** Particles: a dot's sprite (px), and how fast the drawing follows the frames' mids and level (s). */
const DOT = 32
const MOOD_S = 0.15

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
  let skin: VizFace = 'theme'
  let vu = createVu(false)
  let ring: Ring = ringBars(1, 1)
  let dial: Dial = dialGeometry(1, 1)
  let dialMap: OffscreenCanvas | null = null
  let strip: { img: ImageData; px: Uint32Array; mix: ReturnType<typeof rowMix> } | null = null
  let map = colorMap()
  // Whose map that is: the theme's ink or a named one; null = make it again.
  let tones: VizColormap | null = null
  const acc = { v: 0 }
  let scene = createScene(columnsFor(0), false)
  let land = createTerrain()
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
  // Oscilloscope, Vectorscope: the newest wave blocks (none while nothing sounds), the scope's one side, the points.
  const waveL = new Float32Array(VIZ_WAVE)
  const waveR = new Float32Array(VIZ_WAVE)
  const scopeWave = new Float32Array(VIZ_WAVE)
  const points = new Float32Array(2 * VIZ_WAVE)
  let hasWave = false
  // Vectorscope: the square its points fade in, and the correlation, as measured and as shown.
  let trail: OffscreenCanvas | null = null
  let corrNow: number | null = null
  let corrShown = 0
  // Beats (vizBeat.ts): both sides' bands as one, and the last kick (1 on it, settling).
  const beat = createBeat()
  let both = new Float32Array(0)
  let kick = 0
  // Particles (vizParticles.ts): their colours (none: the ink) as soft sprites, light that adds up on a dark theme, the
  // strongest kick not drawn yet, the frames' mood and the drawing's (eased), and a clock for the swirl and the bursts.
  const parts = createParticles()
  let partColors: string[] = []
  let glow = true
  let dots: OffscreenCanvas[] = []
  let burstNow = 0
  let mood = { mids: 0, level: 0 }
  const moodShown = { mids: 0, level: 0 }
  let clock = 0

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
    if (look === 'particles') parts.size(cssW, cssH)
    dialMap = null
    if (needleLook(look)) {
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

  /**
   * The dial's face, drawn once: the scale's arc, its marks and numbers, the red end (VU from 0 VU, PPM near full scale),
   * the unit when there is room; the vintage one on its lit cream. Needles and LEDs go over it.
   */
  function makeDial(w: number, h: number): OffscreenCanvas {
    const face = new OffscreenCanvas(w, h)
    const c = face.getContext('2d')!
    const d = dial
    const ppm = look === 'ppm'
    const pos = ppm ? ppmPos : vuPos
    const vintage = skin === 'vintage'
    const print = vintage ? VINTAGE.ink : ink
    if (vintage) {
      const round = Math.min(w, h) * 0.08
      const rim = rimOf(w, h)
      c.fillStyle = VINTAGE.rim
      c.beginPath()
      c.roundRect(0, 0, w, h, round)
      c.fill()
      const paper = c.createLinearGradient(0, 0, 0, h)
      paper.addColorStop(0, VINTAGE.face)
      paper.addColorStop(1, VINTAGE.edge)
      c.fillStyle = paper
      c.beginPath()
      c.roundRect(rim, rim, w - 2 * rim, h - 2 * rim, Math.max(0, round - rim))
      c.fill()
      // The lamp behind, low in the middle.
      const lamp = c.createRadialGradient(w / 2, h * 0.8, 0, w / 2, h * 0.8, Math.max(w, h) * 0.6)
      lamp.addColorStop(0, VINTAGE.glow)
      lamp.addColorStop(1, 'rgba(255, 190, 100, 0)')
      c.fillStyle = lamp
      c.fillRect(rim, rim, w - 2 * rim, h - 2 * rim)
    }
    const at = (p: number, r: number) => {
      const a = d.swing * (2 * p - 1)
      return [d.px + r * Math.sin(a), d.py - r * Math.cos(a)] as const
    }
    // Sizes from the dial, not the box: a full screen's box is far taller than its dial.
    const tick = Math.max(3 * dpr, Math.min(h * 0.07, d.r * 0.09))
    const arc = (from: number, to: number) => {
      c.beginPath()
      c.arc(d.px, d.py, d.r, -Math.PI / 2 + d.swing * (2 * from - 1), -Math.PI / 2 + d.swing * (2 * to - 1))
    }
    const red = pos(ppm ? PPM_RED : 0)
    c.lineCap = 'butt'
    c.strokeStyle = print
    c.globalAlpha = vintage ? 0.85 : 0.55
    c.lineWidth = Math.max(1, dpr)
    arc(0, red)
    c.stroke()
    // The red end: to the scale's last mark.
    c.strokeStyle = vintage ? VINTAGE.red : warn
    c.globalAlpha = 0.9
    c.lineWidth = Math.max(2 * dpr, tick * 0.6)
    arc(red, 1)
    c.stroke()
    c.strokeStyle = print
    c.lineWidth = Math.max(1, dpr)
    const big = h >= 70 * dpr
    c.fillStyle = print
    c.font = `${Math.round(Math.min(h * 0.065, d.r * 0.11))}px system-ui, sans-serif`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    // Numbers as on a real dial: VU's without their minus, the red ones with a plus; the PPM's dB under full scale.
    for (const mark of ppm ? PPM_MARKS : VU_MARKS) {
      const p = pos(mark)
      const [x0, y0] = at(p, d.r)
      const [x1, y1] = at(p, d.r - tick)
      c.globalAlpha = 0.7
      c.beginPath()
      c.moveTo(x0, y0)
      c.lineTo(x1, y1)
      c.stroke()
      if (big) {
        const [tx, ty] = at(p, d.r - tick * 2.4)
        c.globalAlpha = vintage ? 0.85 : 0.6
        c.fillText(mark > 0 ? `+${mark}` : String(-mark), tx, ty)
      }
    }
    // The unit between the numbers and the pivot.
    const unitY = d.py - d.r * 0.42
    if (big && unitY < h) {
      c.globalAlpha = vintage ? 0.75 : 0.45
      c.font = `${Math.round(Math.min(h * 0.08, d.r * 0.13))}px system-ui, sans-serif`
      c.fillText(ppm ? 'dBFS' : 'VU', d.px, unitY)
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
    // A kick: the ring steps out a little and settles (not when calm).
    const r0 = ring.r0 * (calm ? 1 : 1 + KICK_GROW * kick) + lw / 2
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

  /** A soft dot per colour: nearly full to half its radius, gone at the edge. */
  function makeDots(): OffscreenCanvas[] {
    return (partColors.length ? partColors : [ink]).map((color) => {
      const c = new OffscreenCanvas(DOT, DOT)
      const g = c.getContext('2d')
      if (!g) return c
      const [r, gr, b] = rgbOf(color)
      const shade = g.createRadialGradient(DOT / 2, DOT / 2, 0, DOT / 2, DOT / 2, DOT / 2)
      shade.addColorStop(0, `rgba(${r},${gr},${b},0.95)`)
      shade.addColorStop(0.5, `rgba(${r},${gr},${b},0.7)`)
      shade.addColorStop(1, `rgba(${r},${gr},${b},0)`)
      g.fillStyle = shade
      g.fillRect(0, 0, DOT, DOT)
      return c
    })
  }

  /** Particles: a burst on the last kick (none when calm), the trickle, the drift, then every dot. True = none left. */
  function particles(W: number, H: number, dt: number): boolean {
    if (!ctx) return true
    ctx.clearRect(0, 0, W, H)
    clock += dt
    const ease = 1 - Math.exp(-dt / MOOD_S)
    moodShown.mids += (mood.mids - moodShown.mids) * ease
    moodShown.level += (mood.level - moodShown.level) * ease
    if (!dots.length) dots = makeDots()
    if (burstNow > 0 && !calm) parts.burst(clock, burstNow, dots.length)
    burstNow = 0
    // Calm: fewer dots, slower.
    parts.trickle(dt, moodShown.level * (calm ? 0.5 : 1), dots.length)
    parts.step(dt, moodShown.mids * (calm ? 0.4 : 1), clock)
    ctx.globalCompositeOperation = glow ? 'lighter' : 'source-over'
    parts.each((x, y, size, alpha, color) => {
      const d = size * dpr
      ctx.globalAlpha = alpha
      ctx.drawImage(dots[color] ?? dots[0], x * dpr - d / 2, y * dpr - d / 2, d, d)
    })
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    return parts.count === 0
  }

  /** Two needle meters. True = at rest. */
  function needles(dt: number): boolean {
    if (!ctx || !dialMap) return true
    const { pos, on, resting } = vu.step(dt)
    const m = meterBox()
    const d = dial
    const lw = Math.max(1.5 * dpr, Math.min(m.h * 0.012, d.r * 0.02))
    const led = Math.max(2.5 * dpr, Math.min(m.h * 0.035, d.r * 0.06))
    // The LED in the box's corner, inside the vintage rim; by the dial's top when the dial sits in a tall box's middle.
    const inset = skin === 'vintage' ? rimOf(m.w, m.h) : 0
    const ledX = m.w - led * 2 - inset
    const ledY = d.py - d.r > m.h * 0.2 + 1 ? d.py - d.r : led * 2 + inset
    for (let k = 0; k < 2; k++) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(k * (m.w + m.gap), 0, m.w, m.h)
      ctx.clip()
      ctx.translate(k * (m.w + m.gap), 0)
      ctx.globalAlpha = 1
      ctx.drawImage(dialMap, 0, 0)
      const a = d.swing * (2 * Math.min(1.04, Math.max(0, pos[k])) - 1)
      const print = skin === 'vintage' ? VINTAGE.ink : ink
      ctx.strokeStyle = print
      ctx.fillStyle = print
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
      ctx.arc(ledX, ledY, led, 0, Math.PI * 2)
      ctx.fillStyle = on[k] ? (skin === 'vintage' ? VINTAGE.red : warn) : print
      ctx.globalAlpha = on[k] ? 1 : 0.15
      ctx.fill()
      ctx.restore()
    }
    return resting
  }

  /** The terrain, back to front: each row clears what its hills hide, then a faint body and its line. */
  function terrain(levels: Float32Array, W: number, H: number, dt: number, resting: boolean): boolean {
    if (!ctx) return true
    const step = calm ? ROW_S * 2 : ROW_S
    advance(land, levels, dt, step)
    ctx.clearRect(0, 0, W, H)
    const frac = land.since / step
    // A low box (the strip): every other row, the same ones as they go back, so the lines stay apart.
    const skip = H < 160 * dpr ? 2 : 1
    ctx.lineWidth = Math.max(1, 1.2 * dpr)
    ctx.lineJoin = 'round'
    ctx.strokeStyle = ink
    ctx.fillStyle = ink
    for (let k = ROWS - 1; k >= 0; k--) {
      const i = (land.head - k + ROWS) % ROWS
      const row = land.rows[i]
      const a = fadeOf(depthOf(k, frac))
      if (i % skip || a <= 0 || row.every((v) => v < 0.002)) continue
      const { y, half, lift } = project(depthOf(k, frac), W, H)
      const x0 = W / 2 - half
      const dx = (2 * half) / (COLS - 1)
      ctx.beginPath()
      ctx.moveTo(x0, y)
      for (let j = 0; j < COLS; j++) ctx.lineTo(x0 + j * dx, y - row[j] * lift)
      ctx.lineTo(x0 + 2 * half, y)
      ctx.closePath()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.globalAlpha = 1
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 0.08 * a
      ctx.fill()
      ctx.beginPath()
      for (let j = 0; j < COLS; j++) ctx.lineTo(x0 + j * dx, y - row[j] * lift)
      ctx.globalAlpha = a
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    return resting && flat(land)
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

  /** A phosphor's afterglow: what `c` holds fades, its alpha cut by the time passed (never cleared). */
  function afterglow(c: OffscreenCanvasRenderingContext2D, w: number, h: number, dt: number) {
    c.globalCompositeOperation = 'destination-out'
    c.globalAlpha = 1 - Math.exp(-dt / (calm ? 3 * GLOW_S : GLOW_S))
    c.fillStyle = '#000'
    c.fillRect(0, 0, w, h)
    c.globalCompositeOperation = 'source-over'
    c.globalAlpha = 1
  }

  /**
   * Oscilloscope: the newest wave block from its trigger (vizScope.ts), `SPAN` samples across the box, full scale at the
   * edges, over the pictures before fading out (a phosphor's afterglow: their alpha cut each frame, never cleared).
   */
  function scope(W: number, H: number, dt: number, resting: boolean) {
    if (!ctx) return
    afterglow(ctx, W, H, dt)
    // Nothing sounds: the glow fades, and its last 8-bit traces (a fade never takes them) go once at rest.
    if (!hasWave) {
      if (resting) ctx.clearRect(0, 0, W, H)
      return
    }
    const wave = monoWave(waveL, waveR, scopeWave)
    const from = trigger(wave)
    const mid = H / 2
    const amp = mid * 0.95
    ctx.beginPath()
    for (let i = 0; i < SPAN; i++) {
      const x = (i / (SPAN - 1)) * W
      const y = mid - wave[from + i] * amp
      if (i) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
    }
    ctx.lineWidth = Math.max(1, 1.5 * dpr)
    ctx.lineJoin = 'round'
    ctx.strokeStyle = ink
    ctx.stroke()
  }

  /** Vectorscope: its square and the correlation meter, device px: the meter under the square, beside it when short. */
  function vectorBox(W: number, H: number) {
    const bar = Math.max(2, Math.round(4 * dpr))
    const gap = Math.round(12 * dpr)
    if (cssH < VECTOR_BIG_H) {
      const s = Math.min(W, H)
      return { s, x: 0, y: Math.round((H - s) / 2), meter: { x: s + gap, y: Math.round((H - bar) / 2), w: W - s - gap, h: bar } }
    }
    const s = Math.max(0, Math.min(W, H - bar - gap))
    const x = Math.round((W - s) / 2)
    const y = Math.round((H - bar - gap - s) / 2)
    return { s, x, y, meter: { x, y: y + s + gap, w: s, h: bar } }
  }

  /**
   * Vectorscope (goniometer): the wave blocks as points, mid up and side across (vizVector.ts), in a square whose
   * diamond is full scale, fading like the scope's trace but in a canvas of their own (the guides and the meter stay
   * crisp). The correlation meter: −1 to +1 from the middle, in the alarm colour below 0 (a mono mix loses that sound).
   */
  function vectorscope(W: number, H: number, dt: number, resting: boolean) {
    if (!ctx) return
    const { s, x, y, meter } = vectorBox(W, H)
    ctx.clearRect(0, 0, W, H)
    if (s < 2) return
    if (!trail || trail.width !== s) trail = new OffscreenCanvas(s, s)
    const t = trail.getContext('2d')
    if (!t) return
    afterglow(t, s, s, dt)
    if (hasWave) {
      const half = s / 2
      const d = Math.max(1, Math.round(1.5 * dpr))
      vectorPoints(waveL, waveR, points)
      t.globalAlpha = 0.6
      t.fillStyle = ink
      t.beginPath()
      for (let i = 0; i < points.length; i += 2) t.rect(half + points[i] * half - d / 2, half - points[i + 1] * half - d / 2, d, d)
      t.fill()
      t.globalAlpha = 1
    } else if (resting) t.clearRect(0, 0, s, s)
    corrShown = easeCorrelation(corrShown, hasWave ? corrNow : null, dt)
    // The guides, faint: the diamond, mid and side, left and right.
    const cx = x + s / 2
    const cy = y + s / 2
    const q = s / 4
    ctx.globalAlpha = 0.18
    ctx.strokeStyle = ink
    ctx.lineWidth = Math.max(1, dpr)
    ctx.beginPath()
    ctx.moveTo(cx, y)
    ctx.lineTo(x + s, cy)
    ctx.lineTo(cx, y + s)
    ctx.lineTo(x, cy)
    ctx.closePath()
    ctx.moveTo(cx, y)
    ctx.lineTo(cx, y + s)
    ctx.moveTo(x, cy)
    ctx.lineTo(x + s, cy)
    ctx.moveTo(cx - q, cy - q)
    ctx.lineTo(cx + q, cy + q)
    ctx.moveTo(cx + q, cy - q)
    ctx.lineTo(cx - q, cy + q)
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.drawImage(trail, x, y)
    // The meter: its track, the reading from the middle, a tick at 0.
    if (meter.w < 4) return
    const zero = meter.x + meter.w / 2
    const at = zero + corrShown * (meter.w / 2)
    ctx.fillStyle = ink
    ctx.globalAlpha = 0.15
    ctx.fillRect(meter.x, meter.y, meter.w, meter.h)
    ctx.globalAlpha = 1
    ctx.fillStyle = corrShown < 0 ? warn : ink
    ctx.fillRect(Math.min(zero, at), meter.y, Math.abs(at - zero), meter.h)
    const tick = Math.max(1, Math.round(dpr))
    const reach = Math.round(3 * dpr)
    ctx.globalAlpha = 0.5
    ctx.fillStyle = ink
    ctx.fillRect(Math.round(zero - tick / 2), meter.y - reach, tick, meter.h + 2 * reach)
    ctx.globalAlpha = 1
  }

  return {
    size(w: number, h: number, ratio: number) {
      cssW = w
      cssH = h
      dpr = ratio
      layout()
    },
    set(next: VisualizerStyle, calmer: boolean, color: string, alarm = WARN, weigh: VizWeighting = 'flat', grad: VizGradient = 'none', colors: Stops = [], bands: VizBanding = 'sixth', glossy = false, second = '', said: LoudWords = LOUD_WORDS, dialFace: VizFace = 'theme', palette: VizColormap = 'theme') {
      words = said
      skin = dialFace
      // VU and PPM needles move by other rules: new ones when the look changes between them.
      const otherNeedles = (next === 'ppm') !== (look === 'ppm')
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
      // Back to the Oscilloscope or the Vectorscope: no stale trace before their frames come.
      if (next !== look) {
        hasWave = false
        corrNow = null
        corrShown = 0
        trail = null
        parts.clear()
        burstNow = 0
        land = createTerrain()
      }
      look = next
      calm = calmer
      if ((color || '#888') !== ink || !inkRgb) {
        ink = color || '#888'
        inkRgb = rgbOf(ink)
        dots = []
        tones = null
      }
      if (palette !== tones) {
        tones = palette
        map = palette === 'theme' ? colorMap(inkRgb) : namedMap(palette)
      }
      warn = alarm || WARN
      if (restart) cols = 0
      if (restart || otherNeedles) vu = createVu(calm, look === 'ppm')
      layout()
    },
    frame(l: ArrayLike<number>, r: ArrayLike<number>, rms: ArrayLike<number>, w?: [ArrayLike<number>, ArrayLike<number>], peak: ArrayLike<number> = rms) {
      // A frame without its wave blocks (a stream starting again, the silence after a stop): no trace.
      if (both.length !== l.length) both = new Float32Array(l.length)
      for (let i = 0; i < l.length; i++) both[i] = (l[i] + r[i]) / 2
      const onset = beat.push(both, performance.now() / 1000)
      if (onset.onset) {
        kick = 1
        burstNow = Math.max(burstNow, onset.strength)
      }
      if (look === 'particles') mood = moodOf(both, rms)
      hasWave = w !== undefined
      if (w) {
        waveL.set(w[0])
        waveR.set(w[1])
        if (look === 'vectorscope') corrNow = correlation(waveL, waveR)
      }
      if (needleLook(look)) vu.frame(rms, peak)
      else if (sceneR) {
        // Curve: each side on its own.
        scene.frame(l, l)
        sceneR.frame(r, r)
      } else scene.frame(l, r)
    },
    silence() {
      // A pause breaks the beat's history: it starts over.
      beat.reset()
      kick = 0
      burstNow = 0
      mood = { mids: 0, level: 0 }
      hasWave = false
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
    /** The particles' colours (none: the ink) and whether their light adds up. */
    palette(colors: string[], adds: boolean) {
      partColors = colors
      glow = adds
      dots = []
    },
    /** Draws a frame, `dt` seconds after the last. True = at rest (the caller may stop its loop). */
    draw(dt: number): boolean {
      if (!ctx || !cssW || !cssH) return true
      kick *= Math.exp(-dt / KICK_S)
      if (needleLook(look)) {
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
      if (look === 'terrain') return terrain(levels, W, H, dt, resting)
      // The dots keep moving through a pause until they fade: at rest when none are left.
      if (look === 'particles') return particles(W, H, dt)
      // The traces over their afterglow, while the bars fall (no reflection, no scales: no bands).
      if (look === 'scope') {
        scope(W, H, dt, resting)
        return resting
      }
      if (look === 'vectorscope') {
        vectorscope(W, H, dt, resting)
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
