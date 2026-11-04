import { bandAt } from './vizBeat'

/**
 * Particles on the beat (Visualizer v2), pure (runs in the worker): soft dots that burst from the middle on each kick
 * (vizBeat.ts), drift with the mids along a slow swirl, slow down and fade; a trickle in proportion to the level, so a
 * song without kicks still moves. Positions and sizes in CSS px of the box; vizPaint.ts draws them in the cover's colours.
 */

/** Most alive at once in a full HD box; a smaller box holds fewer, by area, never under MIN_CAP. */
const CAP = 900
const MIN_CAP = 60
const FULL_AREA = 1920 * 1080
/** Bursts at most this often, s: 3 a second at most, the flash limit's count, whatever the tempo. */
export const BURST_GAP_S = 0.34
/** A burst: this share of the cap for a kick of STRONG dB of rise, more or less with the kick. */
const BURST_SHARE = 0.12
const STRONG = 12
/** A burst's speed, half diagonals a second; how fast speeds fall, s. */
const BURST_SPEED = 0.9
const DRAG_S = 0.7
/** Lives, s; the fade in at the start. */
const LIFE_MIN = 1.2
const LIFE_MAX = 3
const FADE_IN_S = 0.12
/** The trickle at full level: new dots a second, as a share of the cap. */
const TRICKLE_SHARE = 0.1
/** The mids' push at full level, half diagonals a second squared: with the drag, a drift of about a sixth of one a second. */
const DRIFT = 0.25
/** Diameters, CSS px in a full HD box (a burst's a third bigger); a smaller box has smaller dots, by the root of its size. */
const SIZE_MIN = 8
const SIZE_MAX = 36
const BURST_SIZE = 1.3
const FULL_HALF = Math.hypot(1920, 1080) / 2

/** A frame's mood for the particles: the mids' level and the whole level, 0 to 1. */
export interface Mood {
  mids: number
  level: number
}

/**
 * The mids (160 Hz to 2.5 kHz, mean dB of `bands`) and the level (the louder side's RMS, dB), each 0 to 1: -65 to -25 dB
 * for a mid band, -40 to -10 dB RMS for the level (a song's loud parts read about -10).
 */
export function moodOf(bands: ArrayLike<number>, rms: ArrayLike<number>): Mood {
  const n = bands.length
  const lo = bandAt(160, n) + 1
  const hi = bandAt(2500, n)
  let sum = 0
  for (let i = lo; i <= hi; i++) sum += bands[i]
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return { mids: clamp((sum / (hi - lo + 1) + 65) / 40), level: clamp((Math.max(rms[0], rms[1]) + 40) / 30) }
}

export function createParticles(random: () => number = Math.random) {
  const x = new Float32Array(CAP)
  const y = new Float32Array(CAP)
  const vx = new Float32Array(CAP)
  const vy = new Float32Array(CAP)
  const age = new Float32Array(CAP)
  const life = new Float32Array(CAP)
  const size = new Float32Array(CAP)
  const color = new Uint8Array(CAP)
  let n = 0
  let cap = MIN_CAP
  let w = 1
  let h = 1
  let half = 1
  let grow = 1
  let lastBurst = -Infinity
  // The trickle's share of a dot not yet made.
  let owed = 0

  function add(px: number, py: number, sx: number, sy: number, colors: number, big = 1) {
    if (n >= cap) return
    x[n] = px
    y[n] = py
    vx[n] = sx
    vy[n] = sy
    age[n] = 0
    life[n] = LIFE_MIN + (LIFE_MAX - LIFE_MIN) * random()
    // Mostly small, a few big.
    size[n] = (SIZE_MIN + (SIZE_MAX - SIZE_MIN) * random() ** 2) * grow * big
    color[n] = Math.min(colors - 1, Math.floor(random() * colors))
    n++
  }

  /** Dot i goes: the last takes its place. */
  function drop(i: number) {
    n--
    x[i] = x[n]
    y[i] = y[n]
    vx[i] = vx[n]
    vy[i] = vy[n]
    age[i] = age[n]
    life[i] = life[n]
    size[i] = size[n]
    color[i] = color[n]
  }

  return {
    /** Dots alive. */
    get count() {
      return n
    },
    /** Most dots this box holds. */
    get cap() {
      return cap
    },
    /** The box, CSS px. Dots left over a smaller cap stay until they fade. */
    size(width: number, height: number) {
      w = Math.max(1, width)
      h = Math.max(1, height)
      half = Math.hypot(w, h) / 2
      cap = Math.max(MIN_CAP, Math.min(CAP, Math.round((CAP * w * h) / FULL_AREA)))
      grow = Math.max(0.5, Math.min(1.5, Math.sqrt(half / FULL_HALF)))
    },
    /** A kick of `strength` (dB of rise) at `t` s: a burst from the middle, unless the last was under BURST_GAP_S ago. */
    burst(t: number, strength: number, colors: number): boolean {
      if (t - lastBurst < BURST_GAP_S) return false
      lastBurst = t
      const k = Math.min(2, Math.max(0.4, strength / STRONG))
      const count = Math.round(cap * BURST_SHARE * k)
      const speed = half * BURST_SPEED * Math.min(1.6, Math.max(0.6, k))
      for (let i = 0; i < count; i++) {
        const a = 2 * Math.PI * random()
        const v = speed * (0.4 + 0.6 * random())
        const r = 0.02 * half * random()
        add(w / 2 + r * Math.cos(a), h / 2 + r * Math.sin(a), v * Math.cos(a), v * Math.sin(a), colors, BURST_SIZE)
      }
      return true
    },
    /** The trickle for `dt` s at `level` (0 to 1): new dots anywhere in the box, barely moving. */
    trickle(dt: number, level: number, colors: number) {
      owed += dt * cap * TRICKLE_SHARE * Math.max(0, level)
      while (owed >= 1) {
        owed--
        if (n >= cap) {
          owed = 0
          break
        }
        const a = 2 * Math.PI * random()
        const v = 0.03 * half * random()
        add(w * random(), h * random(), v * Math.cos(a), v * Math.sin(a), colors)
      }
    },
    /** Everything `dt` s on at `t` s: the mids' push (0 to 1) along a slow swirl, the drag, the ages. Old dots and those out of the box go. */
    step(dt: number, mids: number, t: number) {
      const drag = Math.exp(-dt / DRAG_S)
      const push = Math.max(0, mids) * DRIFT * half * dt
      for (let i = n - 1; i >= 0; i--) {
        age[i] += dt
        const r = size[i] / 2
        if (age[i] >= life[i] || x[i] < -r || y[i] < -r || x[i] > w + r || y[i] > h + r) {
          drop(i)
          continue
        }
        // The swirl: a direction that turns slowly across the box and with time.
        const turn = Math.PI * (Math.sin((1.7 * x[i]) / half + 0.23 * t) + Math.cos((1.3 * y[i]) / half - 0.17 * t))
        vx[i] = (vx[i] + push * Math.cos(turn)) * drag
        vy[i] = (vy[i] + push * Math.sin(turn)) * drag
        x[i] += vx[i] * dt
        y[i] += vy[i] * dt
      }
    },
    /** Each dot: its centre, diameter, opacity (in over FADE_IN_S, out over the second half of its life) and colour. */
    each(fn: (x: number, y: number, size: number, alpha: number, color: number) => void) {
      for (let i = 0; i < n; i++) {
        const alpha = Math.min(1, age[i] / FADE_IN_S, (2 * (life[i] - age[i])) / life[i])
        if (alpha > 0) fn(x[i], y[i], size[i], alpha, color[i])
      }
    },
    /** Another look, a new song: no dots. */
    clear() {
      n = 0
      owed = 0
      lastBurst = -Infinity
    },
  }
}
