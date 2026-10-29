import type { Icon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

/** One way to add music (Add music page): icon, name, what it does, then its controls (mt-auto keeps them low). */
export function Card({ icon: Glyph, title, sub, children }: { icon: Icon; title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <span className="grid size-10 place-items-center rounded-full bg-raised">
        <Glyph size={20} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">{title}</h2>
        {sub && <p className="text-[0.8125rem] text-ink-2">{sub}</p>}
      </div>
      {children}
    </section>
  )
}
