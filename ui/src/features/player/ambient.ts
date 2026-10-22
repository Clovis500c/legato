import { useEffect, useState } from 'react'
import { boxOf, sourceRect } from '../../shared/artfit'
import { contrast, type Theme } from '../../shared/theme/theme'
import type { Palette } from '../../shared/theme/theme'

export type Rgb = [number, number, number]

/** Average color of an image, colorful pixels weighted up (plain average is mud). Needs CORS: the art scheme sends it. */
export function averageColor(src: string): Promise<Rgb | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onerror = () => resolve(null)
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = c.height = 12
        const ctx = c.getContext('2d')!
        // Video frames: black bars would darken the tint.
        ctx.drawImage(img, ...sourceRect(img, boxOf(img, src)), 0, 0, 12, 12)
        const d = ctx.getImageData(0, 0, 12, 12).data
        const sum = [0, 0, 0, 0]
        for (let i = 0; i < d.length; i += 4) {
          const [r, g, b] = [d[i], d[i + 1], d[i + 2]]
          const w = 0.05 + (Math.max(r, g, b) - Math.min(r, g, b)) / 255
          sum[0] += r * w
          sum[1] += g * w
          sum[2] += b * w
          sum[3] += w
        }
        resolve([sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]])
      } catch {
        resolve(null)
      }
    }
    img.src = src
  })
}

function hue(rgb: Rgb): [number, number] {
  const [r, g, b] = rgb.map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (!d) return [0, 0]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(h * 60 + 360) % 360, s]
}

function hex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase()
}

/** Surfaces tinted by the cover, flat, in the theme's brightness family. Text colors stay the theme's. */
export function tintPalette(rgb: Rgb, theme: Pick<Theme, 'dark' | 'ink3'>): Partial<Palette> {
  const [h, s] = hue(rgb)
  const sat = Math.min(s, theme.dark ? 0.45 : 0.35)
  const at = (l: number) => hex(h, sat, Math.min(1, Math.max(0, l)))
  // Bright hues (green, yellow) read lighter: push bg away from text until muted text keeps AA on it, its panels and
  // its cards.
  const o = theme.dark ? 1 : -1
  let l = theme.dark ? 0.11 : 0.94
  const worst = (l: number) => Math.min(contrast(theme.ink3, at(l)), contrast(theme.ink3, at(l + 0.03 * o)), contrast(theme.ink3, at(l + 0.07 * o)))
  while (worst(l) < 4.5 && l > 0.02 && l < 0.99) l -= 0.01 * o
  return { bg: at(l), panel: at(l + 0.03 * o), raised: at(l + 0.07 * o), recess: at(l - 0.03 * o), line: at(l + 0.12 * o), lineSoft: at(l + 0.06 * o), ledOff: at(l + 0.16 * o) }
}

const kebab = (k: string) => k.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`)

/** CSS variables for a subtree tinted by `src` (null = theme colors). */
export function useAmbient(src: string | undefined, theme: Pick<Theme, 'dark' | 'ink3'>): Record<string, string> | undefined {
  const [got, setGot] = useState<{ src: string; rgb: Rgb | null }>()
  useEffect(() => {
    if (!src) return
    let live = true
    void averageColor(src).then((rgb) => live && setGot({ src, rgb }))
    return () => {
      live = false
    }
  }, [src])
  const rgb = got && got.src === src ? got.rgb : null
  return rgb ? Object.fromEntries(Object.entries(tintPalette(rgb, theme)).map(([k, v]) => [`--${kebab(k)}`, v])) : undefined
}
