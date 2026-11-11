import { describe, expect, it } from 'vitest'
import { releaseCover } from './releaseCover'

describe('Cover Art Archive covers of new releases', () => {
  it('builds the front cover address from a release group id only', () => {
    expect(releaseCover('76DF3287-6CDA-33EB-8E9A-044B5E15FFDD')).toBe('https://coverartarchive.org/release-group/76df3287-6cda-33eb-8e9a-044b5e15ffdd/front-250')
    expect(releaseCover('../x')).toBeNull()
    expect(releaseCover('')).toBeNull()
  })
})
