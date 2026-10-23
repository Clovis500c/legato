import { describe, expect, it } from 'vitest'
import { sleepLabel } from './sleep'

describe('sleep timer', () => {
  it('says the minutes left, rounded up', () => {
    expect(sleepLabel(null)).toBe('')
    expect(sleepLabel('song')).toBe('End of song')
    expect(sleepLabel(10_000 + 22.2 * 60_000, 10_000)).toBe('23 min')
    expect(sleepLabel(10_000 + 5_000, 10_000)).toBe('1 min')
  })
})
