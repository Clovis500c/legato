import type { VizWeighting } from '../../shared/theme/theme'
import { bandHz, VIZ_BANDS } from './vizUnpack'

/**
 * Visualizer weighting, pure: dB added to each band before the columns (vizScene.ts). The bands are energies (pink
 * noise reads flat), so music's lows stand taller than its highs; the tilt lifts the highs 3 dB per octave around
 * 1 kHz, the A and ITU-R 468 curves weigh by what the ear hears (both 0 dB at 1 kHz).
 */
export function weightsOf(kind: VizWeighting): Float32Array {
  const at = kind === 'tilt' ? tilt : kind === 'a' ? aWeight : kind === 'itu468' ? itu468 : () => 0
  return Float32Array.from({ length: VIZ_BANDS }, (_, i) => at(bandHz(i)))
}

const tilt = (f: number) => 3 * Math.log2(f / 1000)

/** IEC 61672 A-weighting, dB. */
export function aWeight(f: number): number {
  const f2 = f * f
  const r = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2))
  return 20 * Math.log10(r) + 2
}

/** ITU-R BS.468-4 weighting, dB: +12.2 at 6.3 kHz, steep below and above. */
export function itu468(f: number): number {
  const h1 = -4.737338981378384e-24 * f ** 6 + 2.043828333606125e-15 * f ** 4 - 1.363894795463638e-7 * f ** 2 + 1
  const h2 = 1.306612257412824e-19 * f ** 5 - 2.118150887518656e-11 * f ** 3 + 5.559488023498642e-4 * f
  return 18.2 + 20 * Math.log10((1.246332637532143e-4 * f) / Math.hypot(h1, h2))
}
