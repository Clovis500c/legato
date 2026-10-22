/** Off, whole queue again, or current track again. */
export type Repeat = 'off' | 'all' | 'one'

/** Play order over list indexes. Shuffle: current first, the rest in random order (Fisher–Yates). */
export function playOrder(n: number, current: number, shuffle: boolean, rand = Math.random): number[] {
  const all = Array.from({ length: n }, (_, i) => i)
  if (!shuffle) return all
  const rest = all.filter((i) => i !== current)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return current >= 0 && current < n ? [current, ...rest] : rest
}

/** Order with `added` list indexes after the current track (play next) or at the end. */
export function queued(order: number[], index: number, added: number[], next: boolean): number[] {
  const at = next ? order.indexOf(index) + 1 : order.length
  return [...order.slice(0, at), ...added, ...order.slice(at)]
}

/**
 * Next list index to try from `index` in `order`, or null at the end. auto = track ended by itself
 * (repeat one replays it; a manual skip still moves on). skip(i) = not playable here.
 */
export function nextIndex(order: number[], index: number, delta: 1 | -1, repeat: Repeat, auto: boolean, skip: (i: number) => boolean = () => false): number | null {
  if (auto && repeat === 'one') return index
  const at = order.indexOf(index)
  for (let k = 1; k <= order.length; k++) {
    let pos = at + delta * k
    if (pos < 0 || pos >= order.length) {
      if (repeat === 'off') return null
      pos = (pos + order.length) % order.length
    }
    if (!skip(order[pos])) return order[pos]
  }
  return null
}

/** One row of the queue panel. i = list index (-1: dropped file, `path`). */
export interface QueueRow {
  key: string
  i: number
  played: boolean
  current: boolean
  path?: string
}

/** Queue panel rows in play order: played ones before the current, then what's next. Unplayable ones left out. */
export function queueRows(order: number[], index: number, playable: (i: number) => boolean): QueueRow[] {
  const at = order.indexOf(index)
  return order.flatMap((i, k) => (k === at || playable(i) ? [{ key: String(i), i, played: at >= 0 && k < at, current: k === at }] : []))
}

/** Order with list index `i` moved to where `j` is (dragged in Up next): before it going up, after it going down. */
export function moveInOrder(order: number[], i: number, j: number): number[] {
  const from = order.indexOf(i)
  const to = order.indexOf(j)
  if (from < 0 || to < 0 || from === to) return order
  const out = order.filter((x) => x !== i)
  out.splice(to, 0, i)
  return out
}
