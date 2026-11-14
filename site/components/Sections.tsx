'use client'

import { ArrowRight, Check, Devices, FolderSimple, HardDrives, Key, Lock, Plus, PuzzlePiece, Playlist, ShieldCheck, Sparkle, Translate, WindowsLogo } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { siApplemusic, siDiscord, siGithub, siSpotify, siYoutubemusic } from 'simple-icons'
import { useState, type ReactNode } from 'react'
import { DISCORD, FEATURE_ICONS, GITHUB, linked, type IconName } from './content'
import { useCopy } from './copy'
import { useLatest } from './latest'
import { EASE, group, inView, item, Reveal } from './motion'

const ICONS: Record<IconName, typeof Playlist> = { Playlist, Sparkle, FolderSimple, Devices, PuzzlePiece, Translate }

const h2 = 'text-[clamp(30px,3.4vw,46px)] leading-[1.05] font-black tracking-[-0.025em] text-balance'
const section = 'mx-auto max-w-[1440px] px-(--pad) py-[clamp(64px,9vw,128px)]'
/** A surface of the page: the app's raised panels, a hairline, soft corners. */
export const card = 'rounded-2xl border border-line-soft bg-panel'

export const Brand = ({ path, className = 'size-[18px]' }: { path: string; className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={`${className} shrink-0 fill-current`}>
    <path d={path} />
  </svg>
)

/** The section's name in the menu, small, with the playback blue's dot: where you are on a long page. */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 flex items-center gap-2 text-[13px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      {children}
    </p>
  )
}

/** Title above, a line under it. */
function Head({ eyebrow, title, intro, wide = false }: { eyebrow?: string; title: string; intro: ReactNode; wide?: boolean }) {
  return (
    <Reveal className={`mb-[clamp(32px,4vw,56px)] ${wide ? 'grid items-end gap-x-16 gap-y-4 min-[901px]:grid-cols-2' : 'max-w-[760px]'}`}>
      <div>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h2 className={h2}>{title}</h2>
      </div>
      <p className={`text-[clamp(15px,1.2vw,17px)] leading-relaxed text-ink-2 ${wide ? '' : 'mt-4'}`}>{intro}</p>
    </Reveal>
  )
}

export function Block({ id, eyebrow, title, intro, wide, children }: { id: string; eyebrow?: string; title: string; intro: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <section id={id} className={section}>
      <Head eyebrow={eyebrow} title={title} intro={intro} wide={wide} />
      {children}
    </section>
  )
}

/** The big apps' missing pieces: the complaint small and grey, Legato's answer under it. */
export function Fixes() {
  const c = useCopy()
  return (
    <motion.ul {...inView} variants={group} className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
      {c.fixes.rows.map(([complaint, answer], i) => (
        <motion.li key={complaint} variants={item} className={`${card} flex flex-col justify-between gap-5 p-7 ${i < 2 ? 'lg:col-span-3' : 'lg:col-span-2'}`}>
          <p className="text-sm text-ink-3">
            <span className="sr-only">{c.fixes.head[0]}: </span>“{complaint}”
          </p>
          <p className={`flex gap-3 font-semibold ${i < 2 ? 'text-lg leading-snug' : ''}`}>
            <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent text-on-accent">
              <Check size={14} weight="bold" />
            </span>
            <span>
              <span className="sr-only">{c.fixes.head[1]}: </span>
              {answer}
            </span>
          </p>
        </motion.li>
      ))}
    </motion.ul>
  )
}

/** A spec plate: the measures big (written at build, `figuresOf`), the four differences, where the numbers come from. */
export function Why({ figures }: { figures: [string, string][] }) {
  const c = useCopy()
  return (
    <>
      <Reveal>
        <dl className={`${card} grid grid-cols-2 overflow-hidden lg:grid-cols-4`}>
          {figures.map(([figure, label], i) => (
            <div key={label} className={`flex flex-col-reverse gap-2 p-[clamp(20px,2.4vw,32px)] ${i % 2 ? 'border-l border-line-soft' : ''} ${i > 1 ? 'max-lg:border-t lg:border-l' : ''}`}>
              <dt className="text-[13px] text-ink-2">{label}</dt>
              <dd className="text-[clamp(34px,4.4vw,64px)] leading-none font-black tracking-[-0.03em] tabular-nums">
                {figure.split(' ')[0]}
                <span className="ml-1.5 text-[0.45em] font-bold tracking-normal text-accent-ink">{figure.split(' ').slice(1).join(' ')}</span>
              </dd>
            </div>
          ))}
        </dl>
      </Reveal>
      <motion.ul {...inView} variants={group} className="mt-10 grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        {c.why.items.map(({ title, text }) => (
          <motion.li key={title} variants={item} className="border-t border-line pt-5">
            <h3 className="text-lg font-bold">{title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{text}</p>
          </motion.li>
        ))}
      </motion.ul>
      <Reveal>
        <p className="mt-10 max-w-[860px] text-[13px] text-ink-2">
          {c.why.note}{' '}
          <a href={`${GITHUB}/blob/master/docs/performance.md`} className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
            {c.why.measures}
          </a>
          .
        </p>
      </Reveal>
    </>
  )
}

/** Six tiles in three rows of two, the wide one swapping sides. */
const BENTO = ['lg:col-span-4', 'lg:col-span-2', 'lg:col-span-2', 'lg:col-span-4', 'lg:col-span-3', 'lg:col-span-3']

/** What the scroll story leaves out: a tile each. */
export function Features() {
  const c = useCopy()
  return (
    <motion.ul {...inView} variants={group} className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
      {c.features.items.map(({ title, text }, i) => {
        const Icon = ICONS[FEATURE_ICONS[i]]
        return (
          <motion.li key={title} variants={item} className={`${card} flex flex-col gap-4 p-7 ${BENTO[i]}`}>
            <span aria-hidden className="grid size-11 place-items-center rounded-xl bg-accent/15 text-accent-ink">
              <Icon size={22} weight="duotone" />
            </span>
            <h3 className="text-lg font-bold">{title}</h3>
            <p className="text-[15px] leading-relaxed text-ink-2">{text}</p>
          </motion.li>
        )
      })}
    </motion.ul>
  )
}

/** One card per source, its mark on top: how each one plays. Rows in content.tsx's order. */
const SOURCE_MARKS: ReactNode[] = [
  <Brand key="y" path={siYoutubemusic.path} className="size-6" />,
  <Brand key="s" path={siSpotify.path} className="size-6" />,
  <Brand key="a" path={siApplemusic.path} className="size-6" />,
  <FolderSimple key="f" size={24} weight="duotone" />,
  <HardDrives key="h" size={24} weight="duotone" />,
]

export function Sources() {
  const c = useCopy()
  return (
    <motion.ul {...inView} variants={group} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {c.playback.rows.map(([source, how], i) => (
        <motion.li key={source} variants={item} className={`${card} flex flex-col gap-3 p-6`}>
          <span className="text-ink">{SOURCE_MARKS[i]}</span>
          <h3 className="font-bold">{source}</h3>
          <p className="text-sm leading-relaxed text-ink-2">{how}</p>
        </motion.li>
      ))}
    </motion.ul>
  )
}

/** The promise in three cards, the services you may connect, then every line of what leaves the PC, each one opening in place. */
export function Privacy({ rows, english }: { rows: [string, string][]; english?: string }) {
  const c = useCopy()
  const pillars = [Lock, Key, ShieldCheck]
  return (
    <>
      <motion.ul {...inView} variants={group} className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {rows.slice(0, 3).map(([what, text], i) => {
          const Icon = pillars[i]
          return (
            <motion.li key={what} variants={item} className={`${card} flex flex-col gap-3 p-7`}>
              <Icon aria-hidden size={26} weight="duotone" className="text-accent-ink" />
              <h3 className="text-lg font-bold">{what}</h3>
              <p className="text-[15px] leading-relaxed text-ink-2">{text}</p>
            </motion.li>
          )
        })}
      </motion.ul>
      <Reveal className="mt-[clamp(40px,5vw,72px)]">
        <h3 className="mb-5 text-xl font-bold">{c.privacy.services}</h3>
        <ul className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          {c.privacy.rows.map(([service, how]) => (
            <li key={service} className="border-t border-line pt-4">
              <p className="font-semibold">{service}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{how}</p>
            </li>
          ))}
        </ul>
      </Reveal>
      <Reveal className="mt-[clamp(40px,5vw,72px)]">
        {english && <p className="mb-5 text-sm text-ink-2">{english}</p>}
        <div className="grid grid-cols-1 gap-x-8 border-t border-line lg:grid-cols-2">
          {rows.slice(3).map(([what, text]) => (
            <details key={what} className="group border-b border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium [&::-webkit-details-marker]:hidden">
                {what}
                <Plus aria-hidden size={16} className="shrink-0 text-ink-2 transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none" />
              </summary>
              <p className="pb-5 text-sm leading-relaxed text-ink-2">{text}</p>
            </details>
          ))}
        </div>
      </Reveal>
    </>
  )
}

/** Three steps, numbered in the playback blue, then the one way in. */
export function Start() {
  const c = useCopy()
  const { href } = useLatest()
  return (
    <>
      <motion.ol {...inView} variants={group} className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {c.start.steps.map(([title, text], i) => (
          <motion.li key={title} variants={item} className={`${card} flex flex-col gap-3 p-7`}>
            <span aria-hidden className="grid size-10 place-items-center rounded-full bg-accent text-base font-black text-on-accent">
              {i + 1}
            </span>
            <h3 className="text-lg font-bold">{title}</h3>
            <p className="text-[15px] leading-relaxed text-ink-2">{text}</p>
          </motion.li>
        ))}
      </motion.ol>
      <Reveal className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <a href={href} className="inline-flex items-center gap-2 rounded-full bg-ink px-7 py-3.5 text-[15px] font-semibold text-on-ink transition-transform hover:-translate-y-px motion-reduce:transition-none">
          <WindowsLogo size={18} weight="fill" aria-hidden /> {c.hero.download}
        </a>
        <span className="text-sm text-ink-2">{c.hero.free}</span>
      </Reveal>
    </>
  )
}

/** The roadmap as a line, one stop per release, in order. */
export function Next() {
  const c = useCopy()
  return (
    <motion.ol {...inView} variants={group} className="relative grid grid-cols-1 gap-x-8 gap-y-8 border-l border-line pl-8 md:grid-cols-2 md:border-l-0 md:pl-0 lg:grid-cols-3">
      {c.next.rows.map(([what, brings], i) => (
        <motion.li key={what} variants={item} className="relative md:border-t md:border-line md:pt-6">
          <span aria-hidden className="absolute top-1.5 -left-[37px] size-2.5 rounded-full bg-accent ring-4 ring-bg md:-top-[5px] md:left-0" />
          <p className="text-xs font-semibold tracking-[0.08em] text-ink-2 tabular-nums">{String(i + 1).padStart(2, '0')}</p>
          <h3 className="mt-1 text-lg font-bold">{what}</h3>
          <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{brings}</p>
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
    <Reveal className="max-w-[920px] border-t border-line">
      {c.faq.items.map(({ q, a, href }, i) => (
        <div key={q} className="border-b border-line">
          <h3>
            <button aria-expanded={open === i} aria-controls={`faq-${i}`} onClick={() => setOpen(open === i ? null : i)} className="flex w-full cursor-pointer items-center justify-between gap-4 py-5 text-left text-[17px] font-semibold">
              {q}
              <motion.span animate={{ rotate: open === i ? 45 : 0 }} transition={{ duration: 0.25, ease: EASE }} className="grid size-8 shrink-0 place-items-center rounded-full border border-line text-ink-2">
                <Plus size={16} aria-hidden />
              </motion.span>
            </button>
          </h3>
          <AnimatePresence initial={false}>
            {open === i && (
              <motion.div id={`faq-${i}`} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                <p className="max-w-[760px] pb-6 text-[15px] leading-relaxed text-ink-2">{href ? linked(a, href) : a}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </Reveal>
  )
}

/** Discord and GitHub Discussions, on one wide card with the playback blue's glow. */
export function Community() {
  const c = useCopy()
  return (
    <section id="community" className="mx-auto max-w-[1440px] px-(--pad) pb-[clamp(64px,9vw,128px)]">
      <Reveal className={`${card} relative overflow-hidden px-[clamp(24px,5vw,72px)] py-[clamp(40px,6vw,88px)]`}>
        <div aria-hidden className="pointer-events-none absolute -top-1/2 -right-1/4 size-[640px] rounded-full bg-accent/25 blur-[120px]" />
        <div className="relative flex flex-col items-start gap-5">
          <Eyebrow>Discord · GitHub</Eyebrow>
          <h2 className={h2}>{c.community.title}</h2>
          <p className="max-w-[560px] text-[clamp(15px,1.2vw,17px)] leading-relaxed text-ink-2">{c.community.text}</p>
          <p className="mt-2 flex flex-wrap gap-3 text-[15px] font-semibold">
            <a href={DISCORD} rel="noopener" className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-on-ink">
              <Brand path={siDiscord.path} /> {c.community.join} <ArrowRight size={16} aria-hidden />
            </a>
            <a href={`${GITHUB}/discussions`} className="inline-flex items-center gap-2 rounded-full border border-line bg-bg px-6 py-3 hover:border-ink-3">
              <Brand path={siGithub.path} /> {c.community.discussions}
            </a>
          </p>
        </div>
      </Reveal>
    </section>
  )
}
