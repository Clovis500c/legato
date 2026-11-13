import type { Dir } from './spatial'

export type PadAction = Dir | 'press' | 'back'

/** Standard-mapping buttons (the Gamepad API's "standard" layout): A, B, then the d-pad. */
const MAP: Record<number, PadAction> = { 0: 'press', 1: 'back', 12: 'up', 13: 'down', 14: 'left', 15: 'right' }
const STICK = 0.6

/** The actions of buttons newly pressed since `prev` (a held button acts once). */
export function padActions(prev: boolean[], now: boolean[]): PadAction[] {
  return now.flatMap((down, i) => (down && !prev[i] && MAP[i] ? [MAP[i]] : []))
}

/** The pad's state as booleans per standard button, the left stick (axes 0 and 1) folded onto the d-pad's four. */
export function pressed(buttons: readonly { pressed: boolean }[], axes: readonly number[]): boolean[] {
  const out = buttons.map((b) => b.pressed)
  const [x = 0, y = 0] = axes
  out[14] ||= x < -STICK
  out[15] ||= x > STICK
  out[12] ||= y < -STICK
  out[13] ||= y > STICK
  return out
}
