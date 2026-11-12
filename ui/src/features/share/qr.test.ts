import { expect, it } from 'vitest'
import { drawCode, qrPath } from './qr'

it('merges dark runs per row', () => {
  // 3×3: row 0 = ##., row 1 = .#., row 2 = ###
  expect(qrPath(3, '110010111', 4)).toBe('M4 4h2v1h-2zM5 5h1v1h-1zM4 6h3v1h-3z')
  expect(qrPath(2, '0000', 0)).toBe('')
})

it('draws a QR code with one square per dark module inside its white box and quiet zone', () => {
  const rects: number[][] = []
  const ctx = { fillStyle: '', beginPath() {}, roundRect() {}, fill() {}, fillRect: (...a: number[]) => void rects.push(a) }
  // 3 modules + 3 quiet on each side in 90 px: cells of 10 px, the box from (410, 510) to (500, 600).
  drawCode(ctx, [3, '101010101'], 500, 600, 90)
  expect(rects).toHaveLength(5)
  expect(rects[0]).toEqual([440, 540, 10, 10])
  expect(Math.max(...rects.map((r) => r[0] + r[2]))).toBe(470)
  expect(Math.max(...rects.map((r) => r[1] + r[3]))).toBe(570)
})
