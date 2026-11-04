import type { VizGradient } from '../../shared/theme/theme'
import { type Rgb, vivid } from './ambient'
import type { Stops } from './vizFill'

/** A level meter's warm step, before the alarm red. */
const AMBER: Rgb = [240, 160, 32]
/** The prism's hues, lows to highs: red, orange, yellow, green, cyan, blue, violet. */
const PRISM = [0, 28, 52, 125, 185, 220, 270]

/** A pure hue (0..360) as RGB. */
export function hueRgb(h: number): Rgb {
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

/**
 * The visualizer gradient's colours (vizFill.ts lays them out). By level: the visualizer's own colour up to half the
 * height, amber, then the alarm red at the top, like a level meter's LEDs. Along frequency: a prism, red lows to violet
 * highs. Amber and the prism are made readable on the theme's background (`vivid`: 3:1 at least). None: no stops.
 */
export function gradientStops(kind: VizGradient, ink: string, warn: string, dark: boolean): Stops {
  if (kind === 'level') return [[0, ink], [0.55, ink], [0.8, vivid(AMBER, dark) ?? warn], [1, warn]]
  if (kind === 'frequency') return PRISM.map((h, i) => [i / (PRISM.length - 1), vivid(hueRgb(h), dark) ?? ink])
  return []
}
