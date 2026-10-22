import type { ReactNode } from 'react'

/** Editorial header: mono kicker, big title, optional subtitle, actions on the right. */
export function PageHeader({ kicker, title, sub, actions, art, onContextMenu }: { kicker: string; title: ReactNode; sub?: ReactNode; actions?: ReactNode; art?: ReactNode; onContextMenu?: (e: React.MouseEvent) => void }) {
  return (
    <header onContextMenu={onContextMenu} className="flex shrink-0 items-end justify-between gap-6 pt-1 pb-4.5">
      <div className="flex min-w-0 items-end gap-6">
        {art}
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="kicker">{kicker}</p>
          <h1 className="truncate text-[2.75rem] leading-none font-bold tracking-[-0.03em]">{title}</h1>
          {sub && <div className="text-[0.8125rem] text-ink-2">{sub}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
    </header>
  )
}
