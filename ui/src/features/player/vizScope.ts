import { VIZ_WAVE } from './vizUnpack'

/**
 * The Oscilloscope look's maths, pure (runs in the worker): the frames' wave blocks (vizUnpack.ts) as one side, and
 * where to start drawing so a steady wave stands still, as a scope's trigger: a rising zero crossing of its smoothed
 * shape (the low end sets the period; hiss does not trip it).
 */

/** Samples drawn: half a block (about 10.7 ms at 48 kHz), so a crossing in the first half always has room. */
export const SPAN = VIZ_WAVE / 2

/** Smoothing for the trigger: 2 · HALF + 1 samples. */
const HALF = 4

/** Both sides as one (their mean) into `out`. */
export function monoWave(l: ArrayLike<number>, r: ArrayLike<number>, out: Float32Array): Float32Array {
  for (let i = 0; i < out.length; i++) out[i] = ((l[i] ?? 0) + (r[i] ?? 0)) / 2
  return out
}

/** Where to start drawing `span` samples of `x`: its first rising zero crossing (smoothed) with room after it, else 0. */
export function trigger(x: ArrayLike<number>, span = SPAN): number {
  const smooth = (i: number) => {
    let s = 0
    for (let j = i - HALF; j <= i + HALF; j++) s += x[j]
    return s
  }
  let before = smooth(HALF)
  for (let i = HALF + 1; i <= x.length - span && i + HALF < x.length; i++) {
    const now = smooth(i)
    if (before < 0 && now >= 0) return i
    before = now
  }
  return 0
}
