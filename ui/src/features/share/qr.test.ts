import { expect, it } from 'vitest'
import { qrPath } from './qr'

it('merges dark runs per row', () => {
  // 3×3: row 0 = ##., row 1 = .#., row 2 = ###
  expect(qrPath(3, '110010111', 4)).toBe('M4 4h2v1h-2zM5 5h1v1h-1zM4 6h3v1h-3z')
  expect(qrPath(2, '0000', 0)).toBe('')
})
