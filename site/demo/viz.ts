// Visualizer frames with no sound: a made-up song at 120 bpm, packed as crates/dsp `viz::Frame::pack` does.

export type Frames = { onmessage: (bytes: ArrayBuffer) => void }

const HEADER = 8
/** Wave block: samples a side, 24 kHz (48 kHz, every two averaged). */
const WAVE = 512
const RATE = 24_000
const level = (db: number) => Math.max(0, Math.min(255, Math.round((db + 120) * 2)))

/** Sixth i's level (a twelfth is half a sixth: i in halves). */
function band(i: number, t: number, kick: number, snare: number, hat: number) {
  const tilt = -44 - i * 0.34
  const drift = 12 * Math.sin(i * 0.33 + t * 1.7) * Math.sin(i * 0.1 - t * 0.6)
  // Neighbours differ: no spectrum is a smooth curve.
  const grain = 7 * Math.sin(i * 2.3 + t * 5) * Math.sin(i * 1.1 - t * 3.1)
  const low = i < 13 ? 42 * kick * (1 - i / 13) : 0
  const mid = i > 22 && i < 44 ? 20 * snare : 0
  const high = i >= 44 ? 18 * hat : 0
  return tilt + drift + grain + low + mid + high
}

/**
 * Side c's sound at s seconds, for the wave blocks: an A at 110 Hz and its first harmonics, louder on the beat; the
 * fifth harmonic's phase differs between the sides, so the Vectorscope has some width.
 */
function sample(s: number, c: number) {
  const a = 2 * Math.PI * 110 * s
  // The beat's place, 0 to 1 (s may be just below 0 at the start).
  const at = (((s * 2) % 1) + 1) % 1
  const beat = 0.55 + 0.45 * Math.exp(-7 * at)
  return beat * (0.42 * Math.sin(a) + 0.12 * Math.sin(2 * a + 0.6 + c) + 0.07 * Math.sin(3 * a + 1.2) + 0.08 * Math.sin(5 * a + 2.4 * c))
}

/** 61 bands of 1/6 octave, or 121 of 1/12 (`fine`, Settings › Visualizer bands); the wave blocks after them (`wave`, the Oscilloscope). */
function frame(t: number, fine: boolean, wave: boolean) {
  const n = fine ? 121 : 61
  const step = fine ? 0.5 : 1
  const beat = (t * 2) % 1
  const kick = Math.exp(-7 * beat)
  const snare = Math.exp(-9 * ((t + 0.5) % 1))
  const hat = Math.exp(-14 * ((t * 4) % 1))
  const bytes = new Uint8Array(HEADER + 2 * n + (wave ? 4 * WAVE : 0))
  bytes.set([1, n, wave ? 1 : 0, 0, level(-20 + 9 * kick), level(-21 + 9 * kick), level(-12 + 9 * kick), level(-13 + 9 * kick)])
  for (let i = 0; i < n; i++) {
    bytes[HEADER + i] = level(band(i * step, t, kick, snare, hat))
    bytes[HEADER + n + i] = level(band(i * step, t + 0.4, kick, snare, hat))
  }
  if (wave) {
    const view = new DataView(bytes.buffer, HEADER + 2 * n)
    for (let c = 0; c < 2; c++) for (let i = 0; i < WAVE; i++) view.setInt16(2 * (c * WAVE + i), Math.round(32767 * sample(t - (WAVE - 1 - i) / RATE, c)), true)
  }
  return bytes.buffer
}

/** The engine's levels (`player_levels`) for the same song: about -11 LUFS, a beat, louder and quieter parts. */
export function levels() {
  const t = performance.now() / 1000
  const kick = Math.exp(-7 * ((t * 2) % 1))
  const part = 2.5 * Math.sin(t / 5)
  const momentary = -11.5 + part + 1.5 * kick
  return { fast: momentary + 3 * kick, momentary, short: -11.5 + part, peak: 0.5 + 0.4 * kick, gain: 0 }
}

let timer: ReturnType<typeof setInterval> | undefined

export function startFrames(frames: Frames, fine = false, wave = false) {
  clearInterval(timer)
  const from = performance.now()
  timer = setInterval(() => frames.onmessage(frame((performance.now() - from) / 1000, fine, wave)), 1000 / 60)
  return null
}

export function stopFrames() {
  clearInterval(timer)
  return null
}
