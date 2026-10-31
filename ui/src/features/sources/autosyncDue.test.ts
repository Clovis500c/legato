import { describe, expect, it } from 'vitest'
import { AFTER_REFUSAL, EVERY, due } from './autosyncDue'

describe('automatic sync', () => {
  it('runs at launch, then every 15 minutes', () => {
    expect(due(undefined, 0)).toBe(true)
    expect(due({ at: 0, refused: false }, EVERY - 1)).toBe(false)
    expect(due({ at: 0, refused: false }, EVERY)).toBe(true)
  })

  it('waits longer once Google refused', () => {
    expect(due({ at: 0, refused: true }, EVERY)).toBe(false)
    expect(due({ at: 0, refused: true }, AFTER_REFUSAL)).toBe(true)
  })
})
