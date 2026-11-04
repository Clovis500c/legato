/**
 * The loudness meter's numbers (the Loudness meter look), pure. EBU R128 over what the meter heard of the song, from the
 * levels Adaptive Sound already measures (live.ts: momentary loudness, K-weighted over 400 ms, and the true peak), one
 * value every 100 ms of play. Short-term = the last 3 s of them; integrated = all of them, gated at -70 LUFS then 10 LU
 * under their mean (BS.1770); loudness range = the short-term values, gated at -70 then 20 LU under their mean, 10th to
 * 95th percentile (EBU Tech 3342). Histograms of 0.1 LU: a three-hour mix costs what a song does.
 */

/** One value per this much play, ms. */
export const LOUD_STEP_MS = 100
/** Most play one update may count, ms: a stalled window or a hidden page adds no run of the same value. */
const MAX_GAP_MS = 250
/** Values in a short-term window (3 s). */
const SHORT_N = 30
const GATE = -70
const BIN = 0.1
/** -70 to +10 LUFS. */
const BINS = 800

/** The bars' scale, LUFS (and dBTP for the peak): music sits in the top half. */
export const LOUD_MIN = -48
export const LOUD_MAX = 0
/** Marks along the scale. */
export const LOUD_MARKS = [-48, -42, -36, -30, -24, -18, -12, -6, 0]

export interface LoudReading {
  /** LUFS; -120 = silence. */
  momentary: number
  short: number
  /** null until a value passes the gates. */
  integrated: number | null
  /** LU; null until a full 3 s window. */
  range: number | null
  /** True peak (BS.1770-4: 4x oversampled, both twins), dBTP: now (falling about 20 dB a second), the song's highest so far. */
  peak: number
  top: number
}

/** The meter's words, in the interface's language (the worker has no translations). */
export interface LoudWords {
  momentary: string
  short: string
  integrated: string
  range: string
  peak: string
}

export const LOUD_WORDS: LoudWords = { momentary: 'Momentary', short: 'Short-term', integrated: 'Integrated', range: 'Loudness range', peak: 'True peak' }

const power = (lufs: number) => 10 ** ((lufs + 0.691) / 10)
const lufsOf = (p: number) => (p > 0 ? -0.691 + 10 * Math.log10(p) : -120)
const dbfs = (x: number) => (x > 1e-6 ? 20 * Math.log10(x) : -120)
const floor = (v: number) => (Number.isFinite(v) ? Math.max(-120, v) : -120)

/** Values over -70 LUFS by 0.1 LU, with their powers: the gates' means stay exact, only the gates move by a bin. */
function histogram() {
  const count = new Float64Array(BINS)
  const sum = new Float64Array(BINS)
  let n = 0
  let total = 0
  /** First bin whose middle is over `gate`. */
  const over = (gate: number) => Math.max(0, Math.min(BINS, Math.floor((gate - GATE) / BIN - 0.5) + 1))
  return {
    add(l: number) {
      if (!(l > GATE)) return
      const p = power(l)
      const b = Math.min(BINS - 1, Math.floor((l - GATE) / BIN))
      count[b]++
      sum[b] += p
      n++
      total += p
    },
    /** The mean of the values within `rel` LU of the mean of all, LUFS; null when none. */
    gated(rel: number): number | null {
      if (!n) return null
      let c = 0
      let s = 0
      for (let b = over(lufsOf(total / n) + rel); b < BINS; b++) {
        c += count[b]
        s += sum[b]
      }
      return c ? lufsOf(s / c) : null
    },
    /** 95th minus 10th percentile of the values within `rel` LU of the mean of all, LU; null when none. */
    spread(rel: number): number | null {
      if (!n) return null
      const first = over(lufsOf(total / n) + rel)
      let c = 0
      for (let b = first; b < BINS; b++) c += count[b]
      if (!c) return null
      const at = (q: number) => {
        let k = 0
        for (let b = first; b < BINS; b++) {
          k += count[b]
          if (k >= q * c) return b
        }
        return BINS - 1
      }
      return (at(0.95) - at(0.1)) * BIN
    },
    clear() {
      count.fill(0)
      sum.fill(0)
      n = 0
      total = 0
    },
  }
}

export function createLoudness() {
  const blocks = histogram()
  const shorts = histogram()
  // The last 3 s of momentary powers, a ring.
  const ring = new Float64Array(SHORT_N)
  let at = 0
  let filled = 0
  let due = 0
  let momentary = -120
  let short = -120
  let peak = -120
  let top = -120

  function take(m: number) {
    ring[at] = power(m)
    at = (at + 1) % SHORT_N
    filled = Math.min(SHORT_N, filled + 1)
    blocks.add(m)
    // Summed afresh: 30 values, no drift. Until 3 s are heard, the mean of what was (the native meter's way).
    let s = 0
    for (let i = 0; i < filled; i++) s += ring[i]
    short = lufsOf(s / filled)
    if (filled === SHORT_N) shorts.add(short)
  }

  return {
    /** Levels just in, `ms` of play since the last ones: 0 while paused (shown, not counted). */
    push(l: { momentary: number; peak: number }, ms: number) {
      momentary = floor(l.momentary)
      peak = dbfs(l.peak)
      top = Math.max(top, peak)
      due += Math.min(MAX_GAP_MS, Math.max(0, ms))
      while (due >= LOUD_STEP_MS) {
        due -= LOUD_STEP_MS
        take(momentary)
      }
    },
    reading(): LoudReading {
      return { momentary, short, integrated: blocks.gated(-10), range: shorts.spread(-20), peak, top }
    },
    /** A new song. */
    reset() {
      blocks.clear()
      shorts.clear()
      ring.fill(0)
      at = filled = due = 0
      momentary = short = peak = top = -120
    },
  }
}

/** Where a level sits along the bars, 0..1. */
export const loudPos = (v: number | null) => (v === null ? 0 : Math.min(1, Math.max(0, (v - LOUD_MIN) / (LOUD_MAX - LOUD_MIN))))

/** A level as the meter writes it: one decimal, a real minus sign; a dash for nothing or silence. */
export function loudText(v: number | null): string {
  if (v === null || !(v > GATE)) return '—'
  const t = Math.abs(v).toFixed(1)
  return v <= -0.05 ? `−${t}` : t
}
