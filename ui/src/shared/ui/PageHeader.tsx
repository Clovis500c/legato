import type { ReactNode } from 'react'

/**
 * Page header: optional kicker, title, subtitle, actions on the right. Compact (a list page keeps its rows in view);
 * a page with art (album, artist, playlist) gets a bigger title.
 */
export function PageHeader({ kicker, title, sub, actions, art, onContextMenu }: { kicker?: string; title: ReactNode; sub?: ReactNode; actions?: ReactNode; art?: ReactNode; onContextMenu?: (e: React.MouseEvent) => void }) {
  return (
    <header onContextMenu={onContextMenu} className={`flex shrink-0 items-end justify-between gap-6 pt-1 ${art ? 'pb-6' : 'pb-4'}`}>
      <div className="flex min-w-0 items-end gap-7">
        {art}
        <div className={`flex min-w-0 flex-col ${art ? 'gap-2' : 'gap-1'}`}>
          {kicker && <p className="kicker">{kicker}</p>}
          {/* Display L (docs/design.md): Roboto Black, 56 / 60. */}
          <h1 className="truncate pb-1 text-[3.5rem] leading-[1.07] font-black tracking-[-0.015em]">{title}</h1>
          {sub && <div className="text-[0.8125rem] text-ink-2">{sub}</div>}
          {/* With art, the actions sit under the title (Play first), like an album sleeve. */}
          {art && actions && <div className="flex items-center gap-3 pt-2">{actions}</div>}
        </div>
      </div>
      {!art && actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
