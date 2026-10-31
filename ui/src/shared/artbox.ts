import type { Box } from './generated'

// Part of an image, as fractions of its size: the Rust `Crop` (crates/core/src/cover.rs), generated.
export type { Box }

export const FULL: Box = { x: 0, y: 0, w: 1, h: 1 }

/** Frame shapes the big cover takes: from a vertical video to a wide one. */
export const clampRatio = (r: number) => Math.min(16 / 9, Math.max(9 / 16, r))

// Bar pixel: near black, JPEG noise allowed.
const DARK = 40
// Dark or flat line: almost every pixel.
const MOST = 0.97
// Flat line: luminance within this of the line's mean.
const SPREAD = 20
// Thin flat border at the outer edge (white frame line), at most this share of the size.
const BORDER = 0.015
// Light seam between a bar and the picture (thin white line), at most this share of the size.
const SEAM = 0.012
// A bar is at least this share of the size.
const MIN_BAR = 0.02

interface Line {
  dark: boolean
  flat: boolean
  /** Mean luminance. */
  mean: number
}

function line(data: Uint8ClampedArray, start: number, step: number, count: number): Line {
  let dark = 0
  let sum = 0
  const lum = new Float32Array(count)
  for (let i = 0, p = start; i < count; i++, p += step) {
    const o = p * 4
    if (Math.max(data[o], data[o + 1], data[o + 2]) <= DARK) dark++
    sum += lum[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
  }
  const mean = sum / count
  let near = 0
  for (const l of lum) if (Math.abs(l - mean) <= SPREAD) near++
  return { dark: dark >= count * MOST, flat: near >= count * MOST, mean }
}

interface Edge {
  /** Lines to cut. */
  cut: number
  /** Of which the thin border line(s) at the very edge. */
  border: number
  /** A real bar was found, not just a border. */
  bar: boolean
}

/**
 * Lines to cut from one edge: a thin flat border (any one color, e.g. a white frame line), then a dark bar, then the
 * thin light seam that often separates bar and picture.
 */
function edge(at: (i: number) => Line, size: number): Edge {
  const maxBorder = Math.max(1, Math.ceil(size * BORDER))
  const first = at(0)
  let i = 0
  while (i < size && at(i).flat && !at(i).dark && Math.abs(at(i).mean - first.mean) <= SPREAD) i++
  // Long run of one light color: a plain background is picture, not a border.
  if (i > maxBorder) return { cut: 0, border: 0, bar: false }
  const border = i
  while (i < size && at(i).dark) i++
  if (i - border < size * MIN_BAR) return { cut: border, border, bar: false }
  const end = i
  const maxSeam = Math.max(1, Math.ceil(size * SEAM))
  while (i < size && i < end + maxSeam && at(i).flat && !at(i).dark) i++
  // Light run as long as the seam limit: flat picture, not a seam.
  return { cut: i < end + maxSeam ? i : end, border, bar: true }
}

/**
 * Bars on one axis. Both sides need a bar (one dark side alone may be a dark picture). Uneven bars are fine (off-center
 * edits, 2026-10-20 report); very uneven ones are cut to the smaller (only darkness goes). One sample more on each cut
 * side: downscaling blurs the bar's edge into the picture. Border lines alone are always cut.
 */
function trimAxis(near: Edge, far: Edge, size: number): [number, number] {
  let a = near.cut
  let b = far.cut
  if (near.bar !== far.bar) {
    // One-sided: the bar side keeps its picture, only its border line goes.
    if (near.bar) a = near.border
    else b = far.border
  } else if (near.bar && Math.min(a, b) < Math.max(a, b) * 0.4) {
    a = b = Math.min(a, b)
  }
  if (size - a - b < size * 0.35) return [0, size]
  const start = a ? a + 1 : 0
  const end = size - (b ? b + 1 : 0)
  return [start, end - start]
}

/**
 * Real art inside a video frame: black bars (letterbox, pillarbox or both), thin border and seam lines cut off. RGBA
 * pixels of a small copy. Not bars (one-sided, mostly black) = whole image.
 */
export function contentBox(data: Uint8ClampedArray, w: number, h: number): Box {
  const rows: Line[] = []
  const cols: Line[] = []
  const row = (y: number) => (rows[y] ??= line(data, y * w, 1, w))
  const col = (x: number) => (cols[x] ??= line(data, x, w, h))
  // All dark: nothing to frame.
  let y = 0
  while (y < h && row(y).dark) y++
  if (y === h) return FULL
  const [top, bh] = trimAxis(edge(row, h), edge((i) => row(h - 1 - i), h), h)
  const [left, bw] = trimAxis(edge(col, w), edge((i) => col(w - 1 - i), w), w)
  return { x: left / w, y: top / h, w: bw / w, h: bh / h }
}

/**
 * Where the YouTube iframe goes so only `box` (part of its 16:9 frame) fills `slot`: the frame is enlarged, centered on
 * the box, and clipped to the slot. Same as object-fit: cover on the box. No DOM move (that would reload the embed).
 */
export function frameAround(slot: { left: number; top: number; width: number; height: number }, box: Box, radius = 8) {
  const k = Math.max(slot.width / (box.w * 16), slot.height / (box.h * 9))
  const width = 16 * k
  const height = 9 * k
  const left = slot.left + slot.width / 2 - (box.x + box.w / 2) * width
  const top = slot.top + slot.height / 2 - (box.y + box.h / 2) * height
  const inset = [slot.top - top, left + width - slot.left - slot.width, top + height - slot.top - slot.height, slot.left - left].map((v) => `${Math.round(Math.max(0, v) * 100) / 100}px`)
  return { left, top, width, height, clipPath: `inset(${inset.join(' ')} round ${radius}px)` }
}

/**
 * Part of the image shown in a frame of `ratio` (width / height): the box, cut to the frame's shape around its center,
 * like object-fit: cover. Image size in pixels.
 */
export function cropTo(box: Box, width: number, height: number, ratio: number): Box {
  const bw = box.w * width
  const bh = box.h * height
  if (bw / bh > ratio) {
    const w = (bh * ratio) / width
    return { ...box, x: box.x + (box.w - w) / 2, w }
  }
  const h = bw / ratio / height
  return { ...box, y: box.y + (box.h - h) / 2, h }
}

/** img style showing only `crop` in its parent (absolutely placed, parent clips). */
export const cropStyle = (crop: Box) => ({
  width: `${100 / crop.w}%`,
  height: `${100 / crop.h}%`,
  left: `${(-crop.x / crop.w) * 100}%`,
  top: `${(-crop.y / crop.h) * 100}%`,
  maxWidth: 'none',
})

/** Video frames carry bars; real covers (YouTube Music, Apple, Spotify, files) are drawn to their shape. */
export const mayHaveBars = (src: string) => /i\.ytimg\.com/.test(src)
