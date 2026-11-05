import type { LibraryTrack } from '../../shared/api'
import { trackArt } from '../../shared/art'
import { hue, type Rgb } from '../player/ambient'
import { wrapText } from '../share/shareCard'
import type { RecapCard } from './recapCards'

/** A recap picture: a phone's story, 9:16. */
export const PICTURE = { width: 1080, height: 1920 }

/** A card's background, top and bottom: the cover's hue, deep enough for white text (4.5:1 at the top); blue-grey
 *  without a cover or for a grey one. */
export function cardColors(rgb: Rgb | null): [string, string] {
  if (!rgb || Math.max(...rgb) - Math.min(...rgb) < 20) return ['hsl(220 22% 24%)', 'hsl(220 28% 9%)']
  const [h, s] = hue(rgb)
  const sat = Math.round(Math.min(70, Math.max(40, s * 100)))
  return [`hsl(${Math.round(h)} ${sat}% 26%)`, `hsl(${Math.round(h)} ${sat}% 9%)`]
}

/** A cover the canvas may read back: the art scheme answers with CORS. Null when none loads. */
async function cover(t: LibraryTrack | undefined): Promise<HTMLImageElement | null> {
  for (const src of t ? trackArt(t) : []) {
    const img = await new Promise<HTMLImageElement | null>((ok) => {
      const i = new Image()
      i.crossOrigin = 'anonymous'
      i.onload = () => ok(i)
      i.onerror = () => ok(null)
      i.src = src
    })
    if (img) return img
  }
  return null
}

/** A square cover, its middle cut out of a video frame. A faint square without one. */
function square(g: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, size: number, radius: number) {
  g.save()
  g.beginPath()
  g.roundRect(x, y, size, size, radius)
  g.clip()
  // A square one drawn whole: an SVG without a size of its own (the demo's covers) ignores a source rectangle.
  if (img && img.naturalWidth === img.naturalHeight) g.drawImage(img, x, y, size, size)
  else if (img) {
    const s = Math.min(img.naturalWidth, img.naturalHeight)
    g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, x, y, size, size)
  } else {
    g.fillStyle = 'rgba(255, 255, 255, 0.12)'
    g.fillRect(x, y, size, size)
  }
  g.restore()
}

/** The card as a 1080 × 1920 picture: shown as it is on screen, saved as PNG. `font`: the theme's family. */
export async function drawCard(card: RecapCard, colors: [string, string], font: string): Promise<HTMLCanvasElement> {
  const { width: W, height: H } = PICTURE
  const P = 96
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  if (!g) throw new Error('No canvas')
  const bg = g.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, colors[0])
  bg.addColorStop(1, colors[1])
  g.fillStyle = bg
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#fff'
  g.textBaseline = 'top'
  const measure = (s: string) => g.measureText(s).width
  // One line, cut with an ellipsis.
  const fit = (s: string, width: number) => wrapText(s, width, 1, measure)[0] ?? ''
  type Block = { text: string; size: number; weight: number; alpha: number; max: number; gap: number }
  const linesOf = (b: Block) => {
    g.font = `${b.weight} ${b.size}px ${font}`
    return wrapText(b.text, W - 2 * P, b.max, measure)
  }
  let y = P
  const text = (b: Block) => {
    const lines = linesOf(b)
    g.globalAlpha = b.alpha
    for (const line of lines) {
      g.fillText(line, P, y)
      y += b.size * 1.2
    }
    g.globalAlpha = 1
    y += b.gap
  }
  const rows = card.rows ?? []
  const figures = card.figures ?? []
  const FIGURE = 180
  const kicker: Block = { text: card.kicker.toLocaleUpperCase(), size: 34, weight: 600, alpha: 0.8, max: 2, gap: 40 }
  const below: Block[] = [
    ...(card.title ? [{ text: card.title, size: card.cover ? 72 : 96, weight: 700, alpha: 1, max: card.cover ? 2 : 3, gap: card.figures?.length && !card.sub ? 56 : 12 }] : []),
    ...(card.sub ? [{ text: card.sub, size: 40, weight: 400, alpha: 0.85, max: 3, gap: 32 }] : []),
  ]
  // Text and numbers alone (time, habits, personality): in the middle of the card.
  if (!card.cover && !rows.length) y = Math.max(P, (H - [kicker, ...below].reduce((h, b) => h + linesOf(b).length * b.size * 1.2 + b.gap, 0) - figures.length * FIGURE) / 2)
  text(kicker)
  if (card.cover) {
    const size = rows.length ? 560 : W - 2 * P
    square(g, await cover(card.cover), P, y, size, 28)
    y += size + 56
  }
  below.forEach(text)
  const rowH = rows.length > 6 ? 104 : 128
  const thumb = rowH - 24
  for (const row of rows) {
    if (y + rowH > H - P - 80) break
    const x = row.track ? P + thumb + 28 : P
    if (row.track) square(g, await cover(row.track), P, y, thumb, 12)
    g.font = `600 40px ${font}`
    g.fillText(fit(row.title, W - P - x), x, y + (row.sub ? 4 : (thumb - 40) / 2))
    if (row.sub) {
      g.font = `400 32px ${font}`
      g.globalAlpha = 0.75
      g.fillText(fit(row.sub, W - P - x), x, y + 54)
      g.globalAlpha = 1
    }
    y += rowH
  }
  for (const f of figures) {
    g.font = `700 88px ${font}`
    g.fillText(fit(f.value, W - 2 * P), P, y)
    g.font = `400 36px ${font}`
    g.globalAlpha = 0.75
    g.fillText(fit(f.label, W - 2 * P), P, y + 108)
    g.globalAlpha = 1
    y += FIGURE
  }
  g.font = `700 40px ${font}`
  g.globalAlpha = 0.75
  g.fillText('Legato', P, H - P - 40)
  g.globalAlpha = 1
  return c
}
