import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Shell, VIEWPORT } from '@/components/Shell'

// The docs: English in every language, one page at /docs/; the English root's send-off to the visitor's language never runs here.
export const metadata: Metadata = {
  metadataBase: new URL('https://clovis500c.github.io'),
  title: 'Legato docs',
  description: 'Install, import, sync and share with Legato; the architecture, plugins, themes and how to build and contribute.',
  alternates: { canonical: '/legato/docs/' },
}
export const viewport = VIEWPORT

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <Shell code="en" redirect={false}>
      {children}
    </Shell>
  )
}
