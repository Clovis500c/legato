import { describe, expect, it } from 'vitest'
import { passphrase, strength } from './strength'

describe('strength', () => {
  it('too short below the minimum', () => {
    expect(strength('Ab1!', 10).level).toBe(0)
  })

  it('weak when one kind of character', () => {
    expect(strength('abcdefghij', 10)).toEqual({ level: 1, hints: ['longer', 'upper', 'digit', 'symbol', 'common'] })
  })

  it('penalizes repeats and common words', () => {
    expect(strength('aaaaaaaaaaaa', 10).hints).toContain('repeats')
    expect(strength('MyPassword2024!', 10).hints).toContain('common')
  })

  it('very strong when long and mixed', () => {
    expect(strength('Tr0mbone-Velours-Q7uartz', 10)).toEqual({ level: 4, hints: [] })
  })

  it('generated passphrases are very strong and differ', () => {
    const a = passphrase()
    expect(a).toMatch(/^([A-Z][a-z]+-){2}\d\d(-[A-Z][a-z]+){3}$/)
    expect(strength(a, 10).level).toBe(4)
    expect(passphrase()).not.toBe(a)
  })
})
