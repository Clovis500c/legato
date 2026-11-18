import { describe, expect, it } from 'vitest'
import { translateTarget, wordsToTranslate, alignTranslation, underFor } from './translateWords'

describe('translateWords', () => {
  it('names the target language the way the service wants it', () => {
    expect(translateTarget('fr')).toBe('fr')
    expect(translateTarget('zh')).toBe('zh-CN')
  })

  it('sends the sung lines, else the plain lines, capped', () => {
    expect(wordsToTranslate({ lines: [{ text: ' a ' }, { text: '' }], plain: 'x' })).toEqual(['a', ''])
    expect(wordsToTranslate({ lines: [], plain: 'one\n two \n' })).toEqual(['one', 'two', ''])
    expect(wordsToTranslate({ lines: [], plain: null })).toEqual([''])
    expect(wordsToTranslate({ lines: [], plain: 'l\n'.repeat(500) })).toHaveLength(200)
  })
})

describe('alignTranslation', () => {
  const shown = (...t: string[]) => t.map((text) => ({ text }))
  it('each sung line gets its translation; the ♪ breaks the panel adds get none', () => {
    const from = ['one', 'two', 'three']
    const to = ['un', 'deux', 'trois']
    expect(alignTranslation(shown('', 'one', 'two', '', 'three'), from, to)).toEqual([null, 'un', 'deux', null, 'trois'])
  })
  it('an empty line the lyrics already hold stays empty and does not shift the others', () => {
    expect(alignTranslation(shown('a', '', 'b'), ['a', '', 'b'], ['A', '', 'B'])).toEqual(['A', null, 'B'])
  })
  it('a shorter answer leaves the last lines bare, a longer one is cut; a line left as it was is not repeated', () => {
    expect(alignTranslation(shown('a', 'b', 'c'), ['a', 'b', 'c'], ['A'])).toEqual(['A', null, null])
    expect(alignTranslation(shown('a', 'b'), ['a', 'b'], ['A', 'B', 'C'])).toEqual(['A', 'B'])
    expect(alignTranslation(shown('la la', 'b'), ['la la', 'b'], ['la la', 'B'])).toEqual([null, 'B'])
  })
  it('a repeated chorus aligns line by line; lines past the 200 sent have none; nothing sent, nothing shown', () => {
    expect(alignTranslation(shown('x', 'y', 'x'), ['x', 'y', 'x'], ['X', 'Y', 'X2'])).toEqual(['X', 'Y', 'X2'])
    expect(alignTranslation(shown('a', 'z'), ['a'], ['A'])).toEqual(['A', null])
    expect(alignTranslation(shown('a'), [], [])).toEqual([null])
  })
})

describe('underFor', () => {
  const shown = [{ text: 'one' }, { text: 'two' }]
  const done = { song: 's1', code: 'fr', from: ['one', 'two'], to: ['un', 'deux'] }
  it('the rows of this song’s translation, in whatever language was asked', () => {
    expect(underFor(done, 's1', shown)).toEqual(['un', 'deux'])
    expect(underFor({ ...done, code: 'ja' }, 's1', shown)).toEqual(['un', 'deux'])
  })
  it('none for another song, or when nothing was translated', () => {
    expect(underFor(done, 's2', shown)).toBeNull()
    expect(underFor(null, 's1', shown)).toBeNull()
  })
})
