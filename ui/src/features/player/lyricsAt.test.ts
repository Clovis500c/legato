import { describe, expect, it } from 'vitest'
import { lineAt } from './lyricsAt'

describe('lineAt', () => {
  const lines = [{ ms: 1000 }, { ms: 2000 }, { ms: 2000 }, { ms: 5000 }]
  it('finds the line being sung', () => {
    expect(lineAt(lines, 0)).toBe(-1)
    expect(lineAt(lines, 1000)).toBe(0)
    expect(lineAt(lines, 1999)).toBe(0)
    expect(lineAt(lines, 2500)).toBe(2)
    expect(lineAt(lines, 99_999)).toBe(3)
    expect(lineAt([], 10)).toBe(-1)
  })
})
