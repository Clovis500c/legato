import { createFlashLimiter } from './flash'
import { atRest, CALM, levelOf, newBars, NORMAL, stepBars } from './ledBars'
import { monoDb, toColumns } from './vizDraw'
import { VIZ_BANDS } from './vizUnpack'

/**
 * What the visualizer shows at each drawn frame (runs in the worker, pure): the newest frame's bands folded into
 * columns, heights with their ballistics and held peaks, the flash limiter over the whole. `calm` = reduced motion:
 * slower and at most one flash a second (3 otherwise, always).
 */
export function createScene(columns: number, calm: boolean) {
  const bal = calm ? CALM : NORMAL
  const bars = newBars(columns)
  const mono = new Float32Array(VIZ_BANDS).fill(-120)
  const cols = new Float32Array(columns)
  const target = new Float32Array(columns)
  const shown = new Float32Array(columns)
  const flash = createFlashLimiter(calm ? 1 : 3)
  let silent = true
  let clock = 0
  return {
    /** The newest frame (both sides, dB). */
    frame(left: ArrayLike<number>, right: ArrayLike<number>) {
      monoDb(left, right, mono)
      toColumns(mono, cols)
      for (let i = 0; i < columns; i++) target[i] = levelOf(cols[i])
      silent = false
    },
    /** Nothing sounds (paused): the bars fall to rest. */
    silence() {
      silent = true
    },
    /** `dt` seconds on. `levels` and `peaks` are what to draw, valid until the next call. */
    step(dt: number) {
      clock += dt
      stepBars(bars, silent ? undefined : target, dt, bal)
      let sum = 0
      for (let i = 0; i < columns; i++) sum += bars.level[i]
      const mean = sum / columns
      const ok = flash.step(mean, clock)
      // Brightness held back (or kept up) by the limiter: the heights follow, never past the box.
      const k = mean > 0.01 ? Math.min(4, ok / mean) : 1
      for (let i = 0; i < columns; i++) shown[i] = Math.min(1, bars.level[i] * k)
      return { levels: shown, peaks: bars.peak, resting: silent && atRest(bars) }
    },
  }
}
