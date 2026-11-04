import type { VizBanding } from '../../shared/theme/theme'
import { VIZ_BANDS, VIZ_FINE } from './vizUnpack'

/** 1/3-octave bands, folded from the frames' 1/6 (every other one a center): 31, 19.95 Hz to 19.95 kHz. */
export const THIRDS = (VIZ_BANDS + 1) / 2

/** How many bands a banding shows. */
export const bandCount = (b: VizBanding) => (b === 'third' ? THIRDS : b === 'twelfth' ? VIZ_FINE : VIZ_BANDS)

/** How many bands its frames carry: twelfths are measured so (a window twice as long), thirds are folded from sixths. */
export const framesFor = (b: VizBanding) => (b === 'twelfth' ? VIZ_FINE : VIZ_BANDS)

/**
 * 1/6-octave bands, dB, folded into 1/3 octave (`out`): band m is the sixth 2m and half of each neighbour, as powers. A
 * sine at an even sixth's center reads the same; at an odd one, on the edge of two thirds, 3 dB less in each. The two
 * end bands have one neighbour: scaled so a flat spectrum stays flat.
 */
export function toThirds(db: ArrayLike<number>, out: Float32Array): Float32Array {
  const power = (i: number) => 10 ** ((db[i] ?? -120) / 10)
  for (let m = 0; m < out.length; m++) {
    const k = 2 * m
    let sum = power(k)
    let weight = 1
    if (k > 0) {
      sum += power(k - 1) / 2
      weight += 0.5
    }
    if (k + 1 < db.length) {
      sum += power(k + 1) / 2
      weight += 0.5
    }
    out[m] = 10 * Math.log10(Math.max((sum * 2) / weight, 1e-12))
  }
  return out
}

/** Where `hz` sits across the columns, 0 (left edge) to 1 (right edge): a band's center in the middle of its share. */
export function freqAt(hz: number, banding: VizBanding): number {
  // Its 1/6-octave index: band 34 is 1 kHz, 20 bands a decade (vizUnpack.ts bandHz).
  const sixth = 34 + 20 * Math.log10(hz / 1000)
  const at = banding === 'third' ? sixth / 2 : banding === 'twelfth' ? sixth * 2 : sixth
  return (at + 0.5) / bandCount(banding)
}

/** The frequency scale shown on hover: Hz and its label. */
export const FREQ_MARKS: readonly (readonly [number, string])[] = [
  [50, '50'],
  [100, '100'],
  [200, '200'],
  [500, '500'],
  [1000, '1k'],
  [2000, '2k'],
  [5000, '5k'],
  [10000, '10k'],
]

/** The dB grid shown on hover: a band's level, as the bars read it. */
export const DB_MARKS = [-20, -40, -60] as const
