/** Visualizer maths (Visualizer.tsx), pure. Bars from the 16 bands of crates/dsp spectrum.rs (live.js alike). */
export const BARS = 16

/** A band's dB → bar height 0..1: -60 dB (quiet) to -6 (loud). */
export const barLevel = (db: number) => Math.min(1, Math.max(0, (db + 60) / 54))

/** Next heights: up fast, down slower (hits show, bars don't flicker). No bands = falling to rest. dt in seconds. */
export function stepBars(bars: number[], bands: number[] | undefined, dt: number): number[] {
  return bars.map((b, i) => {
    const target = bands ? barLevel(bands[i] ?? -120) : 0
    return b + (target - b) * (1 - Math.exp(-dt / (target > b ? 0.03 : 0.18)))
  })
}
