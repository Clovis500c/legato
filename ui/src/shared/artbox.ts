/** Part of an image, as fractions of its size. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export const FULL: Box = { x: 0, y: 0, w: 1, h: 1 }

/** Frame shapes the big cover takes: from a vertical video to a wide one. */
export const clampRatio = (r: number) => Math.min(16 / 9, Math.max(9 / 16, r))

// Bar pixel: near black, JPEG noise allowed.
const DARK = 40
// Bar line: almost every pixel dark.
const FLAT = 0.97

function barLine(data: Uint8ClampedArray, start: number, step: number, count: number): boolean {
  let dark = 0
  for (let i = 0, p = start; i < count; i++, p += step) {
    const o = p * 4
    if (Math.max(data[o], data[o + 1], data[o + 2]) <= DARK) dark++
  }
  return dark >= count * FLAT
}

/** Bars on both sides of one axis, or none: same size (letterbox), each big enough, content left wide enough. */
function trimAxis(near: number, far: number, size: number): [number, number] {
  const bars = near > 0 && far > 0 && Math.min(near, far) >= size * 0.02
  const even = Math.abs(near - far) <= Math.max(2, size * 0.04)
  const kept = size - near - far
  if (!bars || !even || kept < size * 0.45) return [0, size]
  // One sample in on each side: downscaling blurs the bar edge into the art.
  return [near + 1, kept - 2]
}

/**
 * Real art inside a video frame: black bars (letterbox, pillarbox or both) cut off. RGBA pixels of a small copy.
 * Not a letterbox (one-sided, uneven, too much cut) = whole image.
 */
export function contentBox(data: Uint8ClampedArray, w: number, h: number): Box {
  let top = 0
  while (top < h && barLine(data, top * w, 1, w)) top++
  if (top === h) return FULL
  let bottom = 0
  while (bottom < h - top && barLine(data, (h - 1 - bottom) * w, 1, w)) bottom++
  let left = 0
  while (left < w && barLine(data, left, w, h)) left++
  let right = 0
  while (right < w - left && barLine(data, w - 1 - right, w, h)) right++
  const [y, bh] = trimAxis(top, bottom, h)
  const [x, bw] = trimAxis(left, right, w)
  return { x: x / w, y: y / h, w: bw / w, h: bh / h }
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
