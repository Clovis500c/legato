import { useEffect, useState } from 'react'
import { isLetterboxed, sizedArt } from '../art'
import { cropStyle, cropTo, mayHaveBars } from '../artbox'
import { fits, measure } from '../artfit'

/**
 * Artwork with a typographic fallback tile (initials). art = image candidates, best first (shared/art); each failed one falls to the next. eager = big, on screen right away.
 * Video frames: black bars cut off, art centered in the square. fit = big cover: real shape reported instead (the
 * parent sizes the frame to it).
 */
export function Cover({ title, art = [], size = 38, className = '', eager = false, fit }: { title: string; art?: string[]; size?: number; className?: string; eager?: boolean; fit?: (ratio: number) => void }) {
  // Failed URLs, not an index: virtualized rows reuse this component for other tracks.
  const [failed, setFailed] = useState<string[]>([])
  const full = art.find((s) => !failed.includes(s))
  const [, setMeasured] = useState(0)
  // Measured once per image (cached): video frames everywhere, any image for the big cover.
  const measured = !!full && (!!fit || mayHaveBars(full))
  // Lists never decode a full-size cover: the smallest thumbnail that covers the drawn size (Rust cuts it once, then keeps it). The big cover (fit) wants the picture itself.
  const src = full && (fit ? full : sizedArt(full, size, window.devicePixelRatio || 1, measured ? 256 : 0))
  const known = measured && src ? fits.get(src) : undefined
  useEffect(() => {
    if (known) fit?.(known.ratio)
  }, [known, fit])
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
          onError={() => setFailed((f) => [...f, full!])}
          onLoad={(e) => {
            if (!measured || fits.has(src)) return
            measure(e.currentTarget, src)
            setMeasured((n) => n + 1)
          }}
          style={known ? cropStyle(cropTo(known.box, known.width, known.height, fit ? known.ratio : 1)) : undefined}
          className={known ? 'absolute' : `absolute inset-0 size-full object-cover ${isLetterboxed(full!) ? 'scale-[1.34]' : ''}`}
        />
      )}
    </span>
  )
}
