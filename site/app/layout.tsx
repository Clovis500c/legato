import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import type { ReactNode } from 'react'
import dark from '@/assets/app-dark.png'
import { Motion } from '@/components/motion'
import './globals.css'

// Served from here (OFL, public/roboto-LICENSE.txt): no font host sees the visitors.
const roboto = localFont({ src: './fonts/roboto.woff2', weight: '100 900', variable: '--font-roboto', display: 'swap' })

const description = 'Music App puts YouTube Music, Spotify, Apple Music and the files on your PC into one library and one player, on Windows, with no account of ours.'

export const metadata: Metadata = {
  metadataBase: new URL('https://clovis500c.github.io'),
  title: 'Music App: one player for YouTube Music, Spotify, Apple Music and your files',
  description,
  openGraph: { type: 'website', title: 'Music App', description, images: [{ url: dark.src, width: dark.width, height: dark.height }] },
  twitter: { card: 'summary_large_image' },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#131313' },
  ],
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={roboto.variable}>
      <body>
        <a href="#main" className="fixed -top-12 left-4 z-30 rounded-full bg-ink px-3.5 py-2 text-on-ink focus:top-4">
          Skip to content
        </a>
        <Motion>{children}</Motion>
      </body>
    </html>
  )
}
