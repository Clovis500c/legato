import { type Box, clampRatio, contentBox, FULL, mayHaveBars } from './artbox'

export interface Fit {
  box: Box
  ratio: number
  width: number
  height: number
}

// Per image: measured once, small copy. List rows measure too: room for a long scroll.
export const fits = new Map<string, Fit>()
// Long side of the copy. 160 px lost thin seams to the downscale (2026-10-20 report); 320 keeps them.
const SAMPLE = 320

/** Loaded image → real art box (video bars cut) and shape. Cached by src; an unreadable image isn't (retried). */
export function measure(img: HTMLImageElement, src: string): Fit {
  const width = img.naturalWidth
  const height = img.naturalHeight
  let box = FULL
  let readable = true
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
        // Area averaging: a 2 px line still shows in the copy.
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, w, h)
        box = contentBox(ctx.getImageData(0, 0, w, h).data, w, h)
      } else readable = false
    } catch {
      // Pixels unreadable: whole image, this time.
      readable = false
    }
  }
  const fit = { box, width, height, ratio: clampRatio((box.w * width) / (box.h * height) || 1) }
  if (readable) {
    if (fits.size > 3000) fits.delete(fits.keys().next().value!)
    fits.set(src, fit)
  }
  return fit
}

/** Art box of a loaded image: cached, measured if it may hold bars, else whole. */
export const boxOf = (img: HTMLImageElement, src: string): Box => fits.get(src)?.box ?? (mayHaveBars(src) ? measure(img, src).box : FULL)

/** drawImage arguments for only the box of a loaded image. */
export function sourceRect(img: HTMLImageElement, box: Box): [number, number, number, number] {
  return [box.x * img.naturalWidth, box.y * img.naturalHeight, box.w * img.naturalWidth, box.h * img.naturalHeight]
}

/** Same, loading the image first (menus: no Cover on screen). Rejects when it doesn't load. */
export function loadFit(src: string): Promise<Fit> {
  const known = fits.get(src)
  if (known) return Promise.resolve(known)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(measure(img, src))
    img.onerror = () => reject(new Error('Cover not available'))
    img.src = src
  })
}
