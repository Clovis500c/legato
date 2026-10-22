import { describe, expect, it } from 'vitest'
import { lineAt, lineEnd, withBreaks, wordFill } from './lyricsAt'

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

describe('withBreaks', () => {
  it('puts ♪ in the intro, long pauses and the outro', () => {
    const lines = [
      { ms: 10_000, text: 'First line' },
      { ms: 13_000, text: 'Second line' },
      { ms: 40_000, text: 'After the solo' },
    ]
    expect(withBreaks(lines, 60_000).map((l) => [l.ms, l.text])).toEqual([
      [0, ''],
      [10_000, 'First line'],
      [13_000, 'Second line'],
      [16_000, ''],
      [40_000, 'After the solo'],
      [43_000, ''],
    ])
  })
  it('leaves sung parts, short pauses and existing empty lines alone', () => {
    const lines = [
      { ms: 1000, text: 'a' },
      { ms: 5000, text: '' },
      { ms: 6000, text: 'b' },
    ]
    expect(withBreaks(lines, null)).toEqual(lines)
    expect(withBreaks([], 1000)).toEqual([])
  })
})

describe('karaoke fill', () => {
  it('fills word by word over the line, by length', () => {
    const at = (ms: number) => wordFill('aa bb', 0, 5000, ms).map((w) => [w.word, Math.round(w.fill * 100) / 100])
    expect(at(0)).toEqual([['aa', 0], [' ', 0], ['bb', 0]])
    expect(at(1000)).toEqual([['aa', 0.5], [' ', 0], ['bb', 0]])
    expect(at(4000)).toEqual([['aa', 1], [' ', 1], ['bb', 0.5]])
    expect(at(9000).every(([, f]) => f === 1)).toBe(true)
  })
  it('a line ends where the next starts, or after a guess from its length', () => {
    const lines = [{ ms: 0, text: 'short' }, { ms: 2000, text: 'x'.repeat(50) }]
    expect(lineEnd(lines, 0, null)).toBe(2000)
    expect(lineEnd(lines, 1, null)).toBe(2000 + 4500)
    expect(lineEnd(lines, 1, 4000)).toBe(4000)
  })
})
