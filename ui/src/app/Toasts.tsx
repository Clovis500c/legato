import { CheckCircle, Info, MinusCircle, Warning, X } from '@phosphor-icons/react'
import { useSettings } from './settings'
import { useStore, type Toast } from './store'
import { tr } from '../shared/i18n/i18n'
import type { Settings } from '../shared/theme/theme'

// Fixed colors: a success is green whatever the theme.
const icons: Record<Toast['kind'], { Icon: typeof CheckCircle; color: string }> = {
  ok: { Icon: CheckCircle, color: '#23A55A' },
  removed: { Icon: MinusCircle, color: 'var(--ink-2)' },
  info: { Icon: Info, color: 'var(--ink-2)' },
  error: { Icon: Warning, color: 'var(--color-danger)' },
}

// Above the player bar and Now Playing's controls, or under the top bar (Settings › General › Notifications).
const places: Record<Settings['toastPlace'], string> = {
  bottom: 'inset-x-0 bottom-[116px] items-center',
  bottomRight: 'right-0 bottom-[116px] items-end',
  top: 'inset-x-0 top-14 items-center',
  topRight: 'right-0 top-14 items-end',
}

/** Newest at the bottom. */
export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismissToast = useStore((s) => s.dismissToast)
  const place = useSettings((s) => s.settings.toastPlace)
  if (!toasts.length) return null
  return (
    <div aria-live="polite" className={`pointer-events-none fixed z-[60] flex flex-col gap-2 px-4 ${places[place]}`}>
      {toasts.map((t) => {
        const { Icon, color } = icons[t.kind]
        return (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className="toast pointer-events-auto flex max-w-[min(560px,100%)] items-center gap-3 rounded-lg border border-line bg-raised py-2 pr-2 pl-3.5 text-[0.8125rem] text-ink shadow-[0_12px_32px_var(--shadow)]">
            <Icon size={18} weight="fill" style={{ color }} className="shrink-0" />
            <span className="min-w-0 flex-1 py-0.5">{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  dismissToast(t.id)
                  t.action!.run()
                }}
                className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-ink transition hover:bg-bg"
              >
                {t.action.label}
              </button>
            )}
            <button aria-label={tr('Dismiss')} onClick={() => dismissToast(t.id)} className="grid size-7 shrink-0 place-items-center rounded-full text-ink-3 transition hover:bg-bg hover:text-ink">
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
