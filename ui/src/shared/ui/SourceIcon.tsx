import { HardDrive } from 'lucide-react'
import { siSpotify, siYoutubemusic } from 'simple-icons'
import type { Source } from '../api'

const brands = { spotify: siSpotify, youtube: siYoutubemusic }

export const sourceLabel: Record<Source, string> = { spotify: 'Spotify', youtube: 'YouTube Music', local: 'Fichiers locaux' }

export const sourceColor: Record<Source, string> = { spotify: 'text-spotify', youtube: 'text-youtube', local: 'text-local' }

/** Brand logo (simple-icons, CC0) or lucide icon for local. */
export function SourceIcon({ source, size = 16 }: { source: Source; size?: number }) {
  if (source === 'local') return <HardDrive size={size} className="shrink-0 text-local" aria-label={sourceLabel.local} />
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={`shrink-0 fill-current ${sourceColor[source]}`} role="img">
      <title>{sourceLabel[source]}</title>
      <path d={brands[source].path} />
    </svg>
  )
}
