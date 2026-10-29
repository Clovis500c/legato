import { CaretDown, Check, Desktop, MagnifyingGlass } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CATALOG, LANGUAGES, locale, resolveLang, tr } from '../../shared/i18n/i18n'

// Noto Emoji's waving flags (Google, Apache-2.0; flag art public domain), 72 px: Windows draws flag emoji as two
// letters and Apple's set can't ship. One file per catalogue country in shared/flags.
const FLAGS = import.meta.glob<string>('../../shared/flags/*.png', { eager: true, import: 'default' })

export function Flag({ country, className = '' }: { country: string; className?: string }) {
  const src = FLAGS[`../../shared/flags/${country}.png`]
  return src ? <img src={src} alt="" aria-hidden draggable={false} className={`h-6 w-6 shrink-0 ${className}`} /> : <span className={`w-6 shrink-0 ${className}`} />
}

type Row = { value: string; name: string; sub?: string; country?: string; search: string }

/** Settings › General › Language: searchable popover, Windows' language first, only languages that are translated. */
export function LanguagePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ x: 0, y: 0 })

  const system = LANGUAGES.find((l) => l.code === resolveLang('system', navigator.languages))!
  const here = new Intl.DisplayNames([locale()], { type: 'language' })
  const english = new Intl.DisplayNames(['en'], { type: 'language' })
  const rows: Row[] = [
    { value: 'system', name: tr('Match Windows'), sub: system.name, search: `windows system ${tr('Match Windows')}` },
    ...LANGUAGES.map((l) => {
      const local = here.of(l.code === 'pt' ? 'pt-BR' : l.code)
      return { value: l.code, name: l.name, sub: local && local.toLowerCase() !== l.name.toLowerCase() ? local : undefined, country: l.country, search: `${l.name} ${local} ${english.of(l.code)} ${l.code}` }
    }),
  ]
  const q = query.trim().toLowerCase()
  const shown = q ? rows.filter((r) => r.search.toLowerCase().includes(q)) : rows
  const current = rows.find((r) => r.value === value) ?? rows[0]

  const close = () => {
    setOpen(false)
    button.current?.focus()
  }
  const pick = (r: Row) => {
    onChange(r.value)
    close()
  }
  useLayoutEffect(() => {
    if (!open || !button.current) return
    const r = button.current.getBoundingClientRect()
    setAt({ x: r.left, y: r.bottom + 6 })
    setQuery('')
    setActive(Math.max(0, rows.findIndex((x) => x.value === value)))
    // Rows and value read once per opening.
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
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((a) => (a + step + shown.length) % Math.max(shown.length, 1))
    } else if (e.key === 'Enter' && shown[active]) {
      e.preventDefault()
      pick(shown[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  return (
    <>
      <button ref={button} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={tr('Language')} onClick={() => setOpen(!open)} className="flex h-9 w-fit min-w-64 items-center gap-2.5 rounded-full border border-line bg-raised px-3.5 text-[0.8125rem] font-medium hover:bg-panel">
        {current.country ? <Flag country={current.country} /> : <Desktop size={16} className="text-ink-2" />}
        <span className="flex-1 text-left">{value === 'system' ? tr('Windows ({language})', { language: system.name }) : current.name}</span>
        <CaretDown size={12} weight="bold" className={`text-ink-3 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open &&
        createPortal(
          <div ref={panel} style={{ left: at.x, top: at.y }} onKeyDown={keys} className="pop-in fixed z-50 flex max-h-[min(26rem,70vh)] w-80 flex-col overflow-hidden rounded-xl border border-line bg-raised text-ink shadow-[0_12px_32px_var(--shadow)]">
            <label className="flex items-center gap-2 border-b border-line-soft px-3 py-2.5">
              <MagnifyingGlass size={15} className="shrink-0 text-ink-3" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(0)
                }}
                placeholder={tr('Search languages')}
                aria-label={tr('Search languages')}
                aria-controls="language-list"
                aria-activedescendant={shown[active] ? `language-${shown[active].value}` : undefined}
                className="flex-1 bg-transparent text-[0.8125rem] outline-none placeholder:text-ink-3"
              />
            </label>
            <div id="language-list" role="listbox" aria-label={tr('Language')} className="flex flex-col overflow-y-auto p-1.5">
              {shown.map((r, i) => (
                <div
                  key={r.value}
                  id={`language-${r.value}`}
                  data-i={i}
                  role="option"
                  aria-selected={r.value === value}
                  onPointerMove={() => setActive(i)}
                  onClick={() => pick(r)}
                  className={`flex h-11 shrink-0 cursor-default items-center gap-3 rounded-lg px-2.5 ${i === active ? 'bg-panel' : ''} ${r.value === 'system' && !q ? 'mb-1' : ''}`}
                >
                  {r.country ? <Flag country={r.country} /> : <Desktop size={18} className="w-6 shrink-0 text-ink-2" />}
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-[0.8125rem] font-medium">{r.name}</span>
                    {r.sub && <span className="truncate text-xs text-ink-2">{r.sub}</span>}
                  </span>
                  {r.value === value && <Check size={15} weight="bold" className="shrink-0 text-accent-ink" />}
                </div>
              ))}
              {!shown.length && <p className="px-2.5 py-3 text-xs text-ink-2">{tr('No language matches “{query}”.', { query })}</p>}
            </div>
            {LANGUAGES.length < CATALOG.length && <p className="border-t border-line-soft px-3 py-2 text-[0.6875rem] text-ink-3">{tr('More languages are on the way.')}</p>}
          </div>,
          document.body,
        )}
    </>
  )
}
