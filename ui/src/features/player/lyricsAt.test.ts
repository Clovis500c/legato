import { describe, expect, it } from 'vitest'
import { NO_FIX, applyFix, fixFromTaps, lineAt, peekLine, toLrc, withBreaks } from './lyricsAt'

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
  it('follows the clock: before the first line, on each, after the last, two at the same time', () => {
    const l = [{ ms: 1000 }, { ms: 2000 }, { ms: 2000 }, { ms: 5000 }]
    expect([500, 1000, 2000, 4999, 5000, 600_000].map((t) => lineAt(l, t))).toEqual([-1, 0, 2, 2, 3, 3])
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

describe('timing fixed by hand', () => {
  it('one tap shifts every line, two far apart fix the speed too', () => {
    // Line at 10 s in the lyrics heard at 12.5 s: everything 2.5 s later.
    const one = fixFromTaps([{ lyric: 10000, song: 12500 }], NO_FIX)
    expect(one).toEqual({ offset: 2500, rate: 1 })
    // Slowed to 0.8 speed with a 1 s intro: 10 s → 13.5 s, 60 s → 76 s.
    const two = fixFromTaps([{ lyric: 10000, song: 13500 }, { lyric: 60000, song: 76000 }], NO_FIX)
    expect(two.rate).toBe(1.25)
    expect(two.offset).toBe(1000)
    // Too close together: speed kept, offset from the last tap.
    expect(fixFromTaps([{ lyric: 10000, song: 11000 }, { lyric: 12000, song: 13500 }], { offset: 0, rate: 1.1 })).toEqual({ offset: 300, rate: 1.1 })
    // A few hundred ms of jitter on a normal-speed song: still ×1.
    expect(fixFromTaps([{ lyric: 20000, song: 20100 }, { lyric: 45000, song: 44500 }], { offset: 0, rate: 1 }).rate).toBe(1)
    // Two far lines clicked a second apart: a slip, the speed stays, the shift follows the last tap.
    expect(fixFromTaps([{ lyric: 26000, song: 27600 }, { lyric: 150000, song: 28700 }], NO_FIX)).toEqual({ offset: -121300, rate: 1 })
  })
  it('moves starts and given ends, never before 0', () => {
    const lines = [{ ms: 1000, text: 'a', endMs: 2000 }, { ms: 3000, text: 'b' }]
    expect(applyFix(lines, { offset: -1500, rate: 1 })).toEqual([{ ms: 0, text: 'a', endMs: 500 }, { ms: 1500, text: 'b', endMs: undefined }])
    expect(applyFix(lines, NO_FIX)).toBe(lines)
  })
  it('a line ends at its own end when the source gives one', () => {
    const lines = [{ ms: 0, text: 'a', endMs: 1200 }, { ms: 6000, text: 'b' }]
    expect(withBreaks(lines, null)).toEqual([lines[0], { ms: 1200, text: '' }, lines[1]])
  })
})

describe('toLrc', () => {
  it('writes the lines back as LRC', () => {
    expect(toLrc([{ ms: 1500, text: 'One' }, { ms: 62_340, text: '' }, { ms: 6_000_000, text: 'Late' }])).toBe('[00:01.50]One\n[01:02.34]\n[100:00.00]Late')
  })
})

describe('peekLine', () => {
  it('shows the line being sung, the first one before it starts, else plain text’s first line', () => {
    const lines = [
      { ms: 5_000, text: 'One' },
      { ms: 9_000, text: 'Two' },
    ]
    expect(peekLine(lines, null, 0)).toBe('One')
    expect(peekLine(lines, null, 9_500)).toBe('Two')
    expect(peekLine([], '\n  \nFirst words\nNext', 0)).toBe('First words')
    expect(peekLine([], null, 0)).toBe('')
  })
})
