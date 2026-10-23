import { CaretRight, Check } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'

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

const useMenu = create<{ at: { x: number; y: number; up?: boolean } | null; items: MenuEntry[] }>(() => ({ at: null, items: [] }))
export const closeMenu = () => useMenu.setState({ at: null })

/** place: pinned to the clicked control instead of the pointer. 'above' for buttons at the window's foot (player bar), 'below' for dropdowns. */
export function openMenu(e: MouseEvent | React.MouseEvent, items: MenuEntry[], { place }: { place?: 'above' | 'below' } = {}) {
  e.preventDefault()
  e.stopPropagation()
  if (place && e.currentTarget instanceof Element) {
    const r = e.currentTarget.getBoundingClientRect()
    return useMenu.setState({ at: place === 'above' ? { x: r.left, y: r.top - 6, up: true } : { x: r.left, y: r.bottom + 6 }, items })
  }
  let [x, y] = [e.clientX, e.clientY]
  // Menu key / Shift+F10: no pointer position, open under the focused element.
  if (!x && !y && e.target instanceof Element) {
    const r = e.target.getBoundingClientRect()
    ;[x, y] = [r.left + 8, r.bottom]
  }
  useMenu.setState({ at: { x, y }, items })
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
    const r = el.getBoundingClientRect()
    let left = anchor ? anchor.right - 4 : x
    if (left + r.width > innerWidth - 4) left = anchor ? anchor.left - r.width + 4 : innerWidth - r.width - 4
    el.style.left = `${Math.max(4, left)}px`
    el.style.top = `${Math.max(4, Math.min(anchor ? anchor.top - 6 : up ? y - r.height : y, innerHeight - r.height - 4))}px`
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

/** One menu for the whole app. fallback = menu for places with no menu of their own. Text fields and selected text keep the native one (cut, copy, paste). */
export function ContextMenuHost({ fallback }: { fallback: () => MenuEntry[] }) {
  const { at, items } = useMenu()

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
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('scroll', outside, true)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('resize', closeMenu)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('scroll', outside, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', closeMenu)
      window.removeEventListener('resize', closeMenu)
    }
  }, [at])

  if (!at) return null
  return createPortal(<Panel key={`${at.x},${at.y}`} items={items} x={at.x} y={at.y} up={at.up} focusFirst />, document.body)
}
