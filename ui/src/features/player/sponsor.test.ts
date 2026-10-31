import { describe, expect, it } from 'vitest'
import { endCut, isUndone, landed, rememberUndone, toSkip, type Seg } from './sponsor'

const intro: Seg = { startS: 0, endS: 38 }
const mid: Seg = { startS: 100, endS: 130 }
const outro: Seg = { startS: 219.7, endS: 234.9 }
const none = new Set<number>()

describe('toSkip', () => {
  it('a play that begins at the start jumps the intro', () => {
    expect(toSkip([intro], 0.4, 0, 0, none)).toBe(0)
    expect(toSkip([intro], 1.5, 0.9, 0, none)).toBe(0)
  })

  it('data that came late still catches an intro a few seconds in', () => {
    expect(toSkip([intro], 3.2, 2.9, 0, none)).toBe(0)
  })

  it('a resume inside a part stays there', () => {
    expect(toSkip([intro], 12, 11, 10_000 / 1000, none)).toBe(-1)
  })

  it('a part already skipped is left alone: seeking back into it stays', () => {
    expect(toSkip([intro, mid], 105, 20, 0, new Set([0]))).toBe(1)
    expect(toSkip([intro, mid], 110, 20, 0, new Set([0, 1]))).toBe(-1)
    expect(toSkip([mid], 105, 140, 0, none)).toBe(-1)
  })

  it('a part reached by playing in the middle of the song', () => {
    expect(toSkip([intro, mid], 100.2, 99.7, 0, new Set([0]))).toBe(1)
  })

  it('nothing at the very end of a part, nothing before it', () => {
    expect(toSkip([mid], 129.8, 129.3, 0, none)).toBe(-1)
    expect(toSkip([mid], 99, 98, 0, none)).toBe(-1)
  })
})

describe('landed', () => {
  it('a seek into a part is a position the listener chose', () => {
    expect(landed([intro, mid], 105, 10)).toEqual([1])
    expect(landed([intro, mid], 102, 140)).toEqual([1])
  })

  it('playing on, or a seek outside every part, lands nowhere', () => {
    expect(landed([intro, mid], 105, 104.6)).toEqual([])
    expect(landed([intro, mid], 60, 10)).toEqual([])
  })
})

describe('endCut', () => {
  it('an outro to the end of the video is where the music ends', () => {
    expect(endCut([intro, outro], 234.921)).toBe(219.7)
  })
  it('a part in the middle, or an intro alone, is not an end', () => {
    expect(endCut([mid], 234.9)).toBeNull()
    expect(endCut([{ startS: 0, endS: 234.9 }], 234.9)).toBeNull()
    expect(endCut([outro], 0)).toBeNull()
  })
})

describe('undo memory', () => {
  it('remembers a video', () => {
    expect(isUndone('aaaaaaaaaaa')).toBe(false)
    rememberUndone('aaaaaaaaaaa')
    expect(isUndone('aaaaaaaaaaa')).toBe(true)
  })
})
