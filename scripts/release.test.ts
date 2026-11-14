import { describe, expect, it } from 'vitest'
import { compareTags } from './promote.mjs'
import { BASES, versionOf } from './release.mjs'

// Android's versionCode, as Tauri makes it from the version.
const code = (v: string) => v.split('.').map(Number).reduce((n, p, i) => n + p * [1_000_000, 1_000, 1][i], 0)

describe('release version', () => {
  it('patch = n % 1000, the minor one up per 1000 commits since the base', () => {
    expect([0, 1, 999, 1000, 1001, 2500].map((n) => versionOf('1.2', n))).toEqual(['1.2.0', '1.2.1', '1.2.999', '1.3.0', '1.3.1', '1.4.500'])
  })

  it('above the last 1.1 Beta, and strictly rising push after push, for semver and the versionCode', () => {
    expect(compareTags('v1.2.1', 'v1.1.994')).toBeGreaterThan(0)
    expect(code('1.2.1')).toBeGreaterThan(code('1.1.994'))
    for (let n = 1; n <= 5000; n++) {
      const [a, b] = [versionOf('1.2', n - 1), versionOf('1.2', n)]
      expect(compareTags(`v${b}`, `v${a}`)).toBeGreaterThan(0)
      expect(code(b)).toBeGreaterThan(code(a))
    }
  })

  it('refuses a MAJOR.MINOR without a base', () => {
    expect(Object.keys(BASES)).toContain('1.2')
    expect(() => versionOf('1.3', 1)).toThrow('No base commit')
  })
})
