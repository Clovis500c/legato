// Wheel over the player = volume. Pure part: notches to steps (no store, no settings: tests import it).

/** Wheel pixels that make one step: a mouse notch (100 or 120) is one, a touchpad adds up to it. */
export const NOTCH = 100

export type WheelLike = { deltaX: number; deltaY: number; deltaMode: number; shiftKey: boolean }

/** The wheel's move. Chromium on Windows turns Shift + wheel into a sideways scroll: the notch comes in deltaX. */
export function wheelDelta(e: WheelLike): number {
  return e.deltaY || (e.shiftKey ? e.deltaX : 0)
}

/** Pixels of a wheel event (lines and pages count as 40 and 800 px). */
export function wheelPixels(e: WheelLike): number {
  const d = wheelDelta(e)
  return e.deltaMode === 1 ? d * 40 : e.deltaMode === 2 ? d * 800 : d
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
