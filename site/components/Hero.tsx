'use client'

import { ArrowRight, FolderSimple, WindowsLogo } from '@phosphor-icons/react'
import { motion, type Variants } from 'motion/react'
import { siApplemusic, siSpotify, siYoutubemusic } from 'simple-icons'
import { useAndroid, useLatest } from './latest'
import { EASE } from './motion'

const rise: Variants = { hidden: { opacity: 0, y: '0.35em' }, show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE } } }

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
  const android = useAndroid()
  return (
    <motion.div id="top" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.08 } } }} className="flex flex-col items-start gap-6 px-(--pad) pt-[clamp(32px,6vw,64px)] pb-12 pinned:p-0">
      <h1 className="text-[clamp(44px,7.4vw,96px)] leading-none font-black tracking-[-0.03em] pinned:text-[min(5.6vw,11vh)]">
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
        <a href={href} className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-[15px] font-medium text-on-ink">
          <WindowsLogo size={18} weight="fill" /> Download for Windows
        </a>
        <a href="#privacy" className="group inline-flex items-center gap-1.5 text-[15px] font-medium">
          What leaves your PC <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
        </a>
      </motion.div>
      <motion.p variants={rise} className="-mt-2 text-[13px] text-ink-3">
        Free · Windows 10 and 11{version && ` · Version ${version}`}
        {' · '}
        <a href={android.href} className="underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink">
          Android beta (APK{android.version && `, ${android.version}`})
        </a>
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

