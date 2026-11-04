/**
 * Beats from the visualizer's frames (Visualizer v2), pure (runs in the worker). Onsets: spectral flux, how much the
 * low bands (kicks, 40 to 160 Hz) and the mids (snares, 160 Hz to 2.5 kHz, half as much) rose since the last frame in
 * dB, rises only, picked above a threshold that follows the recent strength. Tempo: the autocorrelation of that strength
 * over the last 8 s, 60 to 200 BPM, weighted toward 120 so a doubled or halved tempo loses to the likelier one.
 */

/** Strength kept for the tempo, s. */
const SPAN_S = 8
/** Strength resampled at this rate for the tempo (frames come about this often). */
const RATE = 60
/** Tempo searched, BPM. */
const MIN_BPM = 60
const MAX_BPM = 200
/** The tempo's prior: centre (BPM) and width (octaves). */
const PRIOR_BPM = 120
const PRIOR_OCTAVES = 0.9
/** No two onsets closer than this, s (a kick's tail is not a second kick). */
const REFRACTORY_S = 0.1
/** The threshold: this much over the recent mean strength (its last THRESHOLD_S), plus a floor so hiss never fires. */
const THRESHOLD_S = 0.5
const OVER = 1.5
const FLOOR = 1.5
/** The tempo needs this much history first, s. */
const WARM_S = 3

/** A frame's verdict: an onset or not, and how strong (dB of rise, low bands' mean plus half the mids'). */
export interface Onset {
  onset: boolean
  strength: number
}

/** The tempo found: BPM, and how sure (0 to 1, the normalized autocorrelation at that lag). */
export interface Tempo {
  bpm: number
  confidence: number
}

/** Band index of `hz` in frames of `count` bands (61 sixths or 121 twelfths, 1 kHz at 34 or 68). */
export function bandAt(hz: number, count: number): number {
  const per = count > 61 ? 40 : 20
  return Math.round((count > 61 ? 68 : 34) + per * Math.log10(hz / 1000))
}

export function createBeat() {
  let last: Float32Array | null = null
  let lastOnset = -Infinity
  // Strength history: times (s) and values, oldest first.
  let times: number[] = []
  let values: number[] = []

  /** Mean rise in dB of bands lo..hi (inclusive). */
  function rise(now: ArrayLike<number>, before: ArrayLike<number>, lo: number, hi: number) {
    let sum = 0
    for (let i = lo; i <= hi; i++) sum += Math.max(0, now[i] - before[i])
    return sum / (hi - lo + 1)
  }

  return {
    /** One frame's bands (dB, either side or both averaged) at `t` seconds. */
    push(bands: ArrayLike<number>, t: number): Onset {
      const n = bands.length
      const before = last
      last = Float32Array.from(bands)
      if (!before || before.length !== n) return { onset: false, strength: 0 }
      const strength = rise(bands, before, bandAt(40, n), bandAt(160, n)) + 0.5 * rise(bands, before, bandAt(160, n) + 1, bandAt(2500, n))
      // The threshold from the strength before this frame.
      let sum = 0
      let count = 0
      for (let i = times.length - 1; i >= 0 && t - times[i] <= THRESHOLD_S; i--) {
        sum += values[i]
        count++
      }
      const threshold = OVER * (count ? sum / count : 0) + FLOOR
      // A threshold needs some history: none in the first quarter second.
      const ready = times.length > 0 && t - times[0] >= THRESHOLD_S / 2
      times.push(t)
      values.push(strength)
      const keep = times.findIndex((at) => t - at <= SPAN_S)
      if (keep > 0) {
        times = times.slice(keep)
        values = values.slice(keep)
      }
      const onset = ready && strength > threshold && t - lastOnset >= REFRACTORY_S
      if (onset) lastOnset = t
      return { onset, strength }
    },
    /** The tempo of the last seconds, or null before there is enough of them or nothing repeats. */
    tempo(): Tempo | null {
      if (times.length < 2 || times[times.length - 1] - times[0] < WARM_S) return null
      // Resampled on a steady grid (frames may come unevenly), mean removed.
      const from = times[0]
      const len = Math.floor((times[times.length - 1] - from) * RATE) + 1
      const x = new Float64Array(len)
      for (let i = 0, j = 0; i < len; i++) {
        const at = from + i / RATE
        while (j < times.length - 1 && times[j + 1] <= at) j++
        x[i] = values[j]
      }
      let mean = 0
      for (const v of x) mean += v
      mean /= len
      for (let i = 0; i < len; i++) x[i] -= mean
      let energy = 0
      for (const v of x) energy += v * v
      if (energy <= 0) return null
      const corr = (lag: number) => {
        let s = 0
        for (let i = 0; i + lag < len; i++) s += x[i] * x[i + lag]
        return s / energy
      }
      const minLag = Math.floor((60 * RATE) / MAX_BPM)
      const maxLag = Math.min(len - 1, Math.ceil((60 * RATE) / MIN_BPM))
      let best = -1
      let bestScore = 0
      const r: number[] = []
      for (let lag = minLag - 1; lag <= maxLag + 1; lag++) r[lag] = corr(lag)
      for (let lag = minLag; lag <= maxLag; lag++) {
        if (r[lag] <= 0 || r[lag] < r[lag - 1] || r[lag] < r[lag + 1]) continue
        const octaves = Math.log2((60 * RATE) / lag / PRIOR_BPM) / PRIOR_OCTAVES
        const score = r[lag] * Math.exp(-0.5 * octaves * octaves)
        if (score > bestScore) {
          bestScore = score
          best = lag
        }
      }
      if (best < 0) return null
      // The peak between samples: a parabola through it and its neighbours.
      const a = r[best - 1]
      const b = r[best]
      const c = r[best + 1]
      const bend = a - 2 * b + c
      const lag = best + (bend < 0 ? (0.5 * (a - c)) / bend : 0)
      return { bpm: (60 * RATE) / lag, confidence: Math.max(0, Math.min(1, b)) }
    },
    /** A new song, a seek: nothing heard yet. */
    reset() {
      last = null
      lastOnset = -Infinity
      times = []
      values = []
    },
  }
}
