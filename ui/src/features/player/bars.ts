/** Visualizer maths (Visualizer.tsx), pure. Bars from the 16 bands of crates/dsp spectrum.rs (live.js alike). */
export const BARS = 16

/** A band's dB → bar height 0..1: -60 dB (quiet) to -6 (loud). */
export const barLevel = (db: number) => Math.min(1, Math.max(0, (db + 60) / 54))

/** Next heights: up fast, down slower (hits show, bars don't flicker). No bands = falling to rest. dt in seconds. */
export function stepBars(bars: number[], bands: number[] | undefined, dt: number): number[] {
  return bars.map((b, i) => {
    const target = bands ? barLevel(bands[i] ?? -120) : 0
    return b + (target - b) * (1 - Math.exp(-dt / (target > b ? 0.03 : 0.18)))
  })
}

/** Peaks style: each cap jumps to its bar and falls back at a steady pace (about a full height per 1.2 s). */
export function stepPeaks(peaks: number[], bars: number[], dt: number): number[] {
  return peaks.map((p, i) => Math.max(bars[i] ?? 0, p - dt / 1.2))
}

/** Wave style: a smooth line through the bars' tops (w × h box, y down), closed along the bottom when `fill`. */
export function wavePath(heights: number[], w: number, h: number, fill: boolean): string {
  if (!heights.length) return ''
  const step = w / Math.max(1, heights.length - 1)
  const pts = heights.map((v, i) => [i * step, h - Math.min(1, Math.max(0, v)) * h] as const)
  const r = (n: number) => Math.round(n * 10) / 10
  let d = `M${r(pts[0][0])} ${r(pts[0][1])}`
  // Midpoint curves: through the middle of each pair, bent at the points themselves.
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    d += ` Q${r(x0)} ${r(y0)} ${r((x0 + x1) / 2)} ${r((y0 + y1) / 2)}`
  }
  const [xl, yl] = pts[pts.length - 1]
  d += ` L${r(xl)} ${r(yl)}`
  return fill ? `${d} L${r(w)} ${h} L0 ${h} Z` : d
}
