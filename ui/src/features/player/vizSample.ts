import { VIZ_BANDS, VIZ_FINE, VIZ_WAVE } from './vizUnpack'

/** An invented sound's frame at `t` seconds (the visualizer style's previews, Settings): a beat at 120 bpm, no audio. */
export function sampleFrame(t: number, fine = false) {
  const n = fine ? VIZ_FINE : VIZ_BANDS
  const kick = Math.exp(-7 * ((t * 2) % 1))
  const side = (shift: number) =>
    Float32Array.from({ length: n }, (_, k) => {
      const i = (k * (VIZ_BANDS - 1)) / (n - 1)
      // Falling with frequency, a bump on the beat in the lows, some grain so it isn't a smooth curve.
      return -40 - i * 0.4 + 10 * Math.sin(i * 0.3 + t + shift) + 5 * Math.sin(i * 2.3 + shift) + (i < 13 ? 24 * kick * (1 - i / 13) : 0)
    })
  const wave = (c: number) => Float32Array.from({ length: VIZ_WAVE }, (_, i) => (0.6 + 0.3 * kick) * (0.5 * Math.sin(i * 0.07 + t * 9) + 0.15 * Math.sin(i * 0.35 + c)))
  const rms: [number, number] = [-14 + 6 * kick, -15 + 6 * kick]
  return { l: side(0), r: side(0.8), rms, peak: [rms[0] + 6, rms[1] + 6] as [number, number], w: [wave(0), wave(1.4)] as [Float32Array, Float32Array] }
}
