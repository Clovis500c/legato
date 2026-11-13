import { describe, expect, it } from 'vitest'
import { translateTarget, wordsToTranslate } from './translateWords'

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
