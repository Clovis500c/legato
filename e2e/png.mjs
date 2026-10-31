// A PNG's pixels without a dependency (8-bit RGB or RGBA, not interlaced: what Chromium's screenshot gives), so a walk can
// tell a drawn canvas from a blank one.
import { inflateSync } from 'node:zlib'

/** { width, height, channels, data } with the filters undone. */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let at = 8
  let width = 0
  let height = 0
  let channels = 0
  const parts = []
  while (at < buf.length) {
    const len = buf.readUInt32BE(at)
    const type = buf.toString('latin1', at + 4, at + 8)
    const body = buf.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      if (body[8] !== 8 || body[12] !== 0 || (body[9] !== 2 && body[9] !== 6)) throw new Error(`PNG kind not handled: depth ${body[8]}, color ${body[9]}, interlace ${body[12]}`)
      channels = body[9] === 6 ? 4 : 3
    } else if (type === 'IDAT') parts.push(body)
    at += 12 + len
  }
  const raw = inflateSync(Buffer.concat(parts))
  const stride = width * channels
  const data = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? data[y * stride + x - channels] : 0
      const up = y ? data[(y - 1) * stride + x] : 0
      const upLeft = y && x >= channels ? data[(y - 1) * stride + x - channels] : 0
      let v = line[x]
      if (filter === 1) v += left
      else if (filter === 2) v += up
      else if (filter === 3) v += (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - upLeft
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)]
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      data[y * stride + x] = v & 255
    }
  }
  return { width, height, channels, data }
}

/** The share of pixels that stand out from the picture's most common color by at least `min` in some channel (0..255): a
 *  blank or faintly patterned canvas has none, bars lit on it have some. */
export function strongShare(png, min = 80) {
  const { width, height, channels, data } = png
  const at = (i) => [data[i * channels], data[i * channels + 1], data[i * channels + 2]]
  const count = new Map()
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = at(i)
    const key = (r << 16) | (g << 8) | b
    count.set(key, (count.get(key) ?? 0) + 1)
  }
  const [top] = [...count.entries()].sort((a, b) => b[1] - a[1])[0]
  const base = [top >> 16, (top >> 8) & 255, top & 255]
  let strong = 0
  for (let i = 0; i < width * height; i++) if (at(i).some((v, c) => Math.abs(v - base[c]) >= min)) strong++
  return strong / (width * height)
}
