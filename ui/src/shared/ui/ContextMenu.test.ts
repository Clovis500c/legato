import { describe, expect, it } from 'vitest'
import { tidy } from './ContextMenu'

describe('tidy', () => {
  it('drops falsy entries and stray separators', () => {
    const a = { label: 'A' }
    const b = { label: 'B' }
    expect(tidy(['-', a, false, '-', '', '-', null, b, 0, '-', undefined])).toEqual([a, '-', b])
    expect(tidy(['-', false])).toEqual([])
  })
})
