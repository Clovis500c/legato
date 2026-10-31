'use client'

import { Devices, Feather, FolderSimple, Headphones, MagnifyingGlass, Palette, PlayCircle, Playlist, Plus, PuzzlePiece, Quotes, SealCheck, SlidersHorizontal, Sparkle, Stack, Translate } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { FAQ, FEATURES, GITHUB, WHY, WHY_NOTE, type IconName } from './content'
import { EASE, group, inView, item, Reveal } from './motion'

const ICONS: Record<IconName, typeof Stack> = { SealCheck, Feather, Headphones, Stack, MagnifyingGlass, PlayCircle, Playlist, Sparkle, SlidersHorizontal, FolderSimple, Devices, Quotes, Palette, PuzzlePiece, Translate }

const h2 = 'text-[clamp(26px,2.6vw,32px)] leading-tight font-bold tracking-[-0.01em]'
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

/** Cards in a grid, the app's own icons; the icon turns a little under the pointer. */
function Cards({ list, grid }: { list: { icon: IconName; title: string; text: string }[]; grid: string }) {
  return (
    <motion.ul {...inView} variants={group} className={`grid gap-3 ${grid}`}>
      {list.map(({ icon, title, text }) => {
        const Icon = ICONS[icon]
        return (
          <motion.li key={title} variants={item} whileHover={{ y: -4 }} className="group flex flex-col gap-2 rounded-lg bg-panel p-6 transition-colors duration-200 hover:bg-raised">
            <span className="mb-2 grid size-11 place-items-center rounded-full bg-bg transition-transform duration-400 ease-out group-hover:scale-110 group-hover:-rotate-8">
              <Icon size={22} />
            </span>
            <h3 className="font-medium">{title}</h3>
            <p className="text-sm text-ink-2">{text}</p>
          </motion.li>
        )
      })}
    </motion.ul>
  )
}

/** One card per feature. */
export function Features() {
  return <Cards list={FEATURES} grid="grid-cols-[repeat(auto-fill,minmax(260px,1fr))]" />
}

/** The four differences, and under them where the numbers come from. */
export function Why() {
  return (
    <>
      <Cards list={WHY} grid="grid-cols-[repeat(auto-fill,minmax(260px,1fr))]" />
      <Reveal>
        <p className="mt-5 max-w-[860px] text-[13px] text-ink-3">
          {WHY_NOTE}{' '}
          <a href={`${GITHUB}/blob/master/docs/performance.md`} className="underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink">
            All the measures
          </a>
          .
        </p>
      </Reveal>
    </>
  )
}

/** Three numbered steps under a line of ink. */
export function Steps({ steps }: { steps: [string, string][] }) {
  return (
    <motion.ol {...inView} variants={group} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {steps.map(([title, text], i) => (
        <motion.li key={title} variants={item} className="flex flex-col gap-2 border-t-2 border-ink px-6 pt-7 pb-6">
          <span className="mb-3 text-[13px] font-medium text-ink-3 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm text-ink-2">{text}</p>
        </motion.li>
      ))}
    </motion.ol>
  )
}

/** Questions that open in place, one at a time. */
export function Faq() {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <Reveal className="border-t border-line">
      {FAQ.map(({ q, a }, i) => (
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
                <p className="max-w-[720px] pb-[22px] text-[15px] text-ink-2">{a}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </Reveal>
  )
}
