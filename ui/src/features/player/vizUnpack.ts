/**
 * Visualizer frames (Visualizer v2), pure. One frame = what crates/dsp `viz::Frame::pack` and live.js `vizPack` write:
 * 8 bytes (version, band count, flags, reserved, rms L R, peak L R) + the bands left + the bands right, every dB value
 * one byte, (dB + 120) / 2 steps of 0.5 dB, 0 = -120 dB (silence). Bands are 1/6 octave (61), or 1/12 (121) when the
 * visualizer asks for twelfths (Settings › Visualizer bands), 19.95 Hz to 19.95 kHz. Flags 1: the wave blocks follow
 * (asked by the Oscilloscope look), VIZ_WAVE samples a side as i16 little-endian.
 */
export const VIZ_BANDS = 61
export const VIZ_FINE = 121
/** Samples a side in a wave block: the last 1024, every two averaged (21 ms at 48 kHz). */
export const VIZ_WAVE = 512
export const VIZ_FORMAT = 1
const HEADER = 8

export interface VizFrame {
  /** Window level per side, dB (0 = full scale; a full-scale sine reads -3). */
  rms: [number, number]
  /** Peak since the last frame per side, dB. */
  peak: [number, number]
  /** Band levels per side, dB (a sine of amplitude 1 in a band reads 0). */
  left: Float32Array
  right: Float32Array
  /** The wave blocks when asked: VIZ_WAVE samples a side, -1 to 1. */
  wave?: [Float32Array, Float32Array]
}

/** Band center among `n` bands, Hz: 1 kHz is band 34 (68 in twelfths), 20 bands a decade (40). */
export const bandHz = (i: number, n = VIZ_BANDS) => 1000 * 10 ** ((i - ((n - 1) * 17) / 30) / ((n - 1) / 3))

const db = (q: number) => q / 2 - 120

/** A frame from its bytes, or null if they are not one (wrong size, version or band count). */
export function unpackViz(bytes: Uint8Array): VizFrame | null {
  const n = bytes[1]
  const waves = (bytes[2] & 1) === 1
  if ((n !== VIZ_BANDS && n !== VIZ_FINE) || bytes.length !== HEADER + 2 * n + (waves ? 4 * VIZ_WAVE : 0) || bytes[0] !== VIZ_FORMAT) return null
  const side = (from: number) => Float32Array.from({ length: n }, (_, i) => db(bytes[from + i]))
  const frame: VizFrame = { rms: [db(bytes[4]), db(bytes[5])], peak: [db(bytes[6]), db(bytes[7])], left: side(HEADER), right: side(HEADER + n) }
  if (waves) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + HEADER + 2 * n, 4 * VIZ_WAVE)
    const wave = (c: number) => Float32Array.from({ length: VIZ_WAVE }, (_, i) => view.getInt16(2 * (c * VIZ_WAVE + i), true) / 32767)
    frame.wave = [wave(0), wave(1)]
  }
  return frame
}

/** Bytes from what a channel hands over (an ArrayBuffer; a number array if the transport ever sends JSON). */
export function toBytes(x: unknown): Uint8Array | null {
  if (x instanceof ArrayBuffer) return new Uint8Array(x)
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength)
  if (Array.isArray(x) && x.every((v) => Number.isInteger(v) && v >= 0 && v < 256)) return Uint8Array.from(x)
  return null
}

/** live.js sends frames as base64 text (its postMessage carries text only). */
export function fromBase64(text: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

export const silentViz = (n = VIZ_BANDS): VizFrame => ({ rms: [-120, -120], peak: [-120, -120], left: new Float32Array(n).fill(-120), right: new Float32Array(n).fill(-120) })

/** Nothing sounds: every level at the floor. */
export const isSilent = (f: VizFrame) => f.rms[0] === -120 && f.rms[1] === -120 && f.left.every((v) => v === -120) && f.right.every((v) => v === -120)
