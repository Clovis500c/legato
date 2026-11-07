'use client'

import { Translate } from '@phosphor-icons/react'
import { useMotionValueEvent, useScroll } from 'motion/react'
import { useState } from 'react'
import { GITHUB } from './content'
import { useCopy, useLangs } from './copy'
import { LANGS, pageOf } from './langs'
import { useLatest } from './latest'
import { Logo } from './Logo'
import { SAVED } from './pick'

/** The page's code among LANGS ('pt' for pt-BR, 'zh' for zh-Hans). */
const codeOf = (lang: string) => lang.split('-')[0]

/** A language picked here wins over the browser's at the next visit of the root (`pick`). */
const save = (code: string) => {
  try {
    localStorage.setItem(SAVED, code)
  } catch {
    // Storage blocked: the browser's languages decide.
  }
}

/** On the page at first; a solid bar once the page scrolls under it. */
export function Header() {
  const c = useCopy()
  const { scrollY } = useScroll()
  const [solid, setSolid] = useState(false)
  useMotionValueEvent(scrollY, 'change', (y) => setSolid(y > 16))
  const { href } = useLatest()
  const here = codeOf(c.lang)
  const langs = useLangs()
  const links = [
    [c.nav.fixes, '#fixes'],
    [c.nav.why, '#why'],
    [c.nav.features, '#features'],
    [c.nav.privacy, '#privacy'],
    [c.nav.next, '#next'],
    [c.nav.faq, '#faq'],
    ['GitHub', GITHUB],
  ]
  return (
    <header id="site-header" className={`sticky top-0 z-20 border-b transition-[background-color,border-color,transform] duration-200 ${solid ? 'border-line-soft bg-bg' : 'border-transparent'}`}>
      <div className="mx-auto flex h-[78px] max-w-[1440px] items-center justify-between gap-6 px-(--pad)">
        <a href="#top" aria-label={c.nav.top} className="flex items-center gap-2.5 text-[28px] leading-none font-black tracking-[-0.02em]">
          <Logo className="size-8" />
          Legato
        </a>
        <nav aria-label={c.nav.sections} className="flex items-center gap-7">
          {links.map(([label, to]) => (
            // Longer words than English's: the links wait for a wider window.
            <a key={to} href={to} className={`hidden text-sm font-medium whitespace-nowrap text-ink-2 transition-colors hover:text-ink ${here === 'en' ? 'lg:inline' : 'xl:inline'}`}>
              {label}
            </a>
          ))}
          {/* Every language's page, by its own name; no script needed. */}
          <details className="relative">
            <summary aria-label={c.nav.language} title={c.nav.language} className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
              <Translate size={18} aria-hidden />
              <span className="uppercase">{here}</span>
            </summary>
            <ul className="absolute right-0 mt-3 max-h-[70vh] w-56 overflow-y-auto rounded-xl border border-line bg-bg p-1.5 shadow-lg">
              {LANGS.filter((l) => langs.includes(l.code)).map((l) => (
                <li key={l.code}>
                  <a href={pageOf(here, l.code)} onClick={() => save(l.code)} hrefLang={l.code} lang={l.code} aria-current={l.code === here ? 'page' : undefined} className="block rounded-lg px-3 py-1.5 text-sm text-ink-2 hover:bg-panel hover:text-ink aria-[current=page]:font-medium aria-[current=page]:text-ink">
                    {l.name}
                  </a>
                </li>
              ))}
            </ul>
          </details>
          <a href={href} className="rounded-full bg-ink px-[18px] py-[9px] text-sm leading-5 font-medium whitespace-nowrap text-on-ink">
            {c.nav.download}
          </a>
        </nav>
      </div>
    </header>
  )
}
