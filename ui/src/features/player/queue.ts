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

/**
 * Order with `added` list indexes after the current track (play next), or after the songs the user already queued
 * there (`mine`: they play before the rest of the list, what listeners ask, docs/design.md). No `mine` (similar songs
 * added by the app): at the end.
 */
export function queued(order: number[], index: number, added: number[], next: boolean, mine?: readonly number[]): number[] {
  let at = next || mine ? order.indexOf(index) + 1 : order.length
  if (!next && mine) while (at < order.length && mine.includes(order[at])) at++
  return [...order.slice(0, at), ...added, ...order.slice(at)]
}

/** A new play order (shuffle on or off) that keeps the user's songs still to come right after the current one. */
export function keepQueued(fresh: number[], old: number[], index: number, mine: readonly number[]): number[] {
  const ahead = old.slice(old.indexOf(index) + 1).filter((i) => mine.includes(i))
  const rest = fresh.filter((i) => !ahead.includes(i))
  const at = rest.indexOf(index) + 1
  return [...rest.slice(0, at), ...ahead, ...rest.slice(at)]
}

/**
 * Next list index to try from `index` in `order`, or null at the end. auto = track ended by itself
 * (repeat one replays it; a manual skip still moves on). skip(i) = not playable here.
 */
/** Settings › Playback › Skip long songs (minutes, 0 = off): known lengths only. */
export const tooLong = (durationMs: number | null, minutes: number) => minutes > 0 && (durationMs ?? 0) > minutes * 60_000

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

/** Up next as shown: played songs, then headers over Now playing, the user's run right after it, the rest. k = row in `rows`. */
export type QueueItem = { head: 'now' | 'mine' | 'then' } | { k: number }
export function queueItems(rows: QueueRow[], mine: readonly number[]): QueueItem[] {
  const cur = rows.findIndex((r) => r.current)
  const span = (a: number, b: number): QueueItem[] => Array.from({ length: b - a }, (_, j) => ({ k: a + j }))
  if (cur < 0) return span(0, rows.length)
  let end = cur + 1
  while (end < rows.length && mine.includes(rows[end].i)) end++
  return [...span(0, cur), { head: 'now' }, { k: cur }, ...(end > cur + 1 ? [{ head: 'mine' as const }, ...span(cur + 1, end)] : []), ...(end < rows.length ? [{ head: 'then' as const }, ...span(end, rows.length)] : [])]
}

/** Order with list index `i` put at play-order position `at`, a drop slot in Up next (before what was there). */
export function moveToSlot(order: number[], i: number, at: number): number[] {
  const from = order.indexOf(i)
  if (from < 0) return order
  const out = order.filter((x) => x !== i)
  out.splice(at > from ? at - 1 : at, 0, i)
  return out
}

/** Order with `added` list indexes at play-order position `at` (songs dropped into Up next). */
export function insertAt(order: number[], added: number[], at: number): number[] {
  const k = Math.max(0, Math.min(order.length, at))
  return [...order.slice(0, k), ...added, ...order.slice(k)]
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

/** Songs still to come that are already higher in the queue (list indexes): "Remove repeats" in Up next's menu. */
export function repeatsAhead(order: number[], index: number, idOf: (i: number) => number | undefined): number[] {
  const at = order.indexOf(index)
  const seen = new Set<number>()
  return order.flatMap((i, k) => {
    const id = idOf(i)
    if (id === undefined) return []
    if (seen.has(id)) return k > at ? [i] : []
    seen.add(id)
    return []
  })
}
