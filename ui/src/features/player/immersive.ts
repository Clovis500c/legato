import { useEffect, useState } from 'react'

const SIZE = 96
const cache = new Map<string, string>()

/**
 * Cover blurred once on a small canvas, returned as an image to stretch full screen. A live CSS blur on a full-window
 * layer costs a lot every repaint; a pre-blurred 96 px image upscaled stays smooth (only soft shapes left) and costs
 * nothing after. Drawn past the edges so the blur has no transparent rim. Needs CORS (art scheme sends it).
 */
export function blurredBackdrop(src: string): Promise<string> {
  const hit = cache.get(src)
  if (hit) return Promise.resolve(hit)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = c.height = SIZE
      const ctx = c.getContext('2d')
      if (!ctx) return reject(new Error('No 2D canvas'))
      ctx.filter = 'blur(7px) saturate(1.6)'
      const pad = SIZE * 0.2
      ctx.drawImage(img, -pad, -pad, SIZE + 2 * pad, SIZE + 2 * pad)
      const url = c.toDataURL('image/jpeg', 0.92)
      if (cache.size > 40) cache.delete(cache.keys().next().value!)
      cache.set(src, url)
      resolve(url)
    }
    img.onerror = () => reject(new Error('Cover not readable'))
    img.src = src
  })
}

/** Backdrop image for the current cover; keeps the last one until the next is ready (no flash between songs). */
export function useBackdrop(src: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!src) return
    let live = true
    blurredBackdrop(src).then((u) => live && setUrl(u), () => {})
    return () => {
      live = false
    }
  }, [src])
  return src ? url : undefined
}
