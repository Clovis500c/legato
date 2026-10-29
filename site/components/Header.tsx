'use client'

import { motion, useMotionValueEvent, useScroll } from 'motion/react'
import { useState } from 'react'
import { GITHUB } from './content'
import { useLatest } from './latest'
import { Logo } from './Logo'

const LINKS = [
  ['What it fixes', '#fixes'],
  ['Features', '#features'],
  ['Privacy', '#privacy'],
  ['FAQ', '#faq'],
  ['GitHub', GITHUB],
]

/** On the page at first; a frosted bar once the page scrolls under it. */
export function Header() {
  const { scrollY } = useScroll()
  const [frost, setFrost] = useState(false)
  useMotionValueEvent(scrollY, 'change', (y) => setFrost(y > 16))
  const { href } = useLatest()
  return (
    <header className={`sticky top-0 z-20 border-b transition-[background-color,border-color] duration-300 ${frost ? 'border-line-soft bg-bg/80 backdrop-blur-xl backdrop-saturate-150' : 'border-transparent'}`}>
      <div className="mx-auto flex h-[78px] max-w-[1440px] items-center justify-between gap-6 px-(--pad)">
        <a href="#top" aria-label="Music App, top of the page" className="group flex items-center gap-2.5 text-2xl font-black tracking-[-0.02em]">
          <Logo className="size-[30px] transition-transform duration-500 ease-out group-hover:-rotate-8" />
          Music App
        </a>
        <nav aria-label="Sections" className="flex items-center gap-7">
          {LINKS.map(([label, to]) => (
            <a key={to} href={to} className="hidden text-sm font-medium text-ink-2 transition-colors hover:text-ink md:inline">
              {label}
            </a>
          ))}
          <motion.a href={href} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }} className="rounded-full bg-ink px-[18px] py-[9px] text-sm leading-5 font-medium text-on-ink">
            Download
          </motion.a>
        </nav>
      </div>
    </header>
  )
}
