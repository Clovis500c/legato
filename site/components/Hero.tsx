'use client'

import { ArrowRight, FolderSimple, WindowsLogo } from '@phosphor-icons/react'
import { motion, useScroll, useTransform, type Variants } from 'motion/react'
import { useRef } from 'react'
import { siApplemusic, siSpotify, siYoutubemusic } from 'simple-icons'
import dark from '@/assets/app-dark.png'
import light from '@/assets/app-light.png'
import { useLatest } from './latest'
import { EASE } from './motion'

const rise: Variants = { hidden: { opacity: 0, y: '0.35em' }, show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } } }

const Brand = ({ path }: { path: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className="size-[15px] fill-current">
    <path d={path} />
  </svg>
)

const WORKS = [
  [<Brand key="y" path={siYoutubemusic.path} />, 'YouTube Music'],
  [<Brand key="s" path={siSpotify.path} />, 'Spotify (Premium, your app key)'],
  [<Brand key="a" path={siApplemusic.path} />, 'Apple Music (catalog, previews)'],
  [<FolderSimple key="f" size={15} />, 'Your folders'],
] as const

/** The mockup's hero: the headline is the picture, line by line. */
export function Hero() {
  const { href, version } = useLatest()
  return (
    <motion.div id="top" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.08 } } }} className="mx-auto flex max-w-[1440px] flex-col items-start gap-6 px-(--pad) pt-[clamp(32px,6vw,64px)] pb-12">
      <h1 className="text-[clamp(44px,7.4vw,96px)] leading-none font-black tracking-[-0.03em]">
        {['Your music lives', 'in four apps.', 'Play it from one.'].map((line) => (
          <motion.span key={line} variants={rise} className="block">
            {line}{' '}
          </motion.span>
        ))}
      </h1>
      <motion.p variants={rise} className="max-w-[640px] text-[clamp(16px,1.4vw,18px)] leading-[1.45] font-medium text-ink-2">
        Legato puts YouTube Music, Spotify, Apple Music and the files on your PC into one library and one player, on Windows, with no account of ours.
      </motion.p>
      <motion.div variants={rise} className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <motion.a href={href} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }} className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-[15px] font-medium text-on-ink shadow-[0_8px_24px_-12px_rgb(0_0_0/0.5)]">
          <WindowsLogo size={18} weight="fill" /> Download for Windows
        </motion.a>
        <a href="#privacy" className="group inline-flex items-center gap-1.5 text-[15px] font-medium">
          What leaves your PC <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
        </a>
      </motion.div>
      <motion.p variants={rise} className="-mt-2 text-[13px] text-ink-3">
        Free · Windows 10 and 11{version && ` · Version ${version}`}
      </motion.p>
      <motion.ul variants={rise} aria-label="Works with" className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2.5 text-[13px] text-ink-2">
        <li aria-hidden className="text-ink-3">
          Works with
        </li>
        {WORKS.map(([icon, label]) => (
          <li key={label} className="flex items-center gap-[7px]">
            {icon}
            {label}
          </li>
        ))}
      </motion.ul>
    </motion.div>
  )
}

/** The Songs page, bleeding off the right edge like the mockup; it drifts a little against the scroll. */
export function Shot() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], [40, -40])
  return (
    <div ref={ref} className="overflow-hidden pb-6 pl-[max(var(--pad),calc((100vw-1440px)/2+312px))] max-[999px]:pr-(--pad)">
      <motion.div style={{ y }}>
        <motion.picture initial={{ opacity: 0, y: 64, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 1.1, ease: EASE, delay: 0.3 }} className="block">
          <source srcSet={dark.src} media="(prefers-color-scheme: dark)" />
          <img src={light.src} width={1128} height={640} alt="Legato's Songs page: your library on the left, songs from YouTube Music, Spotify, Apple Music and your folders in one list, Up next on the right." className="block h-auto w-full rounded-xl shadow-(--shot-shadow) min-[1000px]:w-[1128px] min-[1000px]:max-w-none" />
        </motion.picture>
      </motion.div>
    </div>
  )
}
