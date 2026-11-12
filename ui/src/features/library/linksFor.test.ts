import { expect, it } from 'vitest'
import { linksFor } from './linksFor'

it("never shows an artist's links on another artist's page", () => {
  const found = { artist: 'Kavinsky', links: [{ kind: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Kavinsky' }] }
  expect(linksFor(found, 'Kavinsky')).toBe(found.links)
  expect(linksFor(found, 'Daft Punk')).toBeNull()
  expect(linksFor(null, 'Kavinsky')).toBeNull()
})
