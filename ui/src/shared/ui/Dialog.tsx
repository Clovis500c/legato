import { X } from '@phosphor-icons/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { RoundButton } from './controls'
import { tr } from '../i18n/i18n'

const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

/**
 * Modal panel: Escape or backdrop click closes. Focus goes in (first field, else first action, Close last), Tab stays
 * inside, focus comes back to where it was on close. wide: 720 px instead of 480 (a grid of cards). The phone: a sheet
 * from the bottom edge, as its menus (ContextMenu), its buttons in thumb's reach.
 */
export function Dialog({ title, kicker, onClose, wide = false, children }: { title: string; kicker?: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    const all = () => [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    const body = all().filter((el) => !el.closest('header'))
    ;(body.find((el) => el.matches('input, select, textarea')) ?? body.find((el) => el.matches('[data-default]')) ?? body[0] ?? all()[0])?.focus()
    const onKey = (e: KeyboardEvent) => {
      // One open inside another (a card's own, in the welcome): the last one takes the keys.
      if ([...document.querySelectorAll('[data-modal]')].at(-1) !== box.current) return
      if (e.key === 'Escape') return close.current()
      if (e.key !== 'Tab') return
      const els = all()
      if (!els.length) return
      const i = els.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : i === els.length - 1 ? 0 : i + 1
      e.preventDefault()
      els[next].focus()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (back?.isConnected) back.focus()
    }
  }, [])
  return (
    <div className="fade-in fixed inset-0 z-40 grid place-items-center bg-[var(--shadow)] p-6 phone:place-items-end phone:p-0 phone:pt-10" onClick={onClose}>
      <div ref={box} role="dialog" data-modal aria-modal aria-label={title} onClick={(e) => e.stopPropagation()} className={`dialog-in flex max-h-full w-full ${wide ? 'max-w-180' : 'max-w-120'} flex-col gap-5 overflow-y-auto rounded-xl border border-line bg-panel p-6 shadow-[0_24px_64px_var(--shadow)] phone:max-w-none phone:rounded-b-none phone:rounded-t-2xl phone:border-x-0 phone:border-b-0 phone:px-5 phone:pb-[max(1.5rem,env(safe-area-inset-bottom))]`}>
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            {kicker && <p className="kicker">{kicker}</p>}
            <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          </div>
          <RoundButton label={tr('Close')} kind="plain" size="sm" onClick={onClose}>
            <X size={15} />
          </RoundButton>
        </header>
        {children}
      </div>
    </div>
  )
}
