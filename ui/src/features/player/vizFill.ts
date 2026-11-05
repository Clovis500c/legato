import type { VisualizerStyle, VizGradient } from '../../shared/theme/theme'

/** A gradient's colours, 0..1 along its axis: from the bottom up (by level) or from the lows to the highs. */
export type Stops = [number, string][]

/** Where a gradient lies on the canvas (device px), with its stops there. */
export type Fill =
  | { kind: 'linear'; x0: number; y0: number; x1: number; y1: number; stops: Stops }
  | { kind: 'radial'; x: number; y: number; r0: number; r1: number; stops: Stops }
  | { kind: 'conic'; x: number; y: number; start: number; stops: Stops }

const sorted = (stops: Stops) => stops.sort((a, b) => a[0] - b[0])
/** The axis' start in the middle, its end at both ends. */
const outward = (stops: Stops): Stops => sorted(stops.flatMap(([p, c]): Stops => [[0.5 - p / 2, c], [0.5 + p / 2, c]]))
/** The axis' start at both ends, its end in the middle. */
const inward = (stops: Stops): Stops => sorted(stops.flatMap(([p, c]): Stops => [[p / 2, c], [1 - p / 2, c]]))

/**
 * The gradient laid over a look's bars (`source-atop`: their shapes and opacities, its colours). By level: from the
 * bottom up, from the middle out for the mirror, from the cover out for the ring. Along frequency: left to right; the
 * ring's lows sit at the bottom and rise up both sides (`ringBars`), so clockwise from the bottom, up and back down.
 * Particles, VU and PPM needles, the spectrogram, the terrain, a plugin's look, the oscilloscope, the vectorscope and the loudness meter keep their own
 * colours: null, like no gradient.
 */
export function fillFor(kind: VizGradient, look: VisualizerStyle, W: number, H: number, stops: Stops, ring?: { r0: number; len: number }): Fill | null {
  if (kind === 'none' || stops.length < 2 || look === 'particles' || look === 'vu' || look === 'ppm' || look === 'spectrogram' || look === 'terrain' || look === 'plugin' || look === 'scope' || look === 'vectorscope' || look === 'loudness') return null
  if (look === 'radial') {
    if (!ring) return null
    const at = { x: W / 2, y: H / 2 }
    return kind === 'level' ? { kind: 'radial', ...at, r0: ring.r0, r1: ring.r0 + ring.len, stops } : { kind: 'conic', ...at, start: Math.PI / 2, stops: inward(stops) }
  }
  if (kind === 'frequency') return { kind: 'linear', x0: 0, y0: 0, x1: W, y1: 0, stops }
  return look === 'mirror' ? { kind: 'linear', x0: 0, y0: 0, x1: 0, y1: H, stops: outward(stops) } : { kind: 'linear', x0: 0, y0: H, x1: 0, y1: 0, stops }
}
