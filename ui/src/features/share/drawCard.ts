import { isLetterboxed } from '../../shared/art'
import { averageColor, type Rgb } from '../player/ambient'
import { CARD, wrapText } from './shareCard'

export type CardLook = 'cover' | 'theme'

export interface CardText {
  title: string
  artist: string
  /** A lyric line, in quotes under the artist; the cover gets smaller for it. */
  line?: string
}

const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    // The art scheme sends CORS: the canvas stays readable (copy, save).
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Cover not readable'))
    img.src = src
  })

const shade = (c: Rgb, k: number) => `rgb(${c.map((v) => Math.round(v * k)).join(' ')})`

/**
 * The share card on `canvas` (CARD size): the cover, title, artist, a lyric line, "Legato" at the foot. Colors: the
 * cover's own, darkened (white words), or the theme's (its background and ink). The first readable picture of `art`.
 */
export async function drawCard(canvas: HTMLCanvasElement, art: string[], text: CardText, look: CardLook): Promise<void> {
  const { w, h, pad } = CARD
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas')
  await document.fonts.ready
  let img: HTMLImageElement | undefined
  let src = ''
  for (const s of art) {
    try {
      img = await load(s)
      src = s
      break
    } catch {
      // Next picture.
    }
  }
  const root = getComputedStyle(document.documentElement)
  const font = getComputedStyle(document.body).fontFamily
  let ink = '#fff'
  let ink2 = 'rgb(255 255 255 / 0.72)'
  if (look === 'theme') {
    ink = root.getPropertyValue('--ink').trim() || '#111'
    ink2 = root.getPropertyValue('--ink-2').trim() || '#555'
    ctx.fillStyle = root.getPropertyValue('--bg').trim() || '#fff'
    ctx.fillRect(0, 0, w, h)
  } else {
    const c = (src && (await averageColor(src))) || [48, 48, 48]
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, shade(c, 0.55))
    g.addColorStop(1, shade(c, 0.22))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // The cover: full width, smaller with a lyric line so everything fits.
  const side = text.line ? 640 : w - pad * 2
  const x = (w - side) / 2
  const y = 88
  ctx.save()
  ctx.shadowColor = 'rgb(0 0 0 / 0.4)'
  ctx.shadowBlur = 60
  ctx.shadowOffsetY = 24
  ctx.beginPath()
  ctx.roundRect(x, y, side, side, 28)
  ctx.fillStyle = look === 'theme' ? root.getPropertyValue('--recess').trim() || '#ddd' : 'rgb(0 0 0 / 0.25)'
  ctx.fill()
  ctx.restore()
  if (img) {
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x, y, side, side, 28)
    ctx.clip()
    // The middle square; a video frame's black bars cut off, as on the covers in the app.
    const zoom = isLetterboxed(src) ? 1.34 : 1
    const s = Math.min(img.naturalWidth, img.naturalHeight) / zoom
    // Square already: drawn whole (an SVG without its own size crops wrong).
    if (zoom === 1 && img.naturalWidth === img.naturalHeight) ctx.drawImage(img, x, y, side, side)
    else ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, x, y, side, side)
    ctx.restore()
  }

  const width = w - pad * 2
  let at = y + side + 64
  const write = (lines: string[], size: number, weight: number, color: string, gap: number) => {
    ctx.font = `${weight} ${size}px ${font}`
    ctx.fillStyle = color
    ctx.textBaseline = 'top'
    for (const l of lines) {
      ctx.fillText(l, pad, at)
      at += size * gap
    }
  }
  const measure = (size: number, weight: number) => (s: string) => {
    ctx.font = `${weight} ${size}px ${font}`
    return ctx.measureText(s).width
  }
  write(wrapText(text.title, width, 2, measure(60, 700)), 60, 700, ink, 1.18)
  at += 6
  write(wrapText(text.artist, width, 1, measure(40, 400)), 40, 400, ink2, 1.2)
  if (text.line) {
    at += 36
    write(wrapText(`“${text.line}”`, width, 3, measure(44, 400)), 44, 400, ink, 1.3)
  }
  ctx.font = `600 28px ${font}`
  ctx.fillStyle = ink2
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('Legato', pad, h - 64)
}

/** The card as PNG bytes. */
export const cardBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No picture'))), 'image/png'))
