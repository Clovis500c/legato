/**
 * The veil between Home's flowing backdrop and its text (HomeView `HomeFlow`): the theme's background over the cover, `dim` per cent.
 * The base veil suits a dark cover; a bright one (on a dark theme) or a dark one (on a light theme) needs more, or the secondary
 * text (ink-2) drops under 4.5:1. Pure: the component reads the colours. No `window` here.
 */
export type Rgb = readonly [number, number, number]

/** Today's veil. */
export const BASE_DIM = 72
/** No more than this: the cover must still show. */
export const MAX_DIM = 92

const lin = (v: number) => {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const lum = (c: Rgb) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])

/** WCAG contrast of `ink` over the veiled cover (`bg` mixed in at `dim` per cent). */
export function contrastOver(cover: Rgb, bg: Rgb, dim: number, ink: Rgb): number {
  const d = dim / 100
  const under: Rgb = [bg[0] * d + cover[0] * (1 - d), bg[1] * d + cover[1] * (1 - d), bg[2] * d + cover[2] * (1 - d)]
  const [a, b] = [lum(under), lum(ink)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** The least veil, from the base up, under which `ink2` still reads at 4.5:1 over `cover` (a cover colour a notch brighter or darker than its average: a cover is not one colour). Base when a colour is unknown. */
export function homeVeil(cover: Rgb | null, bg: Rgb | null, ink2: Rgb | null): number {
  if (!cover || !bg || !ink2) return BASE_DIM
  // Worst case: the cover's average pushed 25 % toward the theme's opposite.
  const far: Rgb = bg[0] + bg[1] + bg[2] < 384 ? [Math.min(255, cover[0] * 1.25), Math.min(255, cover[1] * 1.25), Math.min(255, cover[2] * 1.25)] : [cover[0] * 0.75, cover[1] * 0.75, cover[2] * 0.75]
  for (let dim = BASE_DIM; dim <= MAX_DIM; dim++) if (contrastOver(far, bg, dim, ink2) >= 4.5) return dim
  return MAX_DIM
}

/** A CSS colour the themes write as `#rgb`, `#rrggbb` or `rgb(r g b)` / `rgb(r, g, b)`: its channels, else null. */
export function parseColor(css: string): Rgb | null {
  const s = css.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as Rgb
  }
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i.exec(s)
  return rgb ? ([+rgb[1], +rgb[2], +rgb[3]] as unknown as Rgb) : null
}
