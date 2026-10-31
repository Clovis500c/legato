/**
 * The VU look's numbers (vizPaint.ts draws them), pure: a frame's level in VU, the needle as a damped spring tuned to
 * the VU standard, the peak LED. Needle positions are 0..1 along the scale.
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

/** Needle position (0..1, a little past the end allowed to 1.04) for a level in VU. */
export const vuPos = (vu: number) => Math.min(1.04, Math.max(0, (vu - VU_MIN) / (VU_MAX - VU_MIN)))

/**
 * One side's level, VU, from its band levels (dB): the bands' energies summed. A sine reads its amplitude in dB in
 * the band it sits in (0 dB at full scale), so the sum is 3 dB over the RMS level.
 */
export function vuOf(bands: ArrayLike<number>): number {
  let p = 0
  for (let i = 0; i < bands.length; i++) p += 10 ** (bands[i] / 10)
  const dbfs = 10 * Math.log10(Math.max(p, 1e-12)) - 3
  return dbfs - VU_REF_DBFS
}

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

/** Two needles and their LEDs, fed by the frames and stepped per drawn frame. */
export function createVu(calm: boolean) {
  const needle: Needle[] = [
    { x: 0, v: 0 },
    { x: 0, v: 0 },
  ]
  const target = [0, 0]
  const smooth = [0, 0]
  const led = [0, 0]
  const vu = [VU_MIN, VU_MIN]
  let silent = true
  return {
    /** The newest frame (both sides, dB per band). */
    frame(left: ArrayLike<number>, right: ArrayLike<number>) {
      vu[0] = vuOf(left)
      vu[1] = vuOf(right)
      silent = false
    },
    /** Nothing sounds: the needles fall to zero. */
    silence() {
      silent = true
    },
    /** `dt` seconds on. pos = needle places, on = LEDs lit. */
    step(dt: number) {
      for (let i = 0; i < 2; i++) {
        const level = silent ? VU_MIN : vu[i]
        // The LED reads the level before any smoothing.
        led[i] = holdLed(led[i], level, dt)
        const p = vuPos(level)
        if (calm) {
          smooth[i] += (p - smooth[i]) * (1 - Math.exp(-dt / CALM_TAU))
          target[i] = smooth[i]
        } else {
          target[i] = p
        }
        stepNeedle(needle[i], target[i], dt)
      }
      const resting = silent && needle.every((n) => Math.abs(n.x) < 0.002 && Math.abs(n.v) < 0.01) && led.every((l) => l === 0)
      return { pos: [needle[0].x, needle[1].x], on: [led[0] > 0, led[1] > 0], resting }
    },
  }
}
