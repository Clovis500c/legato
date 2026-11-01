import { describe, expect, it } from 'vitest'
import { NO_FIX, applyFix, fixFromTaps, lineAt, lineEnd, peekLine, toLrc, withBreaks, wordTimes } from './lyricsAt'

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
    expect(wordTimes('aa bb', 0, 5000)).toEqual([
      { word: 'aa', t0: 0, t1: 2000 },
      { word: ' ', t0: 2000, t1: 3000 },
      { word: 'bb', t0: 3000, t1: 5000 },
    ])
  })
  it('fills each word at its own time when the source times them', () => {
    const timed = [{ ms: 1000, text: 'Hello ' }, { ms: 1600, text: 'world', endMs: 2200 }]
    expect(wordTimes('Hello world', 1000, 4000, timed)).toEqual([
      { word: 'Hello ', t0: 1000, t1: 1600 },
      { word: 'world', t0: 1600, t1: 2200 },
    ])
    // The last word with no end of its own: until the line's.
    expect(wordTimes('Hi', 0, 900, [{ ms: 100, text: 'Hi' }])).toEqual([{ word: 'Hi', t0: 100, t1: 900 }])
    expect(wordTimes('aa', 0, 900, [])).toEqual([{ word: 'aa', t0: 0, t1: 900 }])
  })
  it('a line ends where the next starts, or after a guess from its length', () => {
    const lines = [{ ms: 0, text: 'short' }, { ms: 2000, text: 'x'.repeat(50) }]
    expect(lineEnd(lines, 0, null)).toBe(2000)
    expect(lineEnd(lines, 1, null)).toBe(2000 + 4500)
    expect(lineEnd(lines, 1, 4000)).toBe(4000)
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
    const worded = [{ ms: 1000, text: 'a b', words: [{ ms: 1000, text: 'a ' }, { ms: 1500, text: 'b', endMs: 1800 }] }]
    expect(applyFix(worded, { offset: 500, rate: 2 })[0].words).toEqual([{ ms: 2500, text: 'a ', endMs: undefined }, { ms: 3500, text: 'b', endMs: 4100 }])
  })
  it('a line ends at its own end when the source gives one', () => {
    const lines = [{ ms: 0, text: 'a', endMs: 1200 }, { ms: 6000, text: 'b' }]
    expect(lineEnd(lines, 0, null)).toBe(1200)
    expect(withBreaks(lines, null)).toEqual([lines[0], { ms: 1200, text: '' }, lines[1]])
  })
})

describe('toLrc', () => {
  it('writes lines and their words back as LRC', () => {
    expect(toLrc([{ ms: 1500, text: 'One' }, { ms: 62_340, text: '' }, { ms: 6_000_000, text: 'Late' }])).toBe('[00:01.50]One\n[01:02.34]\n[100:00.00]Late')
    const worded = [{ ms: 12_000, text: 'Hello world', words: [{ ms: 12_000, text: 'Hello ' }, { ms: 12_500, text: 'world', endMs: 13_100 }] }]
    expect(toLrc(worded)).toBe('[00:12.00]<00:12.00>Hello <00:12.50>world<00:13.10>')
    expect(toLrc([{ ms: 0, text: 'a', words: [{ ms: 5, text: 'a' }] }])).toBe('[00:00.00]<00:00.01>a')
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
