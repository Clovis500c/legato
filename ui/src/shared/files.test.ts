import { describe, expect, it } from 'vitest'
import { pickerFilters } from './files'

const PICTURES = [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
const LISTS = [{ name: 'Song lists', extensions: ['txt', 'csv', 'tsv', 'm3u', 'm3u8', 'xspf'] }]

describe('pickerFilters', () => {
  it('leaves a desktop dialog as it is', () => {
    expect(pickerFilters(LISTS, false, false)).toBe(LISTS)
    expect(pickerFilters(LISTS, false, true)).toBe(LISTS)
    expect(pickerFilters(undefined, true, false)).toBeUndefined()
  })

  it('keeps media filters when picking on a phone, any file otherwise', () => {
    expect(pickerFilters(PICTURES, true, false)).toBe(PICTURES)
    expect(pickerFilters(LISTS, true, false)).toBeUndefined()
    expect(pickerFilters([{ name: 'Legato theme', extensions: ['theme', 'json'] }], true, false)).toBeUndefined()
  })

  it('saves one type on a phone: the first media one, else a plain file', () => {
    const cover = [
      { name: 'JPEG image', extensions: ['jpg'] },
      { name: 'PNG image', extensions: ['png'] },
    ]
    expect(pickerFilters(cover, true, true)).toEqual([{ name: 'JPEG image', extensions: ['jpg'] }])
    expect(pickerFilters([{ name: 'Legato library backup', extensions: ['legato'] }], true, true)).toEqual([{ name: 'Legato library backup', extensions: ['application/octet-stream'] }])
  })
})
