/**
 * The spectrogram look's numbers (vizPaint.ts draws them), pure: the colour map, the fixed scroll speed, one column
 * of pixels from the columns' levels.
 */

/** Scroll speed, CSS px a second (half of it in reduced motion). The same at any refresh rate. */
export const SCROLL = 90
export const SCROLL_CALM = 45

/**
 * Colour map, level 0..1 → [r, g, b, a]: clear at silence, then violet, red, orange, pale yellow (a magma-like
 * table, readable on a dark and on a light page).
 */
const STOPS: [number, number, number, number, number][] = [
  [0, 20, 8, 60, 0],
  [0.2, 52, 14, 100, 0.55],
  [0.4, 120, 28, 109, 0.85],
  [0.6, 205, 63, 78, 1],
  [0.8, 249, 130, 70, 1],
  [1, 253, 231, 130, 1],
]

/** 256 steps of the map, each one packed for a Uint32 view of RGBA pixels (little endian: a, b, g, r). */
export function colorMap(): Uint32Array {
  const out = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let k = 1
    while (k < STOPS.length - 1 && STOPS[k][0] < t) k++
    const [t0, r0, g0, b0, a0] = STOPS[k - 1]
    const [t1, r1, g1, b1, a1] = STOPS[k]
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))
    const mix = (a: number, b: number) => a + (b - a) * f
    const a = Math.round(mix(a0, a1) * 255)
    // Premultiplied or not, putImageData takes straight colour.
    out[i] = ((a << 24) | (Math.round(mix(b0, b1)) << 16) | (Math.round(mix(g0, g1)) << 8) | Math.round(mix(r0, r1))) >>> 0
  }
  return out
}

/** Whole device pixels to scroll after `dt` s at `speed` CSS px/s; the rest waits in `acc`. */
export function scrollBy(acc: { v: number }, dt: number, speed: number, dpr: number): number {
  acc.v += dt * speed * dpr
  const n = Math.floor(acc.v)
  acc.v -= n
  return n
}

/** For each of `h` pixel rows (top = highest band), the two columns it mixes and the share of the second. */
export function rowMix(h: number, columns: number): { lo: Uint16Array; f: Float32Array } {
  const lo = new Uint16Array(h)
  const f = new Float32Array(h)
  for (let y = 0; y < h; y++) {
    // Low bands at the bottom.
    const pos = (1 - (y + 0.5) / h) * (columns - 1)
    const i = Math.min(columns - 2, Math.max(0, Math.floor(pos)))
    lo[y] = Math.max(0, i)
    f[y] = columns < 2 ? 0 : Math.min(1, Math.max(0, pos - i))
  }
  return { lo, f }
}

/** One column of pixels (`out` = h pixels) from the levels 0..1 of the columns, mixed along the band axis. */
export function fillColumn(out: Uint32Array, levels: ArrayLike<number>, mix: { lo: Uint16Array; f: Float32Array }, map: Uint32Array): void {
  const last = levels.length - 1
  for (let y = 0; y < out.length; y++) {
    const i = mix.lo[y]
    const v = levels[i] + ((levels[Math.min(last, i + 1)] ?? levels[i]) - levels[i]) * mix.f[y]
    out[y] = map[Math.min(255, Math.max(0, Math.round(v * 255)))]
  }
}
