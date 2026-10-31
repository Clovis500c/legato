import type { VisualizerStyle } from '../../shared/theme/theme'

/** Messages from the page to the visualizer's worker (vizWorker.ts). Sizes are CSS px; the worker sizes the bitmap itself. */
export type ToWorker =
  | { t: 'init'; canvas: OffscreenCanvas }
  | { t: 'size'; w: number; h: number; dpr: number }
  /** `ink`: any CSS colour (the theme's text colour here); every shade is that colour with an opacity. `warn`: the VU dial's red end and lit LED. */
  | { t: 'look'; look: VisualizerStyle; calm: boolean; ink: string; warn: string; fps: number }
  | { t: 'frame'; l: Float32Array; r: Float32Array }
  /** Nothing sounds: the bars fall to rest. */
  | { t: 'silence' }
  /** Drawing on or off: off = no animation loop at all (page hidden, element off screen, visualizer off). */
  | { t: 'run'; on: boolean }
