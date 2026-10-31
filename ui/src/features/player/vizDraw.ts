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

/** Where the bars of the Radial look stand: the ring around the cover, mirrored left and right. */
export interface Ring {
  /** Direction of each bar (unit vector), starting at the bottom, going up both sides: first the right side's `half`, then the left's. */
  dx: Float32Array
  dy: Float32Array
  /** Inner radius and the longest bar's length, in the box's units. */
  r0: number
  len: number
}

/** Share of the half box where the bars start (the cover fills the inside, circular, a little less than that). */
export const RING_INNER = 0.7

/** Bars for a ring in a square of `side`: `half` bars on the right, from the bottom up the side, mirrored on the left. */
export function ringBars(side: number, half: number): Ring {
  const dx = new Float32Array(half * 2)
  const dy = new Float32Array(half * 2)
  for (let i = 0; i < half; i++) {
    // Low notes at the bottom, rising up both sides to meet at the top (a bar never sits on the seam).
    const a = ((i + 0.5) / half) * Math.PI
    dx[i] = Math.sin(a)
    dy[i] = Math.cos(a)
    dx[half + i] = -Math.sin(a)
    dy[half + i] = Math.cos(a)
  }
  const R = side / 2
  return { dx, dy, r0: R * RING_INNER, len: R * (1 - RING_INNER) }
}

/** Dial of one needle meter in a `w` × `h` box: the pivot, the needle's length and how far it swings either way (rad). */
export interface Dial {
  px: number
  py: number
  r: number
  swing: number
}

/**
 * A wide, low dial (the strip) is a shallow arc with its pivot far below the box; a tall one is nearer a real VU
 * face. The arc's top sits at a fifth of the height, its ends at about 62 %, the swing at most 60 degrees.
 */
export function dialGeometry(w: number, h: number): Dial {
  const half = Math.max(1, w / 2 - w * 0.08)
  const top = h * 0.2
  const sag = Math.max(1, h * 0.42)
  const swing = Math.min(Math.PI / 3, 2 * Math.atan(sag / half))
  const r = half / Math.sin(swing)
  return { px: w / 2, py: top + r, r, swing }
}

/** The circular cover's share of the ring's square, and the smallest square (CSS px) where the ring is worth drawing. */
export const RING_COVER = RING_INNER * 0.94
export const RING_MIN = 330
