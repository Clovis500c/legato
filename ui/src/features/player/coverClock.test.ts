import { describe, expect, it } from 'vitest'
import { clockText, toNextMinute } from './coverClock'

describe('cover display clock', () => {
  const d = new Date(2026, 10, 2, 21, 7, 42, 250)

  it('writes the time as the language does', () => {
    expect(clockText(d, 'fr').time).toBe('21:07')
    expect(clockText(d, 'en-US').time).toMatch(/^9:07\sPM$/)
    expect(clockText(d, 'fr').day).toBe('lundi 2 novembre')
  })

  it('turns on the minute', () => {
    expect(toNextMinute(d)).toBe(17_750)
    expect(toNextMinute(new Date(2026, 10, 2, 21, 8, 0, 0))).toBe(60_000)
  })
})
