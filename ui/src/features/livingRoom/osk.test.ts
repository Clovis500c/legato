import { describe, expect, it } from 'vitest'
import { press, ROWS } from './osk'

describe('on-screen keyboard', () => {
  it('types at the end, one space at a time, never first', () => {
    expect(press('ab', { key: 'c' })).toBe('abc')
    expect(press('ab', 'space')).toBe('ab ')
    expect(press('ab ', 'space')).toBe('ab ')
    expect(press('', 'space')).toBe('')
  })
  it('deletes a letter, an accented one whole, or everything', () => {
    expect(press('abé', 'back')).toBe('ab')
    expect(press('', 'back')).toBe('')
    expect(press('abc', 'clear')).toBe('')
  })
  it('has the letters and digits', () => {
    const all = ROWS.flat().join('')
    expect([...'abcdefghijklmnopqrstuvwxyz0123456789'].every((c) => all.includes(c))).toBe(true)
  })
})
