import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import type { ReactNode } from 'react'
import og from '@/assets/og.jpg'
import { Motion } from './motion'
import { COPIES } from './copies'
import { LANGS } from './langs'
import { pick, SAVED } from './pick'
import '../app/globals.css'

// Served from here (OFL, public/roboto-LICENSE.txt): no font host sees the visitors.
const roboto = localFont({ src: '../app/fonts/roboto.woff2', weight: '100 900', variable: '--font-roboto', display: 'swap' })

// Absolute: the pages of every language point at each other (hreflang).
const SITE = '/legato/'

/** A language's page metadata: its title and line, the others as alternates. */
export function metadataOf(code: string): Metadata {
  const c = COPIES[code]
  const path = code === 'en' ? SITE : `${SITE}${code}/`
  const languages = Object.fromEntries([...LANGS.filter((l) => COPIES[l.code]).map((l) => [COPIES[l.code].lang, l.code === 'en' ? SITE : `${SITE}${l.code}/`]), ['x-default', SITE]])
  return {
    metadataBase: new URL('https://clovis500c.github.io'),
    title: c.title,
    description: c.hero.lead,
    alternates: { canonical: path, languages },
    openGraph: { type: 'website', title: 'Legato', description: c.hero.lead, url: path, images: [{ url: og.src, width: og.width, height: og.height }] },
    twitter: { card: 'summary_large_image' },
  }
}

export const VIEWPORT: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#131313' },
  ],
}

/** The English root sends a visitor to their own language's page before the first paint (`pick`; nothing leaves the browser). */
const toTheirs = (codes: string[]) =>
  `(function(){var s=null;try{s=localStorage.getItem(${JSON.stringify(SAVED)})}catch(e){}` +
  `var t=(${pick.toString()})(s,navigator.languages||[navigator.language],${JSON.stringify(codes)});` +
  `if(t!=='en')location.replace(t+'/'+location.search+location.hash)})()`

/** html and body of a language's page (each language is its own root layout: its own html lang). `redirect` off: a page
 *  that exists in English only (a shared playlist's). */
export function Shell({ code, children, redirect = true }: { code: string; children: ReactNode; redirect?: boolean }) {
  const c = COPIES[code]
  return (
    <html lang={c.lang} className={roboto.variable}>
      <body>
        {code === 'en' && redirect && <script dangerouslySetInnerHTML={{ __html: toTheirs(Object.keys(COPIES)) }} />}
        <a href="#main" className="fixed -top-12 left-4 z-30 rounded-full bg-ink px-3.5 py-2 text-on-ink focus:top-4">
          {c.skip}
        </a>
        <Motion>{children}</Motion>
      </body>
    </html>
  )
}
