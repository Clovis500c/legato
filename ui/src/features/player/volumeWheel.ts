// Wheel over the player = volume. Pure part: notches to steps (no store, no settings: tests import it).

/** Wheel pixels that make one step: a mouse notch (100 or 120) is one, a touchpad adds up to it. */
export const NOTCH = 100

export type WheelLike = { deltaY: number; deltaMode: number; shiftKey: boolean }

/** Pixels of a wheel event (lines and pages count as 40 and 800 px). */
export function wheelPixels(e: Pick<WheelLike, 'deltaY' | 'deltaMode'>): number {
  return e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY
}

/**
 * Volume change of one wheel event: `acc` is what earlier events left over (a touchpad sends many small ones).
 * Up (negative deltaY) raises. 1 % a step, Shift 5 %. A direction change drops the leftover.
 */
export function wheelVolume(acc: number, e: WheelLike): { delta: number; acc: number } {
  const px = wheelPixels(e)
  const sum = Math.sign(acc) === Math.sign(px) ? acc + px : px
  const steps = Math.trunc(sum / NOTCH)
  const left = sum - steps * NOTCH
  return { delta: steps ? -steps * (e.shiftKey ? 0.05 : 0.01) : 0, acc: left }
}

/** A volume plus a change, kept in 0..1 on whole percents. */
export function nudged(volume: number, delta: number): number {
  return Math.round(Math.max(0, Math.min(1, volume + delta)) * 100) / 100
}
