import type { ReactNode } from 'react'
import { metadataOf, Shell, VIEWPORT } from '@/components/Shell'

// English at the site's root; the other languages under their code ([lang]), each its own root layout.
export const metadata = metadataOf('en')
export const viewport = VIEWPORT

export default function EnglishLayout({ children }: { children: ReactNode }) {
  return <Shell code="en">{children}</Shell>
}
