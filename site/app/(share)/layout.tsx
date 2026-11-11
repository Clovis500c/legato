import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Shell, VIEWPORT } from '@/components/Shell'

// A shared playlist's page: its own root layout, so the English root's send-off to the visitor's language never runs
// here (there is no /l/ under a language). Not for search engines: the page is empty without a link's fragment.
export const metadata: Metadata = { title: 'A playlist shared with Legato', robots: { index: false } }
export const viewport = VIEWPORT

export default function ShareLayout({ children }: { children: ReactNode }) {
  return (
    <Shell code="en" redirect={false}>
      {children}
    </Shell>
  )
}
