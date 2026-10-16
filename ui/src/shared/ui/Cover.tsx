import { useEffect, useState } from 'react'
import { isLetterboxed } from '../art'
import { type Box, clampRatio, contentBox, cropStyle, cropTo, FULL, mayHaveBars } from '../artbox'

interface Fit {
  box: Box
  ratio: number
  width: number
  height: number
}

// Per image: measured once, small copy (bars only need a coarse look).
const fits = new Map<string, Fit>()
const SAMPLE = 160

function measure(img: HTMLImageElement, src: string): Fit {
  const width = img.naturalWidth
  const height = img.naturalHeight
  let box = FULL
  if (mayHaveBars(src)) {
    try {
      const scale = Math.min(1, SAMPLE / Math.max(width, height))
      const w = Math.max(1, Math.round(width * scale))
      const h = Math.max(1, Math.round(height * scale))
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h)
        box = contentBox(ctx.getImageData(0, 0, w, h).data, w, h)
      }
    } catch {
      // Pixels unreadable: whole image.
    }
  }
  const fit = { box, width, height, ratio: clampRatio((box.w * width) / (box.h * height) || 1) }
  if (fits.size > 200) fits.delete(fits.keys().next().value!)
  fits.set(src, fit)
  return fit
}

/**
 * Artwork with a typographic fallback tile (initials). art = image candidates, best first (shared/art); each failed one falls to the next. eager = big, on screen right away.
 * fit = big cover: black bars of video frames cut off, real shape reported (the parent sizes the frame to it).
 */
export function Cover({ title, art = [], size = 38, className = '', eager = false, fit }: { title: string; art?: string[]; size?: number; className?: string; eager?: boolean; fit?: (ratio: number) => void }) {
  // Failed URLs, not an index: virtualized rows reuse this component for other tracks.
  const [failed, setFailed] = useState<string[]>([])
  const src = art.find((s) => !failed.includes(s))
  const [, setMeasured] = useState(0)
  const known = fit && src ? fits.get(src) : undefined
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
          onError={() => setFailed((f) => [...f, src])}
          onLoad={(e) => {
            if (!fit || fits.has(src)) return
            measure(e.currentTarget, src)
            setMeasured((n) => n + 1)
          }}
          style={known ? cropStyle(cropTo(known.box, known.width, known.height, known.ratio)) : undefined}
          className={known ? 'absolute' : `absolute inset-0 size-full object-cover ${isLetterboxed(src) ? 'scale-[1.34]' : ''}`}
        />
      )}
    </span>
  )
}
