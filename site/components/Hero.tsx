'use client'

import { ArrowRight, FolderSimple, WindowsLogo } from '@phosphor-icons/react'
import { motion, type Variants } from 'motion/react'
import { siApplemusic, siSpotify, siYoutubemusic } from 'simple-icons'
import { useCopy } from './copy'
import { useAndroid, useLatest } from './latest'
import { EASE } from './motion'

const rise: Variants = { hidden: { opacity: 0, y: '0.35em' }, show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE } } }

const Brand = ({ path }: { path: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className="size-[15px] fill-current">
    <path d={path} />
  </svg>
)


/** A letter's width in Roboto Black, roughly, an "n" being 1 (measured within 4 % for Latin and Cyrillic lines; a CJK glyph is a full em). */
const glyph = (ch: string) =>
  " .,:;!|’'ilIjtfr".includes(ch) ? 0.55
  : 'mwMWШЩМЫЖЮФ'.includes(ch) ? 1.5
  : 'шщмыжюф'.includes(ch) ? 1.35
  : ch.codePointAt(0)! >= 0x2e80 ? 2
  : ch !== ch.toLowerCase() ? 1.2
  : 1

/** The headline's size: English's, smaller when a language's longest line is wider than 13.3 "n"s (English's widest is 14, wherever it fits). */
const fit = (lines: string[]) => Math.min(1, 13.3 / Math.max(...lines.map((l) => [...l].reduce((n, ch) => n + glyph(ch), 0))))

/** The mockup's hero: the headline is the picture, line by line. */
export function Hero() {
  const { href, version } = useLatest()
  const android = useAndroid()
  const c = useCopy()
  const works = [
    [<Brand key="y" path={siYoutubemusic.path} />, 'YouTube Music'],
    [<Brand key="s" path={siSpotify.path} />, c.hero.spotify],
    [<Brand key="a" path={siApplemusic.path} />, c.hero.apple],
    [<FolderSimple key="f" size={15} />, c.hero.folders],
  ] as const
  return (
    <motion.div id="top" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.08 } } }} className="flex flex-col items-start gap-6 px-(--pad) pt-[clamp(32px,6vw,64px)] pb-12 pinned:p-0">
      <h1 style={{ ['--fit' as string]: fit(c.hero.lines) }} className="text-[length:calc(clamp(44px,7.4vw,96px)*var(--fit))] leading-none font-black tracking-[-0.03em] pinned:text-[length:calc(min(5.6vw,11vh)*var(--fit))]">
        {c.hero.lines.map((line) => (
          <motion.span key={line} variants={rise} className="block">
            {line}{' '}
          </motion.span>
        ))}
      </h1>
      <motion.p variants={rise} className="max-w-[640px] text-[clamp(16px,1.4vw,18px)] leading-[1.45] font-medium text-ink-2">
        {c.hero.lead}
      </motion.p>
      <motion.div variants={rise} className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <a href={href} className="inline-flex items-center gap-2 rounded-full bg-ink px-7 py-3.5 text-[15px] font-semibold text-on-ink shadow-[0_8px_30px_-8px] shadow-accent/50 transition-transform hover:-translate-y-px motion-reduce:transition-none">
          <WindowsLogo size={18} weight="fill" /> {c.hero.download}
        </a>
        <a href="#privacy" className="group inline-flex items-center gap-1.5 text-[15px] font-medium">
          {c.privacy.title} <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
        </a>
      </motion.div>
      <motion.p variants={rise} className="-mt-2 text-[13px] text-ink-3">
        {c.hero.free}
        {version && ` · ${c.hero.version.replace('{version}', version)}`}
        {' · '}
        <a href={android.href} className="underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink">
          {c.hero.android} (APK{android.version && `, ${android.version}`})
        </a>
      </motion.p>
      <motion.ul variants={rise} aria-label={c.hero.works} className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
        <li aria-hidden className="mr-1 text-ink-2">
          {c.hero.works}
        </li>
        {works.map(([icon, label]) => (
          <li key={label} className="flex items-center gap-[7px] rounded-full border border-line bg-bg/60 px-3 py-1.5 backdrop-blur">
            {icon}
            {label}
          </li>
        ))}
      </motion.ul>
    </motion.div>
  )
}

