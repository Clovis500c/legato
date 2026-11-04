/**
 * The Vectorscope look's maths, pure (runs in the worker): the frames' wave blocks (vizUnpack.ts) as a goniometer, the
 * mid up and the side across, so a mono sound stands as a vertical line, one side alone leans 45°, opposite phases
 * lie flat; and the two sides' correlation, +1 mono, 0 unrelated or one side alone, −1 opposite (a mono mix loses it).
 */

/** Correlation's time constant, s (a meter's integration, about 300 ms). */
export const CORR_S = 0.3

/** Under this rms (−70 dBFS) a side is silent. */
const QUIET = 1e-7

/**
 * The blocks as points into `out`, x and y in turn: x = side, y = mid, both halved, so |x| + |y| is the larger side's
 * size and full scale draws the square's diamond, never past it.
 */
export function vectorPoints(l: ArrayLike<number>, r: ArrayLike<number>, out: Float32Array): Float32Array {
  for (let i = 0; 2 * i + 1 < out.length; i++) {
    const a = l[i] ?? 0
    const b = r[i] ?? 0
    out[2 * i] = (b - a) / 2
    out[2 * i + 1] = (a + b) / 2
  }
  return out
}

/** The two sides' correlation over a block, −1 to 1: 0 when one side is silent, null when both are. */
export function correlation(l: ArrayLike<number>, r: ArrayLike<number>): number | null {
  let lr = 0
  let ll = 0
  let rr = 0
  const n = Math.min(l.length, r.length)
  for (let i = 0; i < n; i++) {
    lr += l[i] * r[i]
    ll += l[i] * l[i]
    rr += r[i] * r[i]
  }
  const quiet = QUIET * n
  if (ll < quiet && rr < quiet) return null
  if (ll < quiet || rr < quiet) return 0
  return Math.max(-1, Math.min(1, lr / Math.sqrt(ll * rr)))
}

/** The meter's reading eased toward `now`, `dt` seconds later (none: it holds). */
export function easeCorrelation(shown: number, now: number | null, dt: number, tau = CORR_S): number {
  if (now === null) return shown
  return shown + (now - shown) * (1 - Math.exp(-Math.max(0, dt) / tau))
}
