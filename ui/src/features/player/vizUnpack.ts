/**
 * Visualizer frames (Visualizer v2), pure. One frame = what crates/dsp `viz::Frame::pack` and live.js `vizPack` write:
 * 8 bytes (version, band count, 2 reserved, rms L R, peak L R) + 61 bands left + 61 bands right, every dB value one byte,
 * (dB + 120) / 2 steps of 0.5 dB, 0 = -120 dB (silence). Bands are 1/6 octave, 19.95 Hz to 19.95 kHz.
 */
export const VIZ_BANDS = 61
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
}

/** Band center, Hz: 1 kHz · 10^((i - 34) / 20). */
export const bandHz = (i: number) => 1000 * 10 ** ((i - 34) / 20)

const db = (q: number) => q / 2 - 120

/** A frame from its bytes, or null if they are not one (wrong size, version or band count). */
export function unpackViz(bytes: Uint8Array): VizFrame | null {
  if (bytes.length !== HEADER + 2 * VIZ_BANDS || bytes[0] !== VIZ_FORMAT || bytes[1] !== VIZ_BANDS) return null
  const side = (from: number) => Float32Array.from({ length: VIZ_BANDS }, (_, i) => db(bytes[from + i]))
  return { rms: [db(bytes[4]), db(bytes[5])], peak: [db(bytes[6]), db(bytes[7])], left: side(HEADER), right: side(HEADER + VIZ_BANDS) }
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

export const silentViz = (): VizFrame => ({ rms: [-120, -120], peak: [-120, -120], left: new Float32Array(VIZ_BANDS).fill(-120), right: new Float32Array(VIZ_BANDS).fill(-120) })

/** Nothing sounds: every level at the floor. */
export const isSilent = (f: VizFrame) => f.rms[0] === -120 && f.rms[1] === -120 && f.left.every((v) => v === -120) && f.right.every((v) => v === -120)
