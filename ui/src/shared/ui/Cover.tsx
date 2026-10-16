import { useState } from 'react'
import { isLetterboxed } from '../art'

/** Artwork with a typographic fallback tile (initials). art = image candidates, best first (shared/art); each failed one falls to the next. eager = big, on screen right away. */
export function Cover({ title, art = [], size = 38, className = '', eager = false }: { title: string; art?: string[]; size?: number; className?: string; eager?: boolean }) {
  // Failed URLs, not an index: virtualized rows reuse this component for other tracks.
  const [failed, setFailed] = useState<string[]>([])
  const src = art.find((s) => !failed.includes(s))
  const initials = title
    .replace(/[([].*?[)\]]/g, '')
    .split(/\s+/)
    .filter((w) => /\p{L}|\d/u.test(w))
    .slice(0, 2)
    .map((w) => w.match(/[\p{L}\d]/u)![0])
    .join('')
    .toUpperCase()
  return (
    <span aria-hidden className={`relative grid shrink-0 place-items-center overflow-hidden rounded-cover border border-line-soft bg-recess font-mono font-semibold text-ink-3 ${className}`} style={{ width: size, height: size, fontSize: Math.max(9, size * 0.3) }}>
      {initials || '♪'}
      {src && (
        <img
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          crossOrigin="anonymous"
          draggable={false}
          onError={() => setFailed((f) => [...f, src])}
          className={`absolute inset-0 size-full object-cover ${isLetterboxed(src) ? 'scale-[1.34]' : ''}`}
        />
      )}
    </span>
  )
}
