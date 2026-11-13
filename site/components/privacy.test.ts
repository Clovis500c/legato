import { expect, it } from 'vitest'
import { PRIVACY } from './content'

it('every privacy row reads as whole sentences (a line pasted inside another breaks one)', () => {
  for (const [what, text] of PRIVACY) {
    expect(text, what).toMatch(/[.)]$/)
    // A sentence pasted mid-word: "the song With … them.'s ISRC".
    expect(text, what).not.toMatch(/\.['’]s\b/)
  }
  expect(PRIVACY.find(([w]) => w === 'Scrobbling')?.[1]).toContain("the song's ISRC")
})
