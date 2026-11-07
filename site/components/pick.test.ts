import { describe, expect, it } from 'vitest'
import { pick } from './pick'

const codes = ['en', 'fr', 'de', 'pt', 'zh']

describe('pick', () => {
  it('takes the first language that has a page', () => {
    expect(pick(null, ['fr-FR', 'en-US'], codes)).toBe('fr')
    expect(pick(null, ['pt-PT'], codes)).toBe('pt')
    expect(pick(null, ['nb-NO', 'de'], codes)).toBe('de')
  })

  it('stays in English when English comes first or nothing fits', () => {
    expect(pick(null, ['en-GB', 'fr'], codes)).toBe('en')
    expect(pick(null, ['nb-NO', 'da'], codes)).toBe('en')
    expect(pick(null, [], codes)).toBe('en')
  })

  it('keeps Traditional Chinese readers off the Simplified page', () => {
    expect(pick(null, ['zh-CN'], codes)).toBe('zh')
    expect(pick(null, ['zh-TW', 'en'], codes)).toBe('en')
    expect(pick(null, ['zh-Hant-HK'], codes)).toBe('en')
  })

  it('follows a saved choice first, English included', () => {
    expect(pick('en', ['fr-FR'], codes)).toBe('en')
    expect(pick('de', ['fr-FR'], codes)).toBe('de')
    expect(pick('xx', ['fr-FR'], codes)).toBe('en')
  })

  it('still works written into a page as its source', () => {
    const fn = new Function(`return (${pick.toString()})`)() as typeof pick
    expect(fn(null, ['fr-FR'], codes)).toBe('fr')
  })
})
