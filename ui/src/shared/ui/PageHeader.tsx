import type { ReactNode } from 'react'

/**
 * Page header: optional kicker, title, subtitle, actions on the right. A page with art (album, artist, playlist) is a
 * band in the cover's tint (`tint`: palette variables from useCoverTint; the page's own colors until it's known), the
 * pane's full width from its top as in the mockups, then a row with the actions and `side` (sort, columns) on the right.
 */
export function PageHeader({ kicker, title, sub, actions, side, art, tint, onContextMenu }: { kicker?: string; title: ReactNode; sub?: ReactNode; actions?: ReactNode; side?: ReactNode; art?: ReactNode; tint?: Record<string, string>; onContextMenu?: (e: React.MouseEvent) => void }) {
  if (art)
    return (
      // The page's px-6 / pt-5 undone (main pane's edges); a page that scrolls around it gives it the same room.
      <div className="-mx-6 -mt-5 flex shrink-0 flex-col">
        <header onContextMenu={onContextMenu} style={tint} className="flex min-w-0 items-end gap-7 bg-bg px-6 py-5 transition-colors duration-500">
          {art}
          <div className="flex min-w-0 flex-col gap-2">
            {kicker && <p className="kicker">{kicker}</p>}
            {/* Display L (docs/design.md): Roboto Black, 56 / 60. */}
            <h1 className="truncate pb-1 text-[3.5rem] leading-[1.07] font-black tracking-[-0.015em]">{title}</h1>
            {sub && <div className="text-[0.8125rem] text-ink-2">{sub}</div>}
          </div>
        </header>
        {(actions || side) && (
          <div className="flex flex-wrap items-center gap-3 px-6 py-5">
            {actions}
            {side && <div className="ml-auto flex items-center gap-2">{side}</div>}
          </div>
        )}
      </div>
    )
  return (
    <header onContextMenu={onContextMenu} className="flex shrink-0 items-end justify-between gap-6 pt-1 pb-4">
      <div className="flex min-w-0 flex-col gap-1">
        {kicker && <p className="kicker">{kicker}</p>}
        <h1 className="truncate pb-1 text-[3.5rem] leading-[1.07] font-black tracking-[-0.015em]">{title}</h1>
        {sub && <div className="text-[0.8125rem] text-ink-2">{sub}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
