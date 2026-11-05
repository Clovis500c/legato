import { bandHz } from './vizUnpack'
import { compile, MAX_SOURCE } from './vizExpr'

/**
 * The Presets look's engine (docs/playback.md › Presets), pure: MilkDrop's ideas, written from scratch. A preset is
 * starting values and three programs (vizExpr.ts) sharing their variables: `init` once, `frame` every frame (the
 * motion, the wave and the borders from the music), `vertex` at every point of a mesh over the picture (the motion
 * bent by place). The renderer (vizPresetGl.ts) draws the last picture again through the mesh, faded, then the wave
 * and the borders on top: the trails are the old pictures.
 */

/** What the engine gives the equations (time, the music, the point), then what it reads back from them. */
export const VARS = [
  'time', 'fps', 'frame', 'bass', 'mid', 'treb', 'bass_att', 'mid_att', 'treb_att', 'beat', 'bpm',
  'aspectx', 'aspecty', 'meshx', 'meshy', 'x', 'y', 'rad', 'ang',
  'zoom', 'zoomexp', 'rot', 'warp', 'warp_speed', 'warp_scale', 'cx', 'cy', 'dx', 'dy', 'sx', 'sy', 'decay',
  'wave_mode', 'wave_r', 'wave_g', 'wave_b', 'wave_a', 'wave_x', 'wave_y', 'wave_scale', 'wave_smoothing',
  'wave_mystery', 'wave_thick', 'wave_usedots', 'wave_additive', 'wave_brighten',
  'ob_size', 'ob_r', 'ob_g', 'ob_b', 'ob_a', 'ib_size', 'ib_r', 'ib_g', 'ib_b', 'ib_a',
  'gamma', 'echo_zoom', 'echo_alpha', 'echo_orient', 'darken_center', 'invert', 'brighten', 'darken', 'solarize', 'wrap',
] as const
export type PresetVar = (typeof VARS)[number]
const I = Object.fromEntries(VARS.map((n, i) => [n, i])) as Record<PresetVar, number>

/**
 * The values a preset may start from (MilkDrop's defaults where it has them), set again before every frame; the
 * equations' own variables keep theirs. zoom > 1 grows the picture, rot > 0 turns it counter-clockwise (radians a
 * 60th of a second), dx > 0 moves it right, dy > 0 down (the box's shares), decay is what stays of it.
 */
export const BASE: Partial<Record<PresetVar, number>> = {
  zoom: 1, zoomexp: 1, rot: 0, warp: 1, warp_speed: 1, warp_scale: 1, cx: 0.5, cy: 0.5, dx: 0, dy: 0, sx: 1, sy: 1,
  decay: 0.98, wave_mode: 0, wave_r: 1, wave_g: 1, wave_b: 1, wave_a: 0.8, wave_x: 0.5, wave_y: 0.5, wave_scale: 1,
  wave_smoothing: 0.75, wave_mystery: 0, wave_thick: 0, wave_usedots: 0, wave_additive: 0, wave_brighten: 1,
  ob_size: 0.01, ob_r: 0, ob_g: 0, ob_b: 0, ob_a: 0, ib_size: 0.01, ib_r: 0.25, ib_g: 0.25, ib_b: 0.25, ib_a: 0,
  gamma: 2, echo_zoom: 2, echo_alpha: 0, echo_orient: 0, darken_center: 0, invert: 0, brighten: 0, darken: 0,
  solarize: 0, wrap: 1,
}
const BASE_LIST = Object.entries(BASE).map(([k, v]) => [I[k as PresetVar], v as number] as const)
const MOTION = ['zoom', 'zoomexp', 'rot', 'warp', 'cx', 'cy', 'dx', 'dy', 'sx', 'sy'] as const

export interface PresetData {
  /** Shown in the list. */
  name: string
  /** Starting values by `BASE` name. */
  base: Partial<Record<PresetVar, number>>
  /** Equations: once at the start, every frame, at every point of the mesh. */
  init: string
  frame: string
  vertex: string
}

/** A preset from anything (a file, saved settings), or null; unknown values dropped, equations cut at MAX_SOURCE. */
export function cleanPreset(raw: unknown, fallbackName = ''): PresetData | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_SOURCE) : '')
  const base: Partial<Record<PresetVar, number>> = {}
  if (r.base && typeof r.base === 'object')
    for (const [k, v] of Object.entries(r.base)) if (Object.hasOwn(BASE, k) && typeof v === 'number' && Number.isFinite(v)) base[k as PresetVar] = v
  const name = (typeof r.name === 'string' && r.name.trim() ? r.name : fallbackName).trim().slice(0, 80)
  return name ? { name, base, init: text(r.init), frame: text(r.frame), vertex: text(r.vertex) } : null
}

/** The mesh: 32 × 24 cells, fewer when the point equations are long (BUDGET nodes a frame), 12 × 9 at least. */
const COLS = 32
const ROWS = 24
const BUDGET = 40_000
export function meshFor(vertexNodes: number): [number, number] {
  if (vertexNodes <= 0) return [COLS, ROWS]
  const scale = Math.min(1, Math.max(0.375, Math.sqrt(BUDGET / (vertexNodes * (COLS + 1) * (ROWS + 1)))))
  return [Math.round(COLS * scale), Math.round(ROWS * scale)]
}

export interface PresetInput {
  /** Seconds since the preset started; since the last frame. */
  time: number
  dt: number
  /** Each range's level over its last seconds (about 1), and the same smoothed: createMusic. */
  bass: number
  mid: number
  treb: number
  bassAtt: number
  midAtt: number
  trebAtt: number
  /** A beat since the last frame; the tempo (0: none yet). */
  beat: boolean
  bpm: number
  /** The box's width over its height. */
  aspect: number
}

export interface Border {
  size: number
  r: number
  g: number
  b: number
  a: number
}

export interface PresetFrame {
  cols: number
  rows: number
  /** Where each mesh point (rows from the top, left to right) takes its colour in the last picture: u, v (0..1, v down). */
  uv: Float32Array
  /** What stays of the last picture after this frame (decay over the frame's length). */
  fade: number
  wave: { mode: number; r: number; g: number; b: number; a: number; x: number; y: number; scale: number; smoothing: number; mystery: number; thick: boolean; dots: boolean; additive: boolean; brighten: boolean }
  outer: Border
  inner: Border
  gamma: number
  echo: { zoom: number; alpha: number; orient: number }
  darkenCenter: boolean
  invert: boolean
  brighten: boolean
  darken: boolean
  solarize: boolean
  wrap: boolean
}

export interface PresetRun {
  /** Each program's error (init, frame, vertex), or null. */
  errors: (string | null)[]
  /** One frame: the music in, what to draw out (`out` reused). */
  step(input: PresetInput, out: PresetFrame): void
}

export const emptyFrame = (): PresetFrame => ({
  cols: 0,
  rows: 0,
  uv: new Float32Array(0),
  fade: 1,
  wave: { mode: 0, r: 1, g: 1, b: 1, a: 0, x: 0.5, y: 0.5, scale: 1, smoothing: 0, mystery: 0, thick: false, dots: false, additive: false, brighten: false },
  outer: { size: 0, r: 0, g: 0, b: 0, a: 0 },
  inner: { size: 0, r: 0, g: 0, b: 0, a: 0 },
  gamma: 1,
  echo: { zoom: 1, alpha: 0, orient: 0 },
  darkenCenter: false,
  invert: false,
  brighten: false,
  darken: false,
  solarize: false,
  wrap: true,
})

const unit = (x: number) => Math.min(1, Math.max(0, x))
/** A stretch or zoom over `k` 60ths of a second, its sign kept and never 0. */
const over = (s: number, k: number) => (s < 0 ? -1 : 1) * Math.pow(Math.max(Math.abs(s), 0.01), k)

export function createPreset(data: PresetData): PresetRun {
  const p = compile([data.init, data.frame, data.vertex], VARS)
  const v = p.vars
  const [runInit, runFrame, runVertex] = p.runs
  const hasVertex = p.sizes[2] > 0
  const [cols, rows] = meshFor(p.sizes[2])
  const base = BASE_LIST.map(([k, d]) => [k, data.base[VARS[k]] ?? d] as const)
  const motion = new Float64Array(MOTION.length)
  const points = (cols + 1) * (rows + 1)
  // The mesh's points and their place (the box's shape changes rad and ang).
  const px = new Float32Array(points)
  const py = new Float32Array(points)
  const rad = new Float32Array(points)
  const ang = new Float32Array(points)
  let shape = 0
  let frames = 0
  for (const [k, d] of base) v[k] = d
  runInit()

  function place(aspect: number) {
    shape = aspect
    const ex = Math.max(aspect, 1)
    const ey = Math.max(1 / aspect, 1)
    const corner = Math.hypot(ex, ey)
    for (let j = 0, n = 0; j <= rows; j++)
      for (let i = 0; i <= cols; i++, n++) {
        px[n] = i / cols
        py[n] = j / rows
        const qx = (px[n] - 0.5) * 2 * ex
        const qy = (0.5 - py[n]) * 2 * ey
        rad[n] = Math.hypot(qx, qy) / corner
        const a = Math.atan2(qy, qx)
        ang[n] = a < 0 ? a + 2 * Math.PI : a
      }
  }

  return {
    errors: p.errors,
    step(input, out) {
      const aspect = input.aspect > 0 && Number.isFinite(input.aspect) ? input.aspect : 1
      if (aspect !== shape) place(aspect)
      const dt = Math.min(0.1, Math.max(0, input.dt))
      // Presets move by the 60th of a second: the same speed at any drawing rate.
      const k = dt * 60
      for (const [key, d] of base) v[key] = d
      v[I.time] = input.time
      v[I.fps] = dt > 0 ? 1 / dt : 60
      v[I.frame] = frames++
      v[I.bass] = input.bass
      v[I.mid] = input.mid
      v[I.treb] = input.treb
      v[I.bass_att] = input.bassAtt
      v[I.mid_att] = input.midAtt
      v[I.treb_att] = input.trebAtt
      v[I.beat] = input.beat ? 1 : 0
      v[I.bpm] = input.bpm
      v[I.aspectx] = Math.min(1, 1 / aspect)
      v[I.aspecty] = Math.min(1, aspect)
      v[I.meshx] = cols
      v[I.meshy] = rows
      runFrame()
      for (let m = 0; m < MOTION.length; m++) motion[m] = v[I[MOTION[m]]]

      const ex = Math.max(aspect, 1)
      const ey = Math.max(1 / aspect, 1)
      // Warp: sines drifting over the picture, their shapes changing with time.
      const t = v[I.time] * v[I.warp_speed]
      const s = v[I.warp_scale] !== 0 ? 1 / v[I.warp_scale] : 1
      const f0 = 11 + 4 * Math.cos(t * 0.31 + 1)
      const f1 = 12 + 4 * Math.cos(t * 0.27 + 2)
      const f2 = 10 + 4 * Math.cos(t * 0.23 + 3)
      const f3 = 11 + 4 * Math.cos(t * 0.19 + 4)
      if (out.uv.length !== 2 * points) out.uv = new Float32Array(2 * points)
      const uv = out.uv
      for (let n = 0; n < points; n++) {
        if (hasVertex) {
          for (let m = 0; m < MOTION.length; m++) v[I[MOTION[m]]] = motion[m]
          v[I.x] = px[n]
          v[I.y] = py[n]
          v[I.rad] = rad[n]
          v[I.ang] = ang[n]
          runVertex()
        }
        const src = hasVertex ? v : null
        const zoom = src ? src[I.zoom] : motion[0]
        const zoomexp = src ? src[I.zoomexp] : motion[1]
        const rot = src ? src[I.rot] : motion[2]
        const warp = src ? src[I.warp] : motion[3]
        const cx = src ? src[I.cx] : motion[4]
        const cy = src ? src[I.cy] : motion[5]
        const dx = src ? src[I.dx] : motion[6]
        const dy = src ? src[I.dy] : motion[7]
        const sx = src ? src[I.sx] : motion[8]
        const sy = src ? src[I.sy] : motion[9]
        const x = px[n]
        const y = py[n]
        // Around the centre, in the shorter side's units (circles stay round), y up.
        const z = over(zoom, Math.pow(Math.max(zoomexp, 0.01), rad[n] * 2 - 1) * k)
        const qx = ((x - cx) * ex) / (z * over(sx, k))
        const qy = ((cy - y) * ey) / (z * over(sy, k))
        const a = -rot * k
        const c = Math.cos(a)
        const sn = Math.sin(a)
        const w = warp * 0.0035 * k
        uv[2 * n] = cx + (qx * c - qy * sn) / ex - dx * k + w * (Math.sin(t * 0.34 + s * (x * f0 - y * f3)) + Math.cos(t * 0.75 - s * (x * f1 - y * f2)))
        uv[2 * n + 1] = cy - (qx * sn + qy * c) / ey - dy * k + w * (Math.cos(t * 0.38 - s * (x * f2 + y * f1)) + Math.sin(t * 0.83 + s * (x * f0 + y * f3)))
      }
      // The frame's own values again for what follows.
      if (hasVertex) for (let m = 0; m < MOTION.length; m++) v[I[MOTION[m]]] = motion[m]

      out.cols = cols
      out.rows = rows
      out.fade = Math.pow(unit(v[I.decay]), k)
      const wv = out.wave
      wv.mode = v[I.wave_mode]
      wv.r = unit(v[I.wave_r])
      wv.g = unit(v[I.wave_g])
      wv.b = unit(v[I.wave_b])
      wv.a = unit(v[I.wave_a])
      wv.x = v[I.wave_x]
      wv.y = v[I.wave_y]
      wv.scale = v[I.wave_scale]
      wv.smoothing = Math.min(0.95, Math.max(0, v[I.wave_smoothing]))
      wv.mystery = v[I.wave_mystery]
      wv.thick = v[I.wave_thick] !== 0
      wv.dots = v[I.wave_usedots] !== 0
      wv.additive = v[I.wave_additive] !== 0
      wv.brighten = v[I.wave_brighten] !== 0
      border(out.outer, I.ob_size)
      border(out.inner, I.ib_size)
      out.gamma = Math.min(8, Math.max(0, v[I.gamma]))
      out.echo.zoom = Math.min(8, Math.max(0.1, v[I.echo_zoom]))
      out.echo.alpha = unit(v[I.echo_alpha])
      out.echo.orient = ((Math.round(v[I.echo_orient]) % 4) + 4) % 4
      out.darkenCenter = v[I.darken_center] !== 0
      out.invert = v[I.invert] !== 0
      out.brighten = v[I.brighten] !== 0
      out.darken = v[I.darken] !== 0
      out.solarize = v[I.solarize] !== 0
      out.wrap = v[I.wrap] !== 0
    },
  }

  /** A border from its size's place in VARS, its r, g, b, a right after it. */
  function border(b: Border, at: number) {
    b.size = Math.min(0.5, Math.max(0, v[at]))
    b.r = unit(v[at + 1])
    b.g = unit(v[at + 2])
    b.b = unit(v[at + 3])
    b.a = unit(v[at + 4])
  }
}

/** The wave's samples (a side): the last block, two by two, smoothed along. */
export const WAVE_POINTS = 256

/**
 * The wave's points for its mode (0..7: circle, x-y scope, mid-side scope, spiral, horizontal line, vertical line,
 * line at an angle, the sides' difference), x right and y down in the box's shares, into `out` (2 × (WAVE_POINTS + 1)
 * numbers); returns how many points. A circle comes back closed. `l`, `r`: the newest wave blocks, -1 to 1. Sizes
 * are in the shorter side's halves (a circle of 0.5 spans half of it).
 */
export function wavePoints(w: PresetFrame['wave'], l: ArrayLike<number>, r: ArrayLike<number>, aspect: number, out: Float32Array): number {
  const n = WAVE_POINTS
  const ex = Math.max(aspect, 1)
  const ey = Math.max(1 / aspect, 1)
  const mode = ((Math.round(w.mode) % 8) + 8) % 8
  const step = Math.max(1, Math.floor(l.length / n))
  let ml = 0
  let mr = 0
  let first = 0
  const keep = w.smoothing
  // Smoothed sides, then the point for each.
  for (let i = 0; i < n; i++) {
    let sl = 0
    let sr = 0
    for (let j = 0; j < step; j++) {
      sl += l[i * step + j] ?? 0
      sr += r[i * step + j] ?? 0
    }
    ml = i === 0 ? sl / step : ml * keep + (sl / step) * (1 - keep)
    mr = i === 0 ? sr / step : mr * keep + (sr / step) * (1 - keep)
    const mono = (ml + mr) / 2
    if (i === 0) first = mono
    const f = i / (n - 1)
    let x = 0
    let y = 0
    if (mode === 0) {
      // The last samples lean towards the first, so the circle closes without a step.
      const tail = Math.max(0, (i - (n - 24)) / 24)
      const rr = 0.5 * (1 + w.mystery * 0.5) + 0.4 * w.scale * (mono * (1 - tail) + first * tail)
      const th = (i / n) * 2 * Math.PI
      x = rr * Math.cos(th)
      y = -rr * Math.sin(th)
    } else if (mode === 1) {
      x = ml * 0.9 * w.scale
      y = -mr * 0.9 * w.scale
    } else if (mode === 2) {
      x = (ml - mr) * 0.6 * w.scale
      y = -(ml + mr) * 0.6 * w.scale
    } else if (mode === 3) {
      const th = f * 4 * Math.PI
      const rr = 0.1 + 0.7 * f + 0.2 * w.scale * mono
      x = rr * Math.cos(th)
      y = -rr * Math.sin(th)
    } else if (mode === 4 || mode === 7) {
      x = (f - 0.5) * 2 * ex
      y = -(mode === 7 ? ml - mr : mono) * 0.5 * w.scale
    } else if (mode === 5) {
      x = mono * 0.5 * w.scale
      y = (f - 0.5) * 2 * ey
    } else {
      const th = w.mystery * Math.PI
      const along = (f - 0.5) * 3
      const off = mono * 0.6 * w.scale
      x = along * Math.cos(th) - off * Math.sin(th)
      y = -(along * Math.sin(th) + off * Math.cos(th))
    }
    // Back to the box's shares around the wave's place; the horizontal and vertical lines span the box.
    out[2 * i] = mode === 4 || mode === 7 ? f : w.x + x / (2 * ex)
    out[2 * i + 1] = mode === 5 ? f : w.y + y / (2 * ey)
  }
  if (mode !== 0) return n
  out[2 * n] = out[0]
  out[2 * n + 1] = out[1]
  return n + 1
}

/** Ranges of the music, Hz: what the equations call bass, mid and treb. */
const RANGES: [number, number][] = [
  [30, 250],
  [250, 2000],
  [2000, 16000],
]
/** Seconds the reference level and the smoothed levels take to follow. */
const AVG_S = 4
const ATT_S = 0.2

export interface Music {
  bass: number
  mid: number
  treb: number
  bassAtt: number
  midAtt: number
  trebAtt: number
}

/** bass, mid and treb as the equations know them: each range's level over its own last seconds (about 1, up to 5). */
export function createMusic() {
  const avg = new Float64Array(3)
  const now = new Float64Array(3)
  const att = new Float64Array(3)
  let ranges: { n: number; from: number[]; to: number[] } | null = null
  return {
    /** A frame's band levels per side (dB, vizUnpack.ts), `dt` seconds after the last. */
    push(l: ArrayLike<number>, r: ArrayLike<number>, dt: number) {
      if (ranges?.n !== l.length) {
        const n = l.length
        const at = (hz: number) => {
          let i = 0
          while (i < n && bandHz(i, n) < hz) i++
          return i
        }
        ranges = { n, from: RANGES.map(([lo]) => at(lo)), to: RANGES.map(([, hi]) => at(hi)) }
      }
      for (let k = 0; k < 3; k++) {
        let power = 0
        for (let i = ranges.from[k]; i < ranges.to[k]; i++) power += 10 ** (l[i] / 10) + 10 ** (r[i] / 10)
        const amp = Math.sqrt(power / 2)
        avg[k] = avg[k] === 0 ? amp : avg[k] + (amp - avg[k]) * (1 - Math.exp(-dt / AVG_S))
        now[k] = avg[k] > 1e-6 ? Math.min(5, amp / avg[k]) : 0
        att[k] += (now[k] - att[k]) * (1 - Math.exp(-dt / ATT_S))
      }
    },
    /** Nothing sounds: every level 0, the reference kept for the next song. */
    silence() {
      now.fill(0)
      att.fill(0)
    },
    read(): Music {
      return { bass: now[0], mid: now[1], treb: now[2], bassAtt: att[0], midAtt: att[1], trebAtt: att[2] }
    },
  }
}
