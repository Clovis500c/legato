/**
 * The spectrogram look's numbers (vizPaint.ts draws them), pure: the colour map, the fixed scroll speed, one column
 * of pixels from the columns' levels.
 */

/** Scroll speed, CSS px a second (half of it in reduced motion). The same at any refresh rate. */
export const SCROLL = 90
export const SCROLL_CALM = 45

/**
 * Colour map, level 0..1 → RGBA: the theme's ink at an opacity that rises with the level (clear at silence, full at
 * the loudest). No hues of its own: the ink and greys rule (docs/design.md), and a dark or light page both read it.
 * `rgb` = the ink's red, green, blue (0..255). 256 steps, each one packed for a Uint32 view of RGBA pixels (little
 * endian: a, b, g, r).
 */
export function colorMap(rgb: readonly [number, number, number] = [128, 128, 128]): Uint32Array {
  const out = new Uint32Array(256)
  const [r, g, b] = rgb.map((v) => Math.min(255, Math.max(0, Math.round(v))))
  for (let i = 0; i < 256; i++) {
    // A little above linear: the quiet end stays visible against the clear.
    const a = Math.round((i / 255) ** 0.8 * 255)
    // Straight colour: putImageData takes it so.
    out[i] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
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
