import type { VisualizerStyle, VizBanding, VizGradient, VizWeighting } from '../../shared/theme/theme'
import type { Stops } from './vizFill'
import type { LoudReading, LoudWords } from './vizLoud'
import { isSilent, type VizFrame } from './vizUnpack'

/** Messages from the page to the visualizer's worker (vizWorker.ts). Sizes are CSS px; the worker sizes the bitmap itself. */
export type ToWorker =
  | { t: 'init'; canvas: OffscreenCanvas }
  | { t: 'size'; w: number; h: number; dpr: number }
  /** `ink`: any CSS colour (the theme's text colour here); every shade is that colour with an opacity. `warn`: the VU dial's red end and lit LED. */
  /** `gradient` + `stops`: colours over the bars (vizStops.ts), laid out per look by the worker (vizFill.ts). */
  /** `bands`: 1/6 or 1/3 octave (vizBands.ts). `floor`: a glossy floor reflecting the looks that stand on the bottom edge. */
  /** `ink2`: the Curve look's right side (the accent, or the text colour when the visualizer is already the accent). `words`: the loudness meter's. */
  | { t: 'look'; look: VisualizerStyle; calm: boolean; weighting: VizWeighting; ink: string; ink2: string; warn: string; gradient: VizGradient; stops: Stops; bands: VizBanding; floor: boolean; fps: number; words: LoudWords }
  /** The loudness meter's numbers (loudFeed.ts), with each update of the levels. */
  | { t: 'loud'; v: LoudReading }
  /** The pointer over the visualizer (its frequency and dB scales shown) or gone. */
  | { t: 'hover'; on: boolean }
  /** `w`: the wave blocks, when the Oscilloscope asked for them. */
  | { t: 'frame'; l: Float32Array; r: Float32Array; rms: [number, number]; w?: [Float32Array, Float32Array] }
  /** Nothing sounds: the bars fall to rest. */
  | { t: 'silence' }
  /** Drawing on or off: off = no animation loop at all (page hidden, element off screen, visualizer off). */
  | { t: 'run'; on: boolean }

/** What a frame means to the worker: a silent one (a gap, a stalled buffer, a stop) is silence, so the loop can stop at rest. */
export const frameMessage = (f: VizFrame): ToWorker => (isSilent(f) ? { t: 'silence' } : { t: 'frame', l: f.left, r: f.right, rms: f.rms, w: f.wave })
