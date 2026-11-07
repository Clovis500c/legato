import { CaretLeft, CaretRight, Check } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { tr } from '../i18n/i18n'
import { usePhone } from '../phone'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect?: () => void
  disabled?: boolean
  danger?: boolean
  /** Toggle item: check mark when true, empty slot when false. */
  checked?: boolean
  /** Submenu. */
  items?: MenuEntry[]
}
/** '-' = separator. Falsy entries are dropped (conditional items inline). */
export type MenuEntry = MenuItem | '-' | false | '' | 0 | null | undefined

/** anchor: what the menu was opened on; a scroll that doesn't move it (synced lyrics going on) leaves the menu open. */
const useMenu = create<{ at: { x: number; y: number; up?: boolean } | null; items: MenuEntry[]; anchor?: Element }>(() => ({ at: null, items: [] }))
export const closeMenu = () => useMenu.setState({ at: null })
export const menuOpen = () => useMenu.getState().at !== null

/** place: pinned to the clicked control instead of the pointer. 'above' for buttons at the window's foot (player bar), 'below' for dropdowns. */
export function openMenu(e: MouseEvent | React.MouseEvent, items: MenuEntry[], { place }: { place?: 'above' | 'below' } = {}) {
  e.preventDefault()
  e.stopPropagation()
  if (place && e.currentTarget instanceof Element) return openMenuAt(e.currentTarget, items, place)
  let [x, y] = [e.clientX, e.clientY]
  // Menu key / Shift+F10: no pointer position, open under the focused element.
  if (!x && !y && e.target instanceof Element) {
    const r = e.target.getBoundingClientRect()
    ;[x, y] = [r.left + 8, r.bottom]
  }
  useMenu.setState({ at: { x, y }, items, anchor: e.target instanceof Element ? e.target : undefined })
}

/** Pinned to a control, e.g. once items asked on its click have come. */
export function openMenuAt(el: Element, items: MenuEntry[], place: 'above' | 'below') {
  const r = el.getBoundingClientRect()
  useMenu.setState({ at: place === 'above' ? { x: r.left, y: r.top - 6, up: true } : { x: r.left, y: r.bottom + 6 }, items, anchor: el })
}

/** onContextMenu handler; items built when the menu opens (fresh state). */
export const onMenu = (items: () => MenuEntry[]) => (e: React.MouseEvent) => openMenu(e, items())

/** Drops falsy entries and stray separators. */
export function tidy(items: MenuEntry[]): (MenuItem | '-')[] {
  const out: (MenuItem | '-')[] = []
  for (const i of items) {
    if (!i || (i === '-' && (!out.length || out[out.length - 1] === '-'))) continue
    out.push(i)
  }
  if (out[out.length - 1] === '-') out.pop()
  return out
}

const ITEM = ':scope > button[role=menuitem]:not(:disabled)'

function Panel({ items, x, y, up, anchor, focusFirst, onBack }: { items: MenuEntry[]; x: number; y: number; up?: boolean; anchor?: DOMRect; focusFirst: boolean; onBack?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [sub, setSub] = useState<{ i: number; rect: DOMRect; keyboard: boolean } | null>(null)
  const list = tidy(items)

  // Fit in the window; submenus open on the right, or on the left when there's no room.
  useLayoutEffect(() => {
    const el = ref.current!
    // Layout size: pop-in starts scaled to 96 %, a measured box came out short and the menu ran past the window's foot.
    const [w, h] = [el.offsetWidth, el.offsetHeight]
    let left = anchor ? anchor.right - 4 : x
    if (left + w > innerWidth - 4) left = anchor ? anchor.left - w + 4 : innerWidth - w - 4
    el.style.left = `${Math.max(4, left)}px`
    el.style.top = `${Math.max(4, Math.min(anchor ? anchor.top - 6 : up ? y - h : y, innerHeight - h - 4))}px`
    el.style.visibility = 'visible'
    if (focusFirst) el.querySelector<HTMLElement>(ITEM)?.focus()
  }, [x, y, up, anchor, focusFirst])

  const move = (d: 1 | -1) => {
    const all = [...ref.current!.querySelectorAll<HTMLElement>(ITEM)]
    const at = all.indexOf(document.activeElement as HTMLElement)
    all[(at + d + all.length) % all.length]?.focus()
  }

  return (
    <div
      ref={ref}
      role="menu"
      data-menu
      style={{ visibility: 'hidden' }}
      onKeyDown={(e) => {
        const key = e.key
        if (key === 'ArrowDown' || key === 'ArrowUp') move(key === 'ArrowDown' ? 1 : -1)
        else if (key === 'ArrowLeft' && onBack) onBack()
        else if (key === 'Escape') closeMenu()
        else return
        e.preventDefault()
        e.stopPropagation()
      }}
      className="pop-in fixed z-50 flex max-h-[80vh] min-w-56 flex-col overflow-x-hidden overflow-y-auto rounded-xl border border-line bg-raised p-1.5 text-ink shadow-[0_12px_32px_var(--shadow)]"
    >
      {list.map((it, i) =>
        it === '-' ? (
          <div key={i} role="separator" className="mx-2 my-1 h-px shrink-0 bg-line-soft" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            aria-haspopup={it.items ? 'menu' : undefined}
            aria-expanded={it.items ? sub?.i === i : undefined}
            aria-checked={it.checked}
            onPointerEnter={(e) => {
              e.currentTarget.focus()
              setSub(it.items ? { i, rect: e.currentTarget.getBoundingClientRect(), keyboard: false } : null)
            }}
            onKeyDown={(e) => {
              if (it.items && (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                e.stopPropagation()
                setSub({ i, rect: e.currentTarget.getBoundingClientRect(), keyboard: true })
              }
            }}
            onClick={(e) => {
              if (it.items) return setSub({ i, rect: e.currentTarget.getBoundingClientRect(), keyboard: false })
              closeMenu()
              it.onSelect?.()
            }}
            className={`flex h-9 w-full shrink-0 items-center gap-3 rounded-lg px-2.5 text-left text-[0.8125rem] outline-none focus:bg-panel disabled:opacity-40 ${it.danger ? 'text-danger' : ''}`}
          >
            <span className={`grid w-5 shrink-0 place-items-center ${it.danger ? '' : 'text-ink-2'}`}>{it.checked !== undefined ? it.checked && <Check size={15} weight="bold" /> : it.icon}</span>
            <span className="flex-1 truncate">{it.label}</span>
            {it.items && <CaretRight size={12} className="text-ink-3" />}
          </button>
        ),
      )}
      {/* Submenu in body: inside, the parent's pop-in transform makes it a child box (clipped, scrollbars). */}
      {sub &&
        list[sub.i] !== '-' &&
        (list[sub.i] as MenuItem).items &&
        createPortal(
          <Panel
            key={sub.i}
            items={(list[sub.i] as MenuItem).items!}
            x={0}
            y={0}
            anchor={sub.rect}
            focusFirst={sub.keyboard}
            onBack={() => {
              setSub(null)
              ref.current?.querySelectorAll<HTMLElement>(':scope > button[role=menuitem]')[list.slice(0, sub.i).filter((x) => x !== '-').length]?.focus()
            }}
          />,
          document.body,
        )}
    </div>
  )
}

/**
 * The phone: the same menu as a sheet from the bottom edge, in thumb's reach, rows of 48 px; a submenu takes its place
 * with a Back row on top. A tap outside or Esc closes it.
 */
function Sheet({ items }: { items: MenuEntry[] }) {
  const [trail, setTrail] = useState<MenuItem[]>([])
  const ref = useRef<HTMLDivElement>(null)
  const at = trail[trail.length - 1]
  const list = tidy(at?.items ?? items)
  // Keys land in it; a tap shows no ring (focus-visible only).
  useLayoutEffect(() => ref.current?.focus(), [trail.length])
  return (
    <div data-menu className="fixed inset-0 z-50 flex flex-col justify-end">
      <div aria-hidden onClick={closeMenu} className="fade-in absolute inset-0 bg-black/40" />
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
        onKeyDown={(e) => {
          const all = [...ref.current!.querySelectorAll<HTMLElement>(ITEM)]
          const i = all.indexOf(document.activeElement as HTMLElement)
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus()
          else if (e.key === 'Escape' && at) setTrail(trail.slice(0, -1))
          else if (e.key === 'Escape') closeMenu()
          else return
          e.preventDefault()
          e.stopPropagation()
        }}
        className="sheet-in relative flex max-h-[75vh] flex-col overflow-y-auto overscroll-contain rounded-t-2xl border-t border-line bg-raised px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-ink shadow-[0_-12px_32px_var(--shadow)] outline-none"
      >
        <span aria-hidden className="mx-auto mb-1.5 h-1 w-9 shrink-0 rounded-full bg-ink-4" />
        {at && (
          <button aria-label={tr('Back')} onClick={() => setTrail(trail.slice(0, -1))} className="flex h-12 shrink-0 items-center gap-3 rounded-lg px-3 text-left text-[0.9375rem] font-semibold outline-none focus-visible:bg-panel">
            <CaretLeft size={18} className="text-ink-2" />
            <span className="flex-1 truncate">{at.label}</span>
          </button>
        )}
        {list.map((it, i) =>
          it === '-' ? (
            <div key={`${trail.length}:${i}`} role="separator" className="mx-3 my-1 h-px shrink-0 bg-line-soft" />
          ) : (
            <button
              key={`${trail.length}:${i}`}
              role="menuitem"
              disabled={it.disabled}
              aria-haspopup={it.items ? 'menu' : undefined}
              aria-checked={it.checked}
              onClick={() => {
                if (it.items) return setTrail([...trail, it])
                closeMenu()
                it.onSelect?.()
              }}
              className={`flex h-12 w-full shrink-0 items-center gap-3.5 rounded-lg px-3 text-left text-[0.9375rem] outline-none focus-visible:bg-panel active:bg-panel disabled:opacity-40 ${it.danger ? 'text-danger' : ''}`}
            >
              <span className={`grid w-5 shrink-0 place-items-center ${it.danger ? '' : 'text-ink-2'}`}>{it.checked !== undefined ? it.checked && <Check size={17} weight="bold" /> : it.icon}</span>
              <span className="flex-1 truncate">{it.label}</span>
              {it.items && <CaretRight size={14} className="text-ink-3" />}
            </button>
          ),
        )}
      </div>
    </div>
  )
}

/** One menu for the whole app. fallback = menu for places with no menu of their own. Text fields and selected text keep the native one (cut, copy, paste). */
export function ContextMenuHost({ fallback }: { fallback: () => MenuEntry[] }) {
  const { at, items } = useMenu()
  const phone = usePhone()

  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      const t = e.target instanceof Element ? e.target : null
      if (e.defaultPrevented || t?.closest('input, textarea, select, [contenteditable="true"]') || String(getSelection()).trim()) return
      openMenu(e, fallback())
    }
    window.addEventListener('contextmenu', onContext)
    return () => window.removeEventListener('contextmenu', onContext)
  }, [fallback])

  useEffect(() => {
    if (!at) return
    const outside = (e: Event) => !(e.target instanceof Element && e.target.closest('[data-menu]')) && closeMenu()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu()
    const scrolled = (e: Event) => {
      const anchor = useMenu.getState().anchor
      if (!anchor || !(e.target instanceof Node) || e.target.contains(anchor)) outside(e)
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('scroll', scrolled, true)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('resize', closeMenu)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('scroll', scrolled, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', closeMenu)
      window.removeEventListener('resize', closeMenu)
    }
  }, [at])

  if (!at) return null
  if (phone) return createPortal(<Sheet key={`${at.x},${at.y}`} items={items} />, document.body)
  return createPortal(<Panel key={`${at.x},${at.y}`} items={items} x={at.x} y={at.y} up={at.up} focusFirst />, document.body)
}
