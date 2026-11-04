import { levelOf } from '../player/ledBars'
import { THIRDS, toThirds } from '../player/vizBands'
import { monoDb, toColumns } from '../player/vizDraw'
import { VIZ_BANDS, type VizFrame } from '../player/vizUnpack'

/** Bars on the streaming overlay: the 1/3-octave bands, low notes on the left. */
export const OVERLAY_BARS = THIRDS

/**
 * A frame as the overlay's bars, pure (src-tauri remote.rs sends them to the page): both sides as one, `weighs` added
 * (dB per band, vizWeigh.ts), sixths folded into thirds (twelfths: the loudest of each share), heights as the
 * visualizer's bars read them, 0 to 255.
 */
export function overlayBars(f: VizFrame, weighs: ArrayLike<number>, out = new Uint8Array(OVERLAY_BARS)): Uint8Array {
  const mono = monoDb(f.left, f.right, new Float32Array(f.left.length))
  for (let i = 0; i < mono.length; i++) mono[i] += weighs[i] ?? 0
  const cols = toColumns(mono.length === VIZ_BANDS ? toThirds(mono, new Float32Array(THIRDS)) : mono, new Float32Array(out.length))
  for (let i = 0; i < out.length; i++) out[i] = Math.round(levelOf(cols[i]) * 255)
  return out
}
