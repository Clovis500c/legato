import { useEffect, useState } from 'react'
import { boxOf, sourceRect } from '../../shared/artfit'

// Canvas width; the window is ~6× wider, so 1 canvas px of blur ≈ 6 screen px.
const SIZE = 320
const SCREEN = 1920
const cache = new Map<string, string>()

/**
 * Cover blurred once on a canvas, returned as an image to stretch full screen. A live CSS blur on a full-window layer
 * costs a lot every repaint; a pre-blurred image costs nothing after. blur = screen px (Settings › Advanced). Drawn past
 * the edges so the blur has no transparent rim. Needs CORS (art scheme sends it).
 */
export function blurredBackdrop(src: string, blur: number): Promise<string> {
  const key = `${blur}|${src}`
  const hit = cache.get(key)
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
      ctx.filter = `blur(${(blur * SIZE) / SCREEN}px) saturate(1.5)`
      const pad = blur ? SIZE * 0.12 : 0
      // Video frames: the picture only, not its black bars.
      ctx.drawImage(img, ...sourceRect(img, boxOf(img, src)), -pad, -pad, SIZE + 2 * pad, SIZE + 2 * pad)
      const url = c.toDataURL('image/jpeg', 0.92)
      if (cache.size > 40) cache.delete(cache.keys().next().value!)
      cache.set(key, url)
      resolve(url)
    }
    img.onerror = () => reject(new Error('Cover not readable'))
    img.src = src
  })
}

/** Backdrop image for the current cover; keeps the last one until the next is ready (no flash between songs). */
export function useBackdrop(src: string | undefined, blur: number): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!src) return
    let live = true
    blurredBackdrop(src, blur).then((u) => live && setUrl(u), () => {})
    return () => {
      live = false
    }
  }, [src, blur])
  return src ? url : undefined
}
