import { describe, expect, it } from 'vitest'
import { minutesOf, nextAlarm } from './alarmTime'

// Local times: the test runs in whatever time zone the PC has.
const at = (y: number, m: number, d: number, h: number, mi: number) => new Date(y, m - 1, d, h, mi).getTime()

describe('alarm', () => {
  it('reads its time', () => {
    expect(minutesOf('07:30')).toBe(450)
    expect(minutesOf('23:59')).toBe(1439)
    for (const bad of ['7:30', '24:00', '07:60', '', 'ab:cd']) expect(minutesOf(bad)).toBeNull()
  })

  it('rings next at its time on one of its days', () => {
    const weekdays = { on: true, time: '07:30', days: [1, 2, 3, 4, 5] }
    // Thursday 5 November 2026, 06:00: today at 07:30.
    expect(nextAlarm(at(2026, 11, 5, 6, 0), weekdays)).toBe(at(2026, 11, 5, 7, 30))
    // Its time now or past: the next day it rings.
    expect(nextAlarm(at(2026, 11, 5, 7, 30), weekdays)).toBe(at(2026, 11, 6, 7, 30))
    // Friday evening: Monday.
    expect(nextAlarm(at(2026, 11, 6, 20, 0), weekdays)).toBe(at(2026, 11, 9, 7, 30))
    // Only today's weekday, already past: a week later.
    expect(nextAlarm(at(2026, 11, 5, 8, 0), { ...weekdays, days: [4] })).toBe(at(2026, 11, 12, 7, 30))
  })

  it('stays quiet when off or with no day', () => {
    expect(nextAlarm(at(2026, 11, 5, 6, 0), { on: false, time: '07:30', days: [4] })).toBeNull()
    expect(nextAlarm(at(2026, 11, 5, 6, 0), { on: true, time: '07:30', days: [] })).toBeNull()
  })
})
