import { describe, expect, it } from 'vitest'
import { fitColumns } from './fitColumns'
import type { Column } from '../../shared/theme/theme'

const ALL: Column[] = ['album', 'sources', 'plays', 'rating', 'added', 'duration']

describe('fitColumns', () => {
  it('keeps every column when the list is wide or not measured yet', () => {
    expect(fitColumns(ALL, true, 2000, 96)).toEqual({ columns: ALL, artistCol: true })
    expect(fitColumns(ALL, true, 0, 96)).toEqual({ columns: ALL, artistCol: true })
  })

  it('drops the least needed columns first', () => {
    // Everything: 32 + 200 + 96 + 100 + 444 + 16 × 9 = 1016.
    expect(fitColumns(ALL, true, 1015, 96).columns).toEqual(['album', 'sources', 'plays', 'rating', 'duration'])
    expect(fitColumns(ALL, true, 800, 96)).toEqual({ columns: ['album', 'sources', 'duration'], artistCol: true })
  })

  it('moves the artist under the title before losing the album', () => {
    expect(fitColumns(['album', 'sources', 'duration'], true, 560, 96)).toEqual({ columns: ['album', 'duration'], artistCol: false })
  })

  it('keeps the title and the time on the narrowest list', () => {
    expect(fitColumns(ALL, true, 420, 96)).toEqual({ columns: ['duration'], artistCol: false })
    expect(fitColumns(ALL, false, 300, 188)).toEqual({ columns: ['duration'], artistCol: false })
  })
})
