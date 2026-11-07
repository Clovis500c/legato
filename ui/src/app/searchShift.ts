/**
 * How far (px) to move the top bar's search so its middle sits on `target` (the window's middle). Clamped so the bar
 * stays inside its box (never over the logo or the window buttons).
 */
export function searchShift(target: number, box: { left: number; width: number }, bar: number): number {
  const room = Math.max(0, (box.width - bar) / 2)
  return Math.round(Math.min(room, Math.max(-room, target - (box.left + box.width / 2)))) || 0
}
