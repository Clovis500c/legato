'use client'

import { useMotionValueEvent, useScroll } from 'motion/react'
import { useState } from 'react'
import { GITHUB } from './content'
import { useLatest } from './latest'
import { Logo } from './Logo'

const LINKS = [
  ['What it fixes', '#fixes'],
  ['Why Legato', '#why'],
  ['Features', '#features'],
  ['Privacy', '#privacy'],
  ['Next', '#next'],
  ['FAQ', '#faq'],
  ['GitHub', GITHUB],
]

/** On the page at first; a solid bar once the page scrolls under it. */
export function Header() {
  const { scrollY } = useScroll()
  const [solid, setSolid] = useState(false)
  useMotionValueEvent(scrollY, 'change', (y) => setSolid(y > 16))
  const { href } = useLatest()
  return (
    <header id="site-header" className={`sticky top-0 z-20 border-b transition-[background-color,border-color,transform] duration-200 ${solid ? 'border-line-soft bg-bg' : 'border-transparent'}`}>
      <div className="mx-auto flex h-[78px] max-w-[1440px] items-center justify-between gap-6 px-(--pad)">
        <a href="#top" aria-label="Legato, top of the page" className="flex items-center gap-2.5 text-[28px] leading-none font-black tracking-[-0.02em]">
          <Logo className="size-8" />
          Legato
        </a>
        <nav aria-label="Sections" className="flex items-center gap-7">
          {LINKS.map(([label, to]) => (
            <a key={to} href={to} className="hidden text-sm font-medium text-ink-2 transition-colors hover:text-ink md:inline">
              {label}
            </a>
          ))}
          <a href={href} className="rounded-full bg-ink px-[18px] py-[9px] text-sm leading-5 font-medium text-on-ink">
            Download
          </a>
        </nav>
      </div>
    </header>
  )
}
