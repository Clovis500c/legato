import { X } from '@phosphor-icons/react'
import { useEffect, type ReactNode } from 'react'
import { RoundButton } from './controls'

/** Modal panel: Escape or backdrop click closes. */
export function Dialog({ title, kicker, onClose, children }: { title: string; kicker?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-[var(--shadow)] p-6" onClick={onClose}>
      <div role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()} className="flex max-h-full w-full max-w-120 flex-col gap-5 overflow-y-auto rounded-xl border border-line bg-panel p-6 shadow-[0_24px_64px_var(--shadow)]">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            {kicker && <p className="kicker">{kicker}</p>}
            <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          </div>
          <RoundButton label="Close" kind="plain" size="sm" onClick={onClose}>
            <X size={15} />
          </RoundButton>
        </header>
        {children}
      </div>
    </div>
  )
}
