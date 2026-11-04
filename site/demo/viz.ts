// Visualizer frames with no sound: a made-up song at 120 bpm, packed as crates/dsp `viz::Frame::pack` does.

export type Frames = { onmessage: (bytes: ArrayBuffer) => void }

const BANDS = 61
const HEADER = 8
const level = (db: number) => Math.max(0, Math.min(255, Math.round((db + 120) * 2)))

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

function frame(t: number) {
  const beat = (t * 2) % 1
  const kick = Math.exp(-7 * beat)
  const snare = Math.exp(-9 * ((t + 0.5) % 1))
  const hat = Math.exp(-14 * ((t * 4) % 1))
  const bytes = new Uint8Array(HEADER + 2 * BANDS)
  bytes.set([1, BANDS, 0, 0, level(-20 + 9 * kick), level(-21 + 9 * kick), level(-12 + 9 * kick), level(-13 + 9 * kick)])
  for (let i = 0; i < BANDS; i++) {
    bytes[HEADER + i] = level(band(i, t, kick, snare, hat))
    bytes[HEADER + BANDS + i] = level(band(i, t + 0.4, kick, snare, hat))
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

export function startFrames(frames: Frames) {
  clearInterval(timer)
  const from = performance.now()
  timer = setInterval(() => frames.onmessage(frame((performance.now() - from) / 1000)), 1000 / 60)
  return null
}

export function stopFrames() {
  clearInterval(timer)
  return null
}
