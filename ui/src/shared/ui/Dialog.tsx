import { X } from '@phosphor-icons/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { RoundButton } from './controls'
import { tr } from '../i18n/i18n'

const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

/**
 * Modal panel: Escape or backdrop click closes. Focus goes in (first field, else first action, Close last), Tab stays
 * inside, focus comes back to where it was on close.
 */
export function Dialog({ title, kicker, onClose, children }: { title: string; kicker?: string; onClose: () => void; children: ReactNode }) {
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
    <div className="fixed inset-0 z-40 grid place-items-center bg-[var(--shadow)] p-6" onClick={onClose}>
      <div ref={box} role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()} className="flex max-h-full w-full max-w-120 flex-col gap-5 overflow-y-auto rounded-xl border border-line bg-panel p-6 shadow-[0_24px_64px_var(--shadow)]">
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
