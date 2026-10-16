import { HardDrives } from '@phosphor-icons/react'
import { siApplemusic, siSpotify, siYoutube } from 'simple-icons'
import type { Source } from '../api'

const brands = { spotify: siSpotify, youtube: siYoutube, apple: siApplemusic }

export const sourceLabel: Record<Source, string> = { spotify: 'Spotify', youtube: 'YouTube', local: 'Fichiers locaux', apple: 'Apple Music' }

/** Monochrome brand logo (simple-icons, CC0) or drive icon for local. Color = currentColor. */
export function SourceIcon({ source, size = 14 }: { source: Source; size?: number }) {
  if (source === 'local') return <HardDrives size={size} className="shrink-0" aria-label={sourceLabel.local} />
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="shrink-0 fill-current" role="img">
      <title>{sourceLabel[source]}</title>
      <path d={brands[source].path} />
    </svg>
  )
}
