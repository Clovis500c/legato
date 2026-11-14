'use client'

import { siDiscord, siGithub } from 'simple-icons'
import { DISCORD, GITHUB, linked } from './content'
import { useCopy } from './copy'
import { rootOf } from './langs'
import { useAndroid, useLatest } from './latest'
import { Logo } from './Logo'
import { Brand } from './Sections'

const link = 'text-ink-2 transition-colors hover:text-ink'

/** The page's foot, the same on the home page and the docs: the app, the community, the legal lines. */
export function Footer({ base = '' }: { base?: string }) {
  const c = useCopy()
  const root = base || rootOf(c.lang)
  const { href } = useLatest()
  const android = useAndroid()
  const columns: [string, [string, string][]][] = [
    ['Legato', [[c.nav.download, href], [`${c.hero.android} (APK)`, android.href], [c.footer.releases, `${GITHUB}/releases`], [c.nav.docs, `${root}docs/`]]],
    [c.footer.community, [['Discord', DISCORD], ['GitHub Discussions', `${GITHUB}/discussions`], ['GitHub', GITHUB], [c.footer.docs, `${GITHUB}/tree/master/docs`]]],
    [c.footer.legal, [[c.footer.license, `${GITHUB}/blob/master/LICENSE`], [c.footer.notices, `${root}third-party-licenses.txt`], [c.footer.font, `${root}roboto-LICENSE.txt`]]],
  ]
  return (
    <footer className="border-t border-line-soft bg-panel text-sm">
      <div className="mx-auto grid max-w-[1440px] grid-cols-2 gap-x-8 gap-y-10 px-(--pad) pt-14 pb-10 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="col-span-2 flex flex-col items-start gap-4 md:col-span-1">
          <p data-brand className="flex items-center gap-2.5 text-2xl leading-none font-black tracking-[-0.02em]">
            <Logo className="size-7" />
            Legato
          </p>
          <p className="max-w-[340px] text-ink-2">{c.hero.lead}</p>
          <p className="flex gap-2">
            <a href={DISCORD} rel="noopener" aria-label="Discord" className="grid size-10 place-items-center rounded-full border border-line text-ink-2 hover:text-ink">
              <Brand path={siDiscord.path} />
            </a>
            <a href={GITHUB} aria-label="GitHub" className="grid size-10 place-items-center rounded-full border border-line text-ink-2 hover:text-ink">
              <Brand path={siGithub.path} />
            </a>
          </p>
        </div>
        {columns.map(([title, links]) => (
          <nav key={title} aria-label={title}>
            <h2 className="mb-4 text-[13px] font-semibold tracking-[0.08em] uppercase">{title}</h2>
            <ul className="flex flex-col gap-2.5">
              {links.map(([label, to]) => (
                <li key={label}>
                  <a href={to} className={link}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto flex max-w-[1440px] flex-wrap justify-between gap-x-8 gap-y-2 border-t border-line-soft px-(--pad) py-6 text-[13px] text-ink-2">
        <p>{linked(c.footer.code, GITHUB, 'text-ink underline decoration-line underline-offset-4 hover:decoration-ink')}</p>
        <p>{c.footer.marks} Simple Icons (CC0).</p>
      </div>
    </footer>
  )
}
