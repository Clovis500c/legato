import type { Icon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

/** One way to add music (Add music page): icon, name, what it does, then its controls (mt-auto keeps them low). */
export function Card({ icon: Glyph, title, sub, className = '', children }: { icon: Icon; title: string; sub?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={`flex flex-col gap-3 rounded-lg border border-line p-4 ${className}`}>
      {/* The phone: the icon beside the title, not over it (a row of height saved on every card). */}
      <div className="flex flex-col gap-3 phone:flex-row phone:items-start">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised">
          <Glyph size={20} />
        </span>
        <div className="flex min-w-0 flex-col gap-1 phone:pt-0.5">
          <h2 className="text-sm font-medium phone:text-[0.9375rem]">{title}</h2>
          {sub && <p className="text-[0.8125rem] text-ink-2">{sub}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}
