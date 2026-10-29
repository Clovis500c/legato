import { DotsThreeVertical, Play, SpinnerGap } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { tr } from '../i18n/i18n'
import { onMenu, openMenu, type MenuEntry } from './ContextMenu'
import { RoundButton } from './controls'

/**
 * Titled block of a page (Home, Search): Title L, a line under it, then on the right its actions, Show all and a ⋮ that
 * opens `menu` (a right-click on the head does too). docs/design.md.
 */
export function Section({ title, sub, onAll, action, menu, className = '', children }: { title: string; sub?: ReactNode; onAll?: () => void; action?: ReactNode; menu?: () => MenuEntry[]; className?: string; children: ReactNode }) {
  return (
    <section className={`flex flex-col gap-3 ${className}`}>
      <div onContextMenu={menu && onMenu(menu)} className="flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="truncate text-[1.375rem] leading-7 font-bold">{title}</h2>
          {sub && <p className="flex items-center gap-1.5 truncate text-[0.8125rem] text-ink-2">{sub}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {action}
          {onAll && (
            <button onClick={onAll} className="text-sm font-medium text-ink-2 transition-colors hover:text-ink">
              {tr('Show all')}
            </button>
          )}
          {/* Out of the line's height: Show all stays on the line under the title. */}
          {menu && (
            <RoundButton label={tr('Section options')} kind="plain" size="sm" className="-my-1.5" onClick={(e) => openMenu(e, menu())}>
              <DotsThreeVertical size={16} weight="bold" />
            </RoundButton>
          )}
        </div>
      </div>
      {children}
    </section>
  )
}

/** Cards side by side, scrolled sideways; their padding is the gap, so covers line up with the title. */
export function CardRow({ children }: { children: ReactNode }) {
  return <ul className="stagger -mx-3 -mt-2 flex snap-x overflow-x-auto">{children}</ul>
}

/** Media/Card: cover, title, line under; grey on hover with the sky blue play button on the cover. busy = loading its songs. */
export function MediaCard({ title, sub, art, round, onOpen, onPlay, menu, busy }: { title: string; sub: string; art: ReactNode; round?: boolean; onOpen: () => void; onPlay?: () => void; menu?: () => MenuEntry[]; busy?: boolean }) {
  return (
    <li onContextMenu={menu && onMenu(menu)} className="group relative flex w-[200px] shrink-0 snap-start rounded-lg p-3 transition-colors hover:bg-raised">
      <button onClick={onOpen} className="flex min-w-0 flex-1 flex-col gap-2.5 text-left">
        <span className={`block size-[176px] overflow-hidden ${round ? 'rounded-full' : 'rounded-cover'}`}>{art}</span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-base font-medium">{title}</span>
          <span className="line-clamp-2 text-[0.8125rem] text-ink-3">{sub}</span>
        </span>
      </button>
      {onPlay && (
        <RoundButton label={tr('Play {title}', { title })} kind="primary" size="md" className={`absolute top-[138px] right-[22px] shadow-[0_8px_16px_rgb(0_0_0/0.3)] ${busy ? '' : 'translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 focus:translate-y-0 focus:opacity-100'}`} onClick={onPlay}>
          {busy ? <SpinnerGap size={16} className="animate-spin" /> : <Play weight="fill" size={16} />}
        </RoundButton>
      )}
    </li>
  )
}
