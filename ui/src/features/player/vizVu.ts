/**
 * The needle looks' numbers (vizPaint.ts draws them), pure. VU: a frame's level in VU, the needle as a damped spring
 * tuned to the VU standard, the peak LED. PPM: the peaks, read at once and falling back at the standard's rate, the
 * over LED. Needle positions are 0..1 along the scale.
 */

/** Natural frequency (rad/s) and damping of the needle: a step reaches 99 % in 300 ms with 1.24 % overshoot (VU standard: 300 ms, 1 to 1.5 %). */
export const NEEDLE_W = 13.5218
export const NEEDLE_Z = 0.813

/** Scale of the dial, VU. 0 VU sits at 14 dB under full scale (RMS), the streaming level. */
export const VU_MIN = -20
export const VU_MAX = 3
export const VU_REF_DBFS = -14
/** The peak LED lights at this VU and holds this long, s (once a second at most: well under the flash limit). */
export const LED_AT = 3
export const LED_HOLD = 1

/** Marks of the dial, VU. */
export const VU_MARKS = [-20, -10, -7, -5, -3, 0, 3]

/** The needle looks: two meters side by side on a dial. */
export const needleLook = (look: string) => look === 'vu' || look === 'ppm'

/** Needle position (0..1, a little past the end allowed to 1.04) for a level in VU. */
export const vuPos = (vu: number) => Math.min(1.04, Math.max(0, (vu - VU_MIN) / (VU_MAX - VU_MIN)))

/**
 * PPM, as a digital peak meter (IEC 60268-18): the samples' peak (the frames' peak of each hop, dB under full scale),
 * no integration, falling back 20 dB in 1.7 s. A dBFS scale: peak meters of broadcast scales sit pinned by today's
 * masters.
 */
export const PPM_MARKS = [-40, -30, -20, -10, -6, -3, 0]
/** The red end starts here, dBFS. */
export const PPM_RED = -3
/** dB a second the reading falls back. */
export const PPM_FALL = 20 / 1.7
/** The over LED: a peak this near full scale (the frames' half-dB steps), held LED_HOLD. */
export const PPM_LED_AT = -0.5

/** The PPM scale's knees (dBFS, position): -40 to -20 on the first quarter, -20 to -10 the next, the top 10 dB on the
 *  right half, where music's peaks live (a straight dB scale crowds -6, -3 and 0 together). */
const PPM_KNEES = [
  [-40, 0],
  [-20, 0.25],
  [-10, 0.5],
  [0, 1],
] as const

/** Needle position (0..1) for a peak in dBFS. */
export function ppmPos(db: number): number {
  if (db <= PPM_KNEES[0][0]) return 0
  for (let i = 1; i < PPM_KNEES.length; i++) {
    const [d1, p1] = PPM_KNEES[i]
    const [d0, p0] = PPM_KNEES[i - 1]
    if (db <= d1) return p0 + ((db - d0) / (d1 - d0)) * (p1 - p0)
  }
  return 1
}

/** The reading `dt` s on: a new peak at once, else down at PPM_FALL. */
export const stepPpm = (reading: number, peak: number, dt: number) => Math.max(peak, reading - PPM_FALL * dt)

/**
 * One side's level, VU, from the frame's window RMS (dB, 0 = full scale, a full-scale sine reads -3). Not from the
 * bands: under 300 Hz they overlap, so summing them reads 5 to 9 dB hot on bass.
 */
export const vuOf = (rmsDb: number) => rmsDb - VU_REF_DBFS

/** A spring-and-damper needle (exact steps: the same at any frame rate). */
export interface Needle {
  x: number
  v: number
}

/** Moves `n` toward `target` for `dt` seconds (the closed form of x'' + 2ζω x' + ω² x = ω² target). */
export function stepNeedle(n: Needle, target: number, dt: number): void {
  if (dt <= 0) return
  const a = NEEDLE_Z * NEEDLE_W
  const wd = NEEDLE_W * Math.sqrt(1 - NEEDLE_Z * NEEDLE_Z)
  const e0 = n.x - target
  const v0 = n.v
  const k = Math.exp(-a * dt)
  const c = Math.cos(wd * dt)
  const s = Math.sin(wd * dt)
  n.x = target + k * (e0 * c + ((v0 + a * e0) / wd) * s)
  n.v = k * (v0 * c - ((NEEDLE_W * NEEDLE_W * e0 + a * v0) / wd) * s)
}

/** Peak LED: lit by a level at LED_AT, kept for LED_HOLD after the last one. Returns the time left. */
export const holdLed = (left: number, vu: number, dt: number) => (vu >= LED_AT ? LED_HOLD : Math.max(0, left - dt))

/** Reduced motion: the level is smoothed first (time constant, s), so the needles drift instead of jumping. */
const CALM_TAU = 0.45

/** Two needles and their LEDs, fed by the frames and stepped per drawn frame. `ppm`: peak needles, else VU. */
export function createVu(calm: boolean, ppm = false) {
  const needle: Needle[] = [
    { x: 0, v: 0 },
    { x: 0, v: 0 },
  ]
  const target = [0, 0]
  const smooth = [0, 0]
  const led = [0, 0]
  const vu = [VU_MIN, VU_MIN]
  // PPM: the highest peak of the frames since the last step (two frames a drawn one at 30 fps), and the reading.
  const top = [-120, -120]
  const reading = [-120, -120]
  let silent = true
  return {
    /** The newest frame's window RMS and its hop's peak, both sides, dB. */
    frame(rms: ArrayLike<number>, peak: ArrayLike<number> = rms) {
      for (let i = 0; i < 2; i++) {
        vu[i] = vuOf(rms[i])
        top[i] = Math.max(top[i], peak[i])
      }
      silent = false
    },
    /** Nothing sounds: the needles fall to zero. */
    silence() {
      silent = true
    },
    /** `dt` seconds on. pos = needle places, on = LEDs lit. */
    step(dt: number) {
      for (let i = 0; i < 2; i++) {
        let p: number
        if (ppm) {
          const peak = silent ? -120 : top[i]
          led[i] = peak >= PPM_LED_AT ? LED_HOLD : Math.max(0, led[i] - dt)
          reading[i] = Math.max(-120, stepPpm(reading[i], peak, dt))
          top[i] = -120
          p = ppmPos(reading[i])
        } else {
          const level = silent ? VU_MIN : vu[i]
          // The LED reads the level before any smoothing.
          led[i] = holdLed(led[i], level, dt)
          p = vuPos(level)
        }
        if (calm) {
          smooth[i] += (p - smooth[i]) * (1 - Math.exp(-dt / CALM_TAU))
          target[i] = smooth[i]
        } else {
          target[i] = p
        }
        if (ppm) {
          // Its ballistics are the reading's: the needle goes where it says.
          needle[i].x = target[i]
          needle[i].v = 0
        } else stepNeedle(needle[i], target[i], dt)
      }
      const resting = silent && needle.every((n) => Math.abs(n.x) < 0.002 && Math.abs(n.v) < 0.01) && led.every((l) => l === 0)
      return { pos: [needle[0].x, needle[1].x], on: [led[0] > 0, led[1] > 0], resting }
    },
  }
}
