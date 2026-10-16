import { type Box, clampRatio, contentBox, FULL, mayHaveBars } from './artbox'

export interface Fit {
  box: Box
  ratio: number
  width: number
  height: number
}

// Per image: measured once, small copy (bars only need a coarse look).
export const fits = new Map<string, Fit>()
const SAMPLE = 160

/** Loaded image → real art box (video bars cut) and shape. Cached by src. */
export function measure(img: HTMLImageElement, src: string): Fit {
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
