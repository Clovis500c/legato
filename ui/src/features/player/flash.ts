/**
 * Flash limiter (comfort), pure. A flash is a rise and a fall of the screen's brightness by at least `STEP` (10 % of its
 * range, what WCAG counts). The visualizer feeds its mean brightness (0..1) once per frame; at most `maxPerSec` flashes
 * (two opposing swings each) happen in any second of what comes out: past that budget the output may not turn back by
 * `STEP`, it stays near its last extreme until older swings age out. Slow changes never count.
 */
export const STEP = 0.1

export function createFlashLimiter(maxPerSec = 3) {
  const swings: number[] = []
  let dir = 0
  // Last turning point of the output (the extreme of the swing under way).
  let extreme = 0
  let out = 0
  return {
    /** The brightness to show for `x` at time `t` (s, rising). */
    step(x: number, t: number): number {
      while (swings.length && swings[0] <= t - 1) swings.shift()
      let y = x
      if (swings.length >= 2 * maxPerSec) {
        // Budget spent: moving on in the swing's direction is fine, turning back by STEP is not.
        const margin = STEP * 0.9
        if (dir >= 0) y = Math.max(x, extreme - margin)
        if (dir <= 0) y = Math.min(x, extreme + margin)
        if (dir > 0 && y > extreme) extreme = y
        if (dir < 0 && y < extreme) extreme = y
        out = y
        return y
      }
      if (dir === 0) {
        if (Math.abs(y - extreme) >= STEP) {
          dir = y > extreme ? 1 : -1
          swings.push(t)
          extreme = y
        }
      } else if (dir > 0) {
        if (y > extreme) extreme = y
        else if (extreme - y >= STEP) {
          dir = -1
          swings.push(t)
          extreme = y
        }
      } else if (y < extreme) extreme = y
      else if (y - extreme >= STEP) {
        dir = 1
        swings.push(t)
        extreme = y
      }
      out = y
      return y
    },
    /** The last output. */
    get last() {
      return out
    },
  }
}

/** Swings of at least `STEP` in a series (fixed rate `fps`): the most inside any second. For tests and tuning. */
export function swingsPerSecond(series: ArrayLike<number>, fps: number): number {
  const times: number[] = []
  let dir = 0
  let extreme = series[0] ?? 0
  for (let i = 1; i < series.length; i++) {
    const y = series[i]
    const turned = dir === 0 ? Math.abs(y - extreme) >= STEP : Math.abs(y - extreme) >= STEP && (dir > 0 ? y < extreme : y > extreme)
    if (turned) {
      dir = dir === 0 ? (y > extreme ? 1 : -1) : -dir
      times.push(i / fps)
      extreme = y
    } else if (dir > 0 ? y > extreme : dir < 0 ? y < extreme : false) extreme = y
  }
  let most = 0
  for (let a = 0, b = 0; b < times.length; b++) {
    // A second is half open (a swing exactly one second after another is outside it); the sums of 1/60 may be off a hair.
    while (times[b] - times[a] >= 1 - 1e-6) a++
    most = Math.max(most, b - a + 1)
  }
  return most
}
