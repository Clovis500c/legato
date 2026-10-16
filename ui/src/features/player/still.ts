import { useEffect, useState } from 'react'
import { remoteArt } from '../../shared/art'

/** Mean absolute difference between two RGBA frames of the same size, 0 (same) to 1. */
export function frameDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
  return sum / ((a.length / 4) * 3 * 255)
}

/** Frames from across the video nearly the same (JPEG noise only): a still image, like most music uploads. */
export const isStill = (frames: Uint8ClampedArray[], threshold = 0.035) => frames.every((f, i) => i === 0 || frameDiff(frames[0], f) < threshold)

const KEY = 'still-videos'
let known: Record<string, boolean> = {}
try {
  known = JSON.parse(localStorage.getItem(KEY) ?? '{}')
} catch {
  // No cache: checked again.
}

function remember(id: string, still: boolean) {
  known[id] = still
  const ids = Object.keys(known)
  if (ids.length > 3000) for (const old of ids.slice(0, ids.length - 3000)) delete known[old]
  try {
    localStorage.setItem(KEY, JSON.stringify(known))
  } catch {
    // Storage off: per session only.
  }
}

const W = 32
const H = 24

function pixels(src: string): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (!ctx) return reject(new Error('No 2D canvas'))
      ctx.drawImage(img, 0, 0, W, H)
      resolve(ctx.getImageData(0, 0, W, H).data)
    }
    img.onerror = () => reject(new Error('No frame'))
    img.src = src
  })
}

/**
 * Still image or real video? YouTube keeps 3 small frames taken at 25 %, 50 % and 75 % of every video (1.jpg, 2.jpg,
 * 3.jpg): compared, never the player itself. Cached per video. null = couldn't tell.
 */
export async function stillVideo(id: string): Promise<boolean | null> {
  if (id in known) return known[id]
  try {
    const frames = await Promise.all([1, 2, 3].map((n) => pixels(remoteArt(`https://i.ytimg.com/vi/${id}/${n}.jpg`))))
    const still = isStill(frames)
    remember(id, still)
    return still
  } catch {
    return null
  }
}

/** For Now Playing's Auto mode: true = show the cover, false = the video, undefined = not known yet. */
export function useStill(id: string | undefined): boolean | undefined {
  const [state, setState] = useState<{ id?: string; still?: boolean }>({})
  useEffect(() => {
    if (!id) return
    let live = true
    stillVideo(id).then((still) => live && setState({ id, still: still ?? undefined }))
    return () => {
      live = false
    }
  }, [id])
  return id && state.id === id ? state.still : id && id in known ? known[id] : undefined
}
