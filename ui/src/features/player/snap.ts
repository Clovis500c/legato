import { SPOTS, type Spot } from '../../shared/theme/theme'

export interface Size {
  w: number
  h: number
}
export interface Point {
  x: number
  y: number
}
/** Space kept free around the card: title bar on top, player bar at the bottom. */
export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

/** YouTube's minimum player is 200 px tall: at 16:9 that's 356 px wide. */
export const MIN_WIDTH = 356
export const maxWidth = (view: Size) => Math.max(MIN_WIDTH, Math.min(960, Math.round(view.w * 0.6)))
export const clampWidth = (w: number, view: Size) => Math.round(Math.min(maxWidth(view), Math.max(MIN_WIDTH, w)))

/** Top-left corner of a card of `card` size resting at `spot`. */
export function spotPosition(spot: Spot, view: Size, card: Size, inset: Insets): Point {
  const col = spot.includes('l') ? 'l' : spot.includes('r') ? 'r' : 'c'
  const row = spot.startsWith('t') ? 't' : spot.startsWith('b') ? 'b' : 'm'
  const right = view.w - inset.right - card.w
  const bottom = view.h - inset.bottom - card.h
  const x = col === 'l' ? inset.left : col === 'r' ? right : (inset.left + right) / 2
  const y = row === 't' ? inset.top : row === 'b' ? bottom : (inset.top + bottom) / 2
  // Card bigger than the free space: keep its top-left on screen.
  return { x: Math.round(Math.max(inset.left, x)), y: Math.round(Math.max(inset.top, y)) }
}

/**
 * Spot the card settles in after a drag: the one nearest to where it was heading. velocity = px/ms of the last
 * pointer moves; a flick carries it about 150 ms further, like a thrown picture-in-picture.
 */
export function nearestSpot(topLeft: Point, velocity: Point, view: Size, card: Size, inset: Insets): Spot {
  const at = { x: topLeft.x + velocity.x * 150, y: topLeft.y + velocity.y * 150 }
  let best: Spot = 'br'
  let dist = Infinity
  for (const s of SPOTS) {
    const p = spotPosition(s, view, card, inset)
    const d = (p.x - at.x) ** 2 + (p.y - at.y) ** 2
    if (d < dist) [best, dist] = [s, d]
  }
  return best
}

/** Resize grip sits on the corner facing the middle of the window; dx > 0 = pointer moved right. */
export function gripCorner(spot: Spot): { left: boolean; top: boolean } {
  return { left: spot.includes('r'), top: !spot.startsWith('t') }
}

/** New width after dragging the grip by dx. Centered cards grow on both sides. */
export function resized(start: number, dx: number, spot: Spot, view: Size): number {
  const centered = !spot.includes('l') && !spot.includes('r')
  const dir = gripCorner(spot).left ? -1 : 1
  return clampWidth(start + dx * dir * (centered ? 2 : 1), view)
}
