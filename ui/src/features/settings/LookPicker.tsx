import { CaretDown, Check } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSettings } from '../../app/settings'
import { tr } from '../../shared/i18n/i18n'
import { VISUALIZER_LABELS } from '../player/vizLooks'
import { VizThumb } from '../player/VizThumb'
import { lookOptions, lookSettings, lookValue, usePluginViz } from '../plugins/pluginViz'

const WIDTH = 288

/** Settings › Playback › Visualizer style: a dropdown, each look with a still preview of itself (LanguagePicker's pattern). */
export function LookPicker() {
  const style = useSettings((s) => s.settings.visualizerStyle)
  const plugin = useSettings((s) => s.settings.visualizerPlugin)
  const update = useSettings((s) => s.update)
  const looks = usePluginViz((s) => s.looks)
  const options = lookOptions(looks)
  const value = lookValue(style, plugin)
  const current = options.find((o) => o.value === value)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [at, setAt] = useState({ x: 0, top: 0, bottom: 0, up: false, max: 0 })
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  const close = () => {
    setOpen(false)
    button.current?.focus()
  }
  const pick = (v: string) => {
    update(lookSettings(v))
    close()
  }
  useLayoutEffect(() => {
    if (!open || !button.current) return
    const r = button.current.getBoundingClientRect()
    // Below the button, above it when there is more room there; inside the window on a phone.
    const below = innerHeight - r.bottom - 14
    const above = r.top - 14
    const up = above > below && below < 320
    setAt({ x: Math.max(8, Math.min(r.left, innerWidth - WIDTH - 8)), top: r.bottom + 6, bottom: innerHeight - r.top + 6, up, max: up ? above : below })
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    panel.current?.focus()
    // Options and value read once per opening.
  }, [open])
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => !panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [open])
  // Braces: scrollIntoView returns a promise in recent WebView2, React would call it as a clean-up and crash.
  useEffect(() => {
    panel.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const keys = (e: React.KeyboardEvent) => {
    const n = options.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + n) % n)
    else if (e.key === 'Home' || e.key === 'End') setActive(e.key === 'Home' ? 0 : n - 1)
    else if ((e.key === 'Enter' || e.key === ' ') && options[active]) pick(options[active].value)
    else if (e.key === 'Escape' || e.key === 'Tab') close()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <>
      <button ref={button} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={tr('Visualizer style')} onClick={() => setOpen(!open)} className="flex h-10 w-fit min-w-56 items-center gap-2.5 rounded-full border border-line bg-raised py-1 pe-3.5 ps-1.5 text-[0.8125rem] font-medium hover:bg-panel">
        <VizThumb look={style} className="h-7 w-14 rounded-full bg-panel" />
        <span className="flex-1 text-start">{current?.label ?? tr(VISUALIZER_LABELS.plugin)}</span>
        <CaretDown size={12} weight="bold" className={`text-ink-3 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="listbox"
            tabIndex={-1}
            aria-label={tr('Visualizer style')}
            aria-activedescendant={options[active] ? `look-${active}` : undefined}
            onKeyDown={keys}
            style={{ left: at.x, width: WIDTH, maxHeight: Math.min(at.max, 448), ...(at.up ? { bottom: at.bottom } : { top: at.top }) }}
            className="pop-in fixed z-50 flex flex-col overflow-y-auto rounded-xl border border-line bg-raised p-1.5 text-ink shadow-[0_12px_32px_var(--shadow)] outline-none"
          >
            {options.map((o, i) => (
              <div
                key={o.value}
                id={`look-${i}`}
                data-i={i}
                role="option"
                aria-selected={o.value === value}
                onPointerMove={() => setActive(i)}
                onClick={() => pick(o.value)}
                className={`flex h-12 shrink-0 cursor-default items-center gap-3 rounded-lg px-2 ${i === active ? 'bg-panel' : ''}`}
              >
                <VizThumb look={lookSettings(o.value).visualizerStyle} className="h-9 w-20 shrink-0 rounded-md bg-recess" />
                <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">{o.label}</span>
                {o.value === value && <Check size={15} weight="bold" className="shrink-0 text-accent-ink" />}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
