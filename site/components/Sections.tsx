'use client'

import { Devices, FolderSimple, Playlist, Plus, PuzzlePiece, Sparkle, Translate } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { FEATURE_ICONS, GITHUB, linked, type IconName } from './content'
import { useCopy } from './copy'
import { EASE, group, inView, item, Reveal } from './motion'

const ICONS: Record<IconName, typeof Playlist> = { Playlist, Sparkle, FolderSimple, Devices, PuzzlePiece, Translate }

const h2 = 'text-[clamp(26px,2.6vw,32px)] leading-tight font-black tracking-[-0.01em]'
const section = 'mx-auto max-w-[1440px] px-(--pad) py-[clamp(56px,8vw,104px)]'

/** Title and a line on the left (it stays while the rows scroll), rows on the right: the mockup's two tables. */
export function Split({ id, title, intro, children }: { id: string; title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className={`${section} grid grid-cols-1 items-start gap-x-16 gap-y-8 min-[901px]:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]`}>
      <Reveal className="min-[901px]:sticky min-[901px]:top-28">
        <h2 className={`${h2} mb-4`}>{title}</h2>
        <p className="text-sm text-ink-2">{intro}</p>
      </Reveal>
      <div className="flex flex-col gap-14">{children}</div>
    </section>
  )
}

/** Title above, a line beside it. */
export function Block({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section id={id} className={section}>
      <Reveal className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
        <h2 className={h2}>{title}</h2>
        <p className="max-w-[520px] text-sm text-ink-2">{intro}</p>
      </Reveal>
      {children}
    </section>
  )
}

/** Two columns of rows; one after another as they come into view. Stacked on phones. */
export function Rows({ head, caption, rows }: { head?: [string, string]; caption?: string; rows: [string, ReactNode][] }) {
  return (
    <motion.table {...inView} variants={group} className="w-full border-collapse text-sm">
      {caption && <caption className="pb-3 text-left text-base font-medium">{caption}</caption>}
      {head && (
        <thead className="max-sm:hidden">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="border-b border-line pr-6 pb-3 text-left text-xs font-medium text-ink-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map(([k, v]) => (
          <motion.tr key={k} variants={item} className="border-b border-line transition-colors hover:bg-panel max-sm:block">
            <th scope="row" className="w-[36%] py-[18px] pr-6 text-left align-top font-medium max-sm:block max-sm:w-auto max-sm:pb-1">
              {k}
            </th>
            <td className="py-[18px] pr-6 align-top text-ink-2 max-sm:block max-sm:pt-0">{v}</td>
          </motion.tr>
        ))}
      </tbody>
    </motion.table>
  )
}

/** What the scroll story leaves out, a line each. */
export function Features() {
  const c = useCopy()
  return (
    <motion.ul {...inView} variants={group} className="grid grid-cols-1 gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
      {c.features.items.map(({ title, text }, i) => {
        const Icon = ICONS[FEATURE_ICONS[i]]
        return (
          <motion.li key={title} variants={item} className="border-t border-line pt-4">
            <h3 className="flex items-center gap-2 font-medium">
              <Icon size={18} aria-hidden />
              {title}
            </h3>
            <p className="mt-1 text-sm text-ink-2">{text}</p>
          </motion.li>
        )
      })}
    </motion.ul>
  )
}

/** A spec plate: the measures big (written at build, `figuresOf`), the four differences, where the numbers come from. */
export function Why({ figures }: { figures: [string, string][] }) {
  const c = useCopy()
  return (
    <>
      <Reveal>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-y border-line py-7 lg:grid-cols-4">
          {figures.map(([figure, label]) => (
            <div key={label} className="flex flex-col-reverse gap-2">
              <dt className="text-[13px] text-ink-3">{label}</dt>
              <dd className="text-[clamp(32px,3.9vw,56px)] leading-none font-black tracking-[-0.015em] tabular-nums">{figure}</dd>
            </div>
          ))}
        </dl>
      </Reveal>
      <motion.ul {...inView} variants={group} className="mt-8 grid grid-cols-1 gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
        {c.why.items.map(({ title, text }) => (
          <motion.li key={title} variants={item}>
            <h3 className="font-medium">{title}</h3>
            <p className="mt-1 text-sm text-ink-2">{text}</p>
          </motion.li>
        ))}
      </motion.ul>
      <Reveal>
        <p className="mt-8 max-w-[860px] text-[13px] text-ink-3">
          {c.why.note}{' '}
          <a href={`${GITHUB}/blob/master/docs/performance.md`} className="underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink">
            {c.why.measures}
          </a>
          .
        </p>
      </Reveal>
    </>
  )
}

/** Three steps under a line of ink. */
export function Steps({ steps }: { steps: [string, string][] }) {
  return (
    <motion.ol {...inView} variants={group} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {steps.map(([title, text]) => (
        <motion.li key={title} variants={item} className="flex flex-col gap-2 border-t-2 border-ink pt-5 pb-6">
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm text-ink-2">{text}</p>
        </motion.li>
      ))}
    </motion.ol>
  )
}

/** Questions that open in place, one at a time. */
export function Faq() {
  const c = useCopy()
  const [open, setOpen] = useState<number | null>(null)
  return (
    <Reveal className="border-t border-line">
      {c.faq.items.map(({ q, a, href }, i) => (
        <div key={q} className="border-b border-line">
          <h3>
            <button aria-expanded={open === i} aria-controls={`faq-${i}`} onClick={() => setOpen(open === i ? null : i)} className="flex w-full cursor-pointer items-center justify-between gap-4 py-5 text-left font-medium">
              {q}
              <motion.span animate={{ rotate: open === i ? 45 : 0 }} transition={{ duration: 0.25, ease: EASE }} className="text-ink-2">
                <Plus size={18} />
              </motion.span>
            </button>
          </h3>
          <AnimatePresence initial={false}>
            {open === i && (
              <motion.div id={`faq-${i}`} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                <p className="max-w-[720px] pb-[22px] text-[15px] text-ink-2">{href ? linked(a, href) : a}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </Reveal>
  )
}
