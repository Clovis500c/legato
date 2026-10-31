import { describe, expect, it } from 'vitest'
import { artistName, UNKNOWN_ARTIST } from './artistName'

describe('artistName', () => {
  it('keeps real names', () => {
    expect(artistName('Daft Punk')).toBe('Daft Punk')
    expect(artistName('')).toBe('')
  })
  it('answers the stored word through tr (English here)', () => {
    expect(artistName(UNKNOWN_ARTIST)).toBe('Unknown artist')
  })
})
