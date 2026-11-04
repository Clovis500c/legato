import type { Rgb } from './ambient'

/** Hue slices the colours are sorted into. */
const SLICES = 12
/** A slice counts from this share of the biggest one's weight. */
const MIN_SHARE = 0.08
/** Two colours closer than this (RGB distance) are one. */
const SAME = 48

/**
 * Up to `count` colours of a picture (RGBA bytes, small: a cover drawn at 24 px), the most present first: its colourful
 * pixels sorted by hue into 12 slices, weighted by how colourful they are, each slice's mean colour. Greys, black and
 * white are left out: none for a grey picture.
 */
export function paletteOf(data: ArrayLike<number>, count = 4): Rgb[] {
  const sums = Array.from({ length: SLICES }, () => [0, 0, 0, 0])
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const chroma = (max - min) / 255
    if (chroma < 0.12 || max < 30 || data[i + 3] < 128) continue
    const d = max - min
    const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    const s = sums[Math.min(SLICES - 1, Math.floor((h / 6) * SLICES))]
    s[0] += r * chroma
    s[1] += g * chroma
    s[2] += b * chroma
    s[3] += chroma
  }
  const ranked = sums.filter((s) => s[3] > 0).sort((a, b) => b[3] - a[3])
  const out: Rgb[] = []
  for (const s of ranked) {
    if (out.length >= count || s[3] < ranked[0][3] * MIN_SHARE) break
    const rgb: Rgb = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]
    if (out.every((o) => Math.hypot(o[0] - rgb[0], o[1] - rgb[1], o[2] - rgb[2]) >= SAME)) out.push(rgb)
  }
  return out
}
