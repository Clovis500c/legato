import { Backspace } from '@phosphor-icons/react'
import { useEffect, useRef } from 'react'
import { tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { closeOsk, press, ROWS, useOsk, type Press } from './osk'

/** Types into a field the way the page's own typing does: the value set natively, then an input event the page hears. */
function put(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set
  set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Living-room mode's keyboard: a grid of buttons at the bottom, walked with the arrows or a pad, typing into the field Enter was pressed on. */
export function OnScreenKeyboard() {
  const target = useOsk((s) => s.target)
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    first.current?.focus()
  }, [target])
  if (!target) return null
  const type = (p: Press) => put(target, press(target.value, p))
  const done = (submit: boolean) => {
    closeOsk()
    target.focus()
    if (submit) target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
  }
  const key = 'grid h-12 min-w-12 place-items-center rounded-lg border border-line bg-raised px-3 text-lg font-medium hover:brightness-110'
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr('On-screen keyboard')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          done(false)
        }
      }}
      className="fixed inset-x-0 bottom-0 z-[110] flex flex-col items-center gap-2 border-t border-line bg-bg p-4 text-ink"
    >
      <div className="w-full max-w-3xl truncate rounded-lg bg-recess px-4 py-2 text-xl" aria-live="polite">
        {target.value || <span className="text-ink-3">{target.placeholder}</span>}
      </div>
      {ROWS.map((row, r) => (
        <div key={r} className="flex gap-2">
          {row.map((k, i) => (
            <button key={k} ref={r === 1 && i === 0 ? first : undefined} type="button" className={key} onClick={() => type({ key: k })}>
              {k}
            </button>
          ))}
        </div>
      ))}
      <div className="flex gap-2">
        <button type="button" className={`${key} w-64`} onClick={() => type('space')}>
          {tr('Space')}
        </button>
        <button type="button" aria-label={tr('Backspace')} className={key} onClick={() => type('back')}>
          <Backspace size={22} />
        </button>
        <Button variant="ghost" onClick={() => done(false)}>
          {tr('Done')}
        </Button>
        <Button onClick={() => done(true)}>{tr('Enter')}</Button>
      </div>
    </div>
  )
}
