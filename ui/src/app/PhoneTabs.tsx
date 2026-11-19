import { Books, Disc, House, MagnifyingGlass, Radio } from '@phosphor-icons/react'
import { tr } from '../shared/i18n/i18n'
import { useSettings } from './settings'
import { activeTab, phoneTabs } from './tabLogic'
import { useStore, type View } from './store'

/** Phone layout's bottom tabs (below 640 px, the sidebar hidden): Home, Search (its page, the field focused), Your
 *  library (the sidebar open wide, as its Expand button does), Mixes, Radio. */
export function PhoneTabs() {
  const view = useStore((s) => s.view)
  const go = useStore((s) => s.go)
  const wide = useSettings((s) => s.settings.libraryWide)
  const hidden = useSettings((s) => s.settings.hiddenNav)
  const update = useSettings((s) => s.update)
  const lit = activeTab(view.name, wide)
  const leave = () => wide && update({ libraryWide: false })
  const page = (v: View) => () => (leave(), go(v))
  const tabs = [
    { id: 'home' as const, label: tr('Home'), icon: House, on: lit === 'home', onClick: page({ name: 'home' }) },
    { id: 'search' as const, label: tr('Search'), icon: MagnifyingGlass, on: lit === 'search', onClick: () => (leave(), view.name !== 'search' && go({ name: 'search' }), document.querySelector<HTMLInputElement>('[data-search]')?.focus()) },
    { id: 'library' as const, label: tr('Your library'), icon: Books, on: lit === 'library', onClick: () => update({ libraryWide: !wide }) },
    { id: 'mixes' as const, label: tr('Mixes'), icon: Disc, on: lit === 'mixes', onClick: page({ name: 'mixes' }) },
    { id: 'radio' as const, label: tr('Radio'), icon: Radio, on: lit === 'radio', onClick: page({ name: 'radio' }) },
  ]
  return (
    <nav aria-label={tr('Pages')} className="hidden shrink-0 border-t border-line-soft pb-[env(safe-area-inset-bottom)] phone:flex">
      {tabs.filter((t) => phoneTabs(hidden).includes(t.id)).map((t) => (
        <button key={t.label} aria-current={t.on ? 'page' : undefined} onClick={t.onClick} className={`flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[0.6875rem] font-medium ${t.on ? 'text-ink' : 'text-ink-3'}`}>
          <t.icon size={22} weight={t.on ? 'fill' : 'regular'} />
          <span className="max-w-full truncate">{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
