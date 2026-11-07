import type { ReactNode } from 'react'
import { COPIES } from '@/components/copies'
import { metadataOf, Shell, VIEWPORT } from '@/components/Shell'

type Params = { params: Promise<{ lang: string }> }

// One page per language the copies hold, at /<code>/; no other.
export const dynamicParams = false
export const generateStaticParams = () => Object.keys(COPIES).filter((code) => code !== 'en').map((lang) => ({ lang }))
export const viewport = VIEWPORT

export async function generateMetadata({ params }: Params) {
  return metadataOf((await params).lang)
}

export default async function LanguageLayout({ children, params }: Params & { children: ReactNode }) {
  return <Shell code={(await params).lang}>{children}</Shell>
}
