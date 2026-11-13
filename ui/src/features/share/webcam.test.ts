import { expect, it, vi } from 'vitest'
import { readFrame, untilLeft } from './webcam'

// "LG1:ABC-123" as a 21×21 QR code (qrcode-generator, level M), row-major.
const N = 21
const MODULES = '111111100001101111111100000100110001000001101110100100101011101101110100011101011101101110100010101011101100000101111101000001111111101010101111111000000000111100000000100101101100010100000101011001110001110010000011111100101001001110101000111011010011000000101010110011010000000001011000111000111111100010010110110100000101111110111001101110100001000001010101110101110011100111101110100100100110001100000100010100010000111111101111111011110'

/** A frame as a camera gives it: the code, a quiet zone of 4 modules, `scale` pixels a module, RGBA. */
function frame(scale: number, quiet = 4) {
  const side = (N + 2 * quiet) * scale
  const data = new Uint8ClampedArray(side * side * 4).fill(255)
  for (let y = 0; y < N * scale; y++)
    for (let x = 0; x < N * scale; x++)
      if (MODULES[Math.floor(y / scale) * N + Math.floor(x / scale)] === '1') {
        const i = ((y + quiet * scale) * side + x + quiet * scale) * 4
        data[i] = data[i + 1] = data[i + 2] = 0
      }
  return { data, side }
}

it('reads a QR code out of a camera frame', async () => {
  const { data, side } = frame(6)
  expect(MODULES).toHaveLength(N * N)
  expect(await readFrame(data, side, side)).toBe('LG1:ABC-123')
})

it('finds nothing in a frame with no code', async () => {
  const side = 120
  expect(await readFrame(new Uint8ClampedArray(side * side * 4).fill(200), side, side)).toBeNull()
})

it('lets the camera go when the window hides or the page changes, and stops listening after', () => {
  const doc = Object.assign(new EventTarget(), { hidden: false })
  const leave = vi.fn()
  let page: (() => void) | undefined
  const off = untilLeft(leave, doc, (f) => {
    page = f
    return () => (page = undefined)
  })
  doc.dispatchEvent(new Event('visibilitychange'))
  expect(leave).not.toHaveBeenCalled()
  doc.hidden = true
  doc.dispatchEvent(new Event('visibilitychange'))
  page?.()
  expect(leave).toHaveBeenCalledTimes(2)
  off()
  doc.dispatchEvent(new Event('visibilitychange'))
  expect(page).toBeUndefined()
  expect(leave).toHaveBeenCalledTimes(2)
})
