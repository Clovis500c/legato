export interface Box {
  x: number
  y: number
  w: number
  h: number
}
export type Dir = 'left' | 'right' | 'up' | 'down'

/**
 * Where the arrow key goes: of the boxes lying in that direction from the current one, the nearest, the distance across
 * counting double so the move stays in its row or column. Null = nothing that way (the focus stays). Pure: the DOM is read elsewhere.
 */
export function nextBox(boxes: Box[], from: number, dir: Dir): number | null {
  const a = boxes[from]
  if (!a) return null
  const cx = a.x + a.w / 2
  const cy = a.y + a.h / 2
  let best: number | null = null
  let bestCost = Infinity
  boxes.forEach((b, i) => {
    if (i === from) return
    const dx = b.x + b.w / 2 - cx
    const dy = b.y + b.h / 2 - cy
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy
    // Must lie ahead: its centre past the current one's edge on that side, or at least ahead by a pixel.
    if (along <= 1) return
    const across = Math.abs(dir === 'left' || dir === 'right' ? dy : dx)
    const cost = along + across * 2
    if (cost < bestCost) {
      bestCost = cost
      best = i
    }
  })
  return best
}
