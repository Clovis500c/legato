import { expect, it } from 'vitest'
import { byRole } from './CreditsDialog'

it('puts each role once with its people together, in the order they came', () => {
  const got = byRole([
    { role: 'producer', name: 'A' },
    { role: 'composer', name: 'B' },
    { role: 'producer', name: 'C' },
    { role: 'guitar', name: 'D' },
  ])
  expect(got).toEqual([['producer', ['A', 'C']], ['composer', ['B']], ['guitar', ['D']]])
  expect(byRole([])).toEqual([])
})
