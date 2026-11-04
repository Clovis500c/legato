/**
 * The song's shape on the seek bar (Settings › Appearance › Progress bar › Song's shape), pure: the engine's points
 * (`music_player::shape`, 0 to 255 along a local song) as bars a few pixels apart, drawn as one SVG path.
 */

/** Bars across the seek bar. */
export const SHAPE_BARS = 120
/** A silent stretch still shows: its bars this tall (of the full height). */
const MIN_BAR = 0.12

/** `count` bar heights, 0 to 1: the loudest point under each bar. Empty without points. */
export function shapeBars(points: ArrayLike<number>, count = SHAPE_BARS): number[] {
  const n = points.length
  if (!n) return []
  return Array.from({ length: count }, (_, i) => {
    const a = Math.floor((i * n) / count)
    const b = Math.max(a + 1, Math.floor(((i + 1) * n) / count))
    let top = 0
    for (let j = a; j < b && j < n; j++) top = Math.max(top, points[j])
    return Math.max(MIN_BAR, top / 255)
  })
}

/** The bars as one path in a box `count` wide and `h` high, each 0.6 wide, centred on its slot and on the middle line. */
export function shapePath(heights: number[], h: number): string {
  return heights.map((v, i) => `M${(i + 0.2).toFixed(1)} ${((h * (1 - v)) / 2).toFixed(2)}h0.6v${(h * v).toFixed(2)}h-0.6z`).join('')
}
