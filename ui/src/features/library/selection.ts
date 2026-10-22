/**
 * Track list selection (TrackTable): rows picked by click, Ctrl+click, Shift+click and the keyboard. Pure: the table
 * keeps the state. Rows are indexes into the shown list; `ids` keeps them through a re-sort.
 */
export interface Selection {
  /** Track ids picked. */
  ids: Set<number>
  /** Row Shift extends from. */
  anchor: number | null
  /** Row the keyboard is on. */
  cursor: number | null
}

export const NONE: Selection = { ids: new Set(), anchor: null, cursor: null }

/** How a row was picked: plain (only it), toggle (Ctrl), range (Shift, from the anchor). */
export type Pick = 'only' | 'toggle' | 'range'

export function pick(sel: Selection, list: { id: number }[], index: number, how: Pick): Selection {
  const id = list[index]?.id
  if (id === undefined) return sel
  if (how === 'toggle') {
    const ids = new Set(sel.ids)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    return { ids, anchor: index, cursor: index }
  }
  if (how === 'range' && sel.anchor !== null) {
    const [a, b] = sel.anchor < index ? [sel.anchor, index] : [index, sel.anchor]
    return { ids: new Set(list.slice(a, b + 1).map((t) => t.id)), anchor: sel.anchor, cursor: index }
  }
  return { ids: new Set([id]), anchor: index, cursor: index }
}

/** Arrow keys and friends: the cursor moves; with Shift the selection follows it from the anchor. */
export function step(sel: Selection, list: { id: number }[], to: number, extend: boolean): Selection {
  if (!list.length) return sel
  const index = Math.min(list.length - 1, Math.max(0, to))
  if (extend) return pick(sel.anchor === null ? { ...sel, anchor: sel.cursor ?? index } : sel, list, index, 'range')
  return pick(sel, list, index, 'only')
}

export const all = (list: { id: number }[]): Selection => ({ ids: new Set(list.map((t) => t.id)), anchor: 0, cursor: 0 })

/** Picked tracks in list order. */
export const picked = <T extends { id: number }>(sel: Selection, list: T[]): T[] => list.filter((t) => sel.ids.has(t.id))

/** Picked rows (indexes), in list order. */
export const pickedRows = (sel: Selection, list: { id: number }[]): number[] => list.flatMap((t, i) => (sel.ids.has(t.id) ? [i] : []))
