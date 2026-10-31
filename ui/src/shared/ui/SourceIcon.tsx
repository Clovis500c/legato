import { Folder } from '@phosphor-icons/react'
import type { CSSProperties } from 'react'
import { siApplemusic, siDeezer, siSpotify, siYoutubemusic } from 'simple-icons'
import type { Source } from '../api'
import { msg, tr } from '../i18n/i18n'

// As in the mockup (Figma Source/Badge): YouTube Music's logo for YouTube, a folder for local files.
const brands = { spotify: siSpotify, youtube: siYoutubemusic, apple: siApplemusic }

export const sourceLabel: Record<Source, string> = { spotify: 'Spotify', youtube: 'YouTube', local: msg('Local files'), apple: 'Apple Music' }

/** The service a pasted link comes from: Deezer has no library source, so its logo is drawn here. */
export function LinkBrand({ kind, size = 14 }: { kind: 'spotify' | 'deezer' | 'apple' | 'youtube'; size?: number }) {
  if (kind !== 'deezer') return <SourceIcon source={kind} size={size} />
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="shrink-0 fill-current" role="img">
      <title>Deezer</title>
      <path d={siDeezer.path} />
    </svg>
  )
}

/** Monochrome brand logo (simple-icons, CC0) or folder for local. Color = currentColor; brand: the service's own color while its row (group) is hovered. */
export function SourceIcon({ source, size = 14, brand = false }: { source: Source; size?: number; brand?: boolean }) {
  if (source === 'local') return <Folder size={size} className="shrink-0" aria-label={tr(sourceLabel.local)} />
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={`shrink-0 fill-current ${brand ? 'group-hover:text-[var(--brand)]' : ''}`} style={brand ? ({ '--brand': `#${brands[source].hex}` } as CSSProperties) : undefined} role="img">
      <title>{sourceLabel[source]}</title>
      <path d={brands[source].path} />
    </svg>
  )
}
