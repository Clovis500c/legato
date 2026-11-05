/**
 * The 3D terrain look's numbers (vizPaint.ts draws them), pure: the last seconds of the spectrum as rows of a
 * landscape, the newest at the front following the sound, older ones going back to the horizon; the perspective.
 */

/** Rows kept, a new one every `ROW_S` s (twice that in reduced motion): 3.3 s of sound. */
export const ROWS = 40
export const ROW_S = 1 / 12
/** Points per row: the bands resampled, so a row costs the same at any banding. */
export const COLS = 64
/** Depth of the row leaving at the back, the front one being at 1. */
const FAR = 3.5
/** The horizon and the front row's ground, as shares of the box's height; the front row's width and highest hill. */
const HORIZON = 0.22
const FRONT = 0.97
const WIDTH = 0.96
const LIFT = 0.55

export interface Terrain {
  /** Levels 0..1, COLS each; the newest at `head`. */
  rows: Float32Array[]
  head: number
  /** Seconds since the newest row started. */
  since: number
}

export const createTerrain = (): Terrain => ({ rows: Array.from({ length: ROWS }, () => new Float32Array(COLS)), head: 0, since: 0 })

/** Levels of any count into `out`, linear between neighbours. */
export function resample(levels: ArrayLike<number>, out: Float32Array): void {
  const n = levels.length
  for (let c = 0; c < out.length; c++) {
    if (n < 2) {
      out[c] = n ? levels[0] : 0
      continue
    }
    const pos = (c / (out.length - 1)) * (n - 1)
    const i = Math.min(n - 2, Math.floor(pos))
    out[c] = levels[i] + (levels[i + 1] - levels[i]) * (pos - i)
  }
}

/** After `dt` s: a new row every `step` s, the newest one following the levels. A long gap starts at most a round of rows. */
export function advance(t: Terrain, levels: ArrayLike<number>, dt: number, step = ROW_S): void {
  t.since = Math.min(t.since + dt, step * ROWS)
  while (t.since >= step) {
    t.since -= step
    const last = t.rows[t.head]
    t.head = (t.head + 1) % ROWS
    t.rows[t.head].set(last)
  }
  resample(levels, t.rows[t.head])
}

/** Row `k` back from the newest (0), all of them gone back `frac` (0..1) of a row: its depth, 1 at the front. */
export const depthOf = (k: number, frac: number) => 1 + ((k + frac) / ROWS) * (FAR - 1)

/** Opacity by depth: full at the front, none where the oldest row leaves. */
export const fadeOf = (z: number) => Math.min(1, Math.max(0, (FAR - z) / (FAR - 1)))

/** Where a row at depth `z` sits in a `w` x `h` box: its ground line, its half width, its highest hill. */
export function project(z: number, w: number, h: number): { y: number; half: number; lift: number } {
  return { y: h * (HORIZON + (FRONT - HORIZON) / z), half: (w * WIDTH) / 2 / z, lift: (h * LIFT) / z }
}

/** True when every row is flat: nothing left to draw. */
export const flat = (t: Terrain) => t.rows.every((r) => r.every((v) => v < 0.002))
