import { VIZ_BANDS } from './vizUnpack'

/** Shapes of the visualizer (vizPaint.ts draws them), pure: columns from the bands, LED rows, the wave's path. */

/** Narrowest column, CSS px: more room = more columns, up to one per band. */
const MIN_COLUMN = 5

/** Columns for a box `w` CSS px wide. */
export const columnsFor = (w: number) => Math.min(VIZ_BANDS, Math.max(8, Math.floor(w / MIN_COLUMN)))

/** Both sides into one: the mean of their powers, per band, dB. `out` gets the result. */
export function monoDb(left: ArrayLike<number>, right: ArrayLike<number>, out: Float32Array): Float32Array {
  for (let i = 0; i < out.length; i++) {
    const p = (10 ** ((left[i] ?? -120) / 10) + 10 ** ((right[i] ?? -120) / 10)) / 2
    out[i] = 10 * Math.log10(Math.max(p, 1e-12))
  }
  return out
}

/** The bands, dB, into `out.length` columns: each column takes the loudest band of its share (at least one). */
export function toColumns(db: ArrayLike<number>, out: Float32Array): Float32Array {
  const n = out.length
  const bands = db.length
  for (let c = 0; c < n; c++) {
    const from = Math.floor((c * bands) / n)
    const to = Math.max(from + 1, Math.floor(((c + 1) * bands) / n))
    let m = -120
    for (let i = from; i < to && i < bands; i++) m = Math.max(m, db[i])
    out[c] = m
  }
  return out
}

/** Segment height target, CSS px, with its gap. */
const PITCH_CSS = 4.5

export interface LedRows {
  /** Top y and height of each segment, device px, bottom segment first. */
  y: number[]
  h: number[]
}

/** Rows of LED segments for a box `h` device px high at `dpr`: whole pixels, a gap of a fourth of the pitch. */
export function ledRows(h: number, dpr: number): LedRows {
  const segs = Math.min(64, Math.max(6, Math.round(h / (PITCH_CSS * dpr))))
  const pitch = h / segs
  const gap = Math.max(1, Math.round(pitch * 0.25))
  const y: number[] = []
  const hs: number[] = []
  for (let k = 0; k < segs; k++) {
    const top = Math.round(h - (k + 1) * pitch)
    const bottom = Math.round(h - k * pitch) - gap
    y.push(top)
    hs.push(Math.max(1, bottom - top))
  }
  return { y, h: hs }
}

/** x and width of each column, device px, whole pixels, `gap` between. */
export function columnSpans(w: number, cols: number, gap: number): { x: number[]; w: number[] } {
  const x: number[] = []
  const ws: number[] = []
  for (let i = 0; i < cols; i++) {
    const a = Math.round((i * w) / cols)
    const b = Math.round(((i + 1) * w) / cols)
    x.push(a)
    ws.push(Math.max(1, b - a - gap))
  }
  return { x, w: ws }
}

/** A smooth line through the columns' tops (w × h box, y down), closed along the bottom when `fill`; SVG path data for Path2D. */
export function wavePath(heights: ArrayLike<number>, w: number, h: number, fill: boolean): string {
  const n = heights.length
  if (!n) return ''
  const step = w / Math.max(1, n - 1)
  const pts = Array.from({ length: n }, (_, i) => [i * step, h - Math.min(1, Math.max(0, heights[i])) * h] as const)
  const r = (v: number) => Math.round(v * 10) / 10
  let d = `M${r(pts[0][0])} ${r(pts[0][1])}`
  // Midpoint curves: through the middle of each pair, bent at the points themselves.
  for (let i = 1; i < n; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    d += ` Q${r(x0)} ${r(y0)} ${r((x0 + x1) / 2)} ${r((y0 + y1) / 2)}`
  }
  const [xl, yl] = pts[n - 1]
  d += ` L${r(xl)} ${r(yl)}`
  return fill ? `${d} L${r(w)} ${h} L0 ${h} Z` : d
}
