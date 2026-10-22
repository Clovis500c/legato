import { useEffect } from 'react'
import { create } from 'zustand'

/**
 * Drag and drop with the pointer, not HTML5's: Tauri's window file drop (audio files, QR codes dropped on the app)
 * takes every OS drag on Windows, so HTML5 drops inside the page never fired (user's report 2026-10-22: songs couldn't
 * be dragged in Up next or playlists).
 *
 * A source starts a drag after the pointer travels a few pixels; targets are elements marked `data-drop="<id>"` with a
 * handler registered under that id (`useDropTarget`). Lists give their rows `data-slot="<index>"`: the slot is where
 * the item lands (before that row, or after it on its lower half).
 */
export type DragData = { kind: 'tracks'; ids: number[]; from?: { playlist: number; row: number } } | { kind: 'queue'; i: number } | { kind: 'home'; id: string }

export type Target = {
  accepts: (d: DragData) => boolean
  drop: (d: DragData, slot: number | null) => void
  /** Slots a list can't take (before the current song…): nearest allowed one, or null. */
  clamp?: (slot: number) => number | null
}

type DragState = { data: DragData | null; target: string | null; slot: number | null }
export const useDrag = create<DragState>(() => ({ data: null, target: null, slot: null }))

const targets = new Map<string, Target>()

/** Register a drop target for elements marked `data-drop={id}`. Null = not taking drops now. */
export function useDropTarget(id: string, target: Target | null) {
  // Latest closures every render, gone when unmounted.
  useEffect(() => {
    if (!target) return
    targets.set(id, target)
    return () => void (targets.get(id) === target && targets.delete(id))
  })
}

/** Pixels before a press becomes a drag (a click stays a click). */
const START_PX = 5
/** Near a list's edge: it scrolls, faster the closer. */
const EDGE_PX = 48

/** Slot under the pointer in the list that holds `el`: rows carry `data-slot`. */
export function slotAt(el: Element | null, y: number): number | null {
  const row = el?.closest<HTMLElement>('[data-slot]')
  if (!row) return null
  const r = row.getBoundingClientRect()
  const i = Number(row.dataset.slot)
  return y < r.top + r.height / 2 ? i : i + 1
}

/** Where `slot` lands for an item that was at `from` once it's taken out (moves within one list). */
export const landing = (from: number, slot: number) => (slot > from ? slot - 1 : slot)

/**
 * Pointer-down handler of a drag source. `data` = what's dragged (null = not draggable now), `label` = the tag under
 * the pointer. The click that ends a drag is swallowed (a dragged row doesn't also play).
 */
export function dragSource(data: () => DragData | null, label: () => string) {
  return (e: React.PointerEvent) => {
    if (e.button !== 0 || e.ctrlKey || e.shiftKey || e.metaKey) return
    if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable], [data-nodrag]')) return
    const d = data()
    if (!d) return
    const x0 = e.clientX
    const y0 = e.clientY
    let tag: HTMLElement | null = null
    let px = x0
    let py = y0
    let frame = 0

    const find = () => {
      const under = document.elementFromPoint(px, py)
      const zone = under?.closest<HTMLElement>('[data-drop]')
      const id = zone?.dataset.drop ?? null
      const t = id ? targets.get(id) : undefined
      if (!id || !t?.accepts(d)) return useDrag.setState({ target: null, slot: null })
      const raw = slotAt(under ?? null, py)
      useDrag.setState({ target: id, slot: raw === null ? null : t.clamp ? t.clamp(raw) : raw })
    }
    // Lists scroll by themselves while the pointer waits near an edge.
    const scroll = () => {
      frame = requestAnimationFrame(scroll)
      const list = document.elementFromPoint(px, py)?.closest<HTMLElement>('[data-list]')
      if (!list) return
      const r = list.getBoundingClientRect()
      const up = py - r.top
      const down = r.bottom - py
      const step = up < EDGE_PX ? -(EDGE_PX - up) / 3 : down < EDGE_PX ? (EDGE_PX - down) / 3 : 0
      if (step) {
        list.scrollTop += step
        find()
      }
    }
    const begin = () => {
      tag = document.createElement('div')
      tag.textContent = label()
      tag.setAttribute('aria-hidden', 'true')
      Object.assign(tag.style, { position: 'fixed', top: '0', left: '0', zIndex: '9999', pointerEvents: 'none', padding: '6px 12px', borderRadius: '999px', background: 'var(--ink)', color: 'var(--bg)', font: '600 13px var(--font-ui)', whiteSpace: 'nowrap', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', boxShadow: '0 8px 24px rgb(0 0 0 / 0.3)' })
      document.body.append(tag)
      document.body.classList.add('dragging')
      useDrag.setState({ data: d, target: null, slot: null })
      frame = requestAnimationFrame(scroll)
    }
    const move = (m: PointerEvent) => {
      px = m.clientX
      py = m.clientY
      if (!tag) {
        if (Math.hypot(px - x0, py - y0) < START_PX) return
        begin()
      }
      if (tag) tag.style.transform = `translate(${px + 14}px, ${py + 12}px)`
      find()
    }
    const finish = (dropIt: boolean) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', esc, true)
      cancelAnimationFrame(frame)
      if (!tag) return
      tag.remove()
      document.body.classList.remove('dragging')
      const { target, slot } = useDrag.getState()
      useDrag.setState({ data: null, target: null, slot: null })
      // The click this pointer-up makes belongs to the drag.
      const swallow = (c: MouseEvent) => {
        c.stopPropagation()
        c.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }))
      const t = target ? targets.get(target) : undefined
      if (dropIt && t) t.drop(d, slot)
    }
    const up = () => finish(true)
    const cancel = () => finish(false)
    const esc = (k: KeyboardEvent) => {
      if (k.key !== 'Escape' || !tag) return
      k.stopPropagation()
      finish(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', esc, true)
  }
}

/** Accent line where a dragged item would land in list `target`: above row `index`, or below the last one. */
export function useDropLine(target: string, index: number, last: boolean): 'above' | 'below' | null {
  return useDrag((s) => (s.target !== target || s.slot === null ? null : s.slot === index ? 'above' : last && s.slot === index + 1 ? 'below' : null))
}
