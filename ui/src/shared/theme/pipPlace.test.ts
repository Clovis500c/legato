import { describe, expect, it } from 'vitest'
import { DEFAULTS, sanitize } from './theme'

describe('the classic strip keeps its place', () => {
  it('a saved place comes back after a restart, a bad one does not', () => {
    expect(DEFAULTS.pipClassicPlace).toBeNull()
    expect(sanitize({ pipClassicPlace: [10.4, 20, 656, 200] }).pipClassicPlace).toEqual([10, 20, 656, 200])
    expect(sanitize({ pipClassicPlace: [10, 20, 0, 200] }).pipClassicPlace).toBeNull()
  })
})
