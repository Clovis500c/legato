import type { ReactNode } from 'react'

/** Editorial header: mono kicker, big title, optional subtitle, actions on the right. */
export function PageHeader({ kicker, title, sub, actions, art }: { kicker: string; title: string; sub?: ReactNode; actions?: ReactNode; art?: ReactNode }) {
  return (
    <header className="flex shrink-0 items-end justify-between gap-6 pt-1 pb-4.5">
      <div className="flex min-w-0 items-end gap-6">
        {art}
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="kicker">{kicker}</p>
          <h1 className="truncate text-[44px] leading-none font-bold tracking-[-0.03em]">{title}</h1>
          {sub && <div className="text-[13px] text-ink-2">{sub}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
    </header>
  )
}
