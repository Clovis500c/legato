import { describe, expect, it } from 'vitest'
import { ADAPTIVE_LEVELS, DEFAULTS, sanitize } from '../../shared/theme/theme'
import { MODES, modeOf, patchOf, stepMode } from './adaptiveMode'

describe('the live Adaptive Sound control', () => {
  it('lists Off and every level Settings has, in order', () => {
    expect(MODES).toEqual(['off', 'quiet', 'normal', 'loud'])
    expect(MODES.slice(1).map((m) => patchOf(m).adaptiveLevel)).toEqual([...ADAPTIVE_LEVELS])
  })

  it('reads the mode from the two stored settings, and writes them back the same way (one source of truth)', () => {
    for (const adaptiveLevel of ADAPTIVE_LEVELS) {
      expect(modeOf({ adaptiveSound: false, adaptiveLevel })).toBe('off')
      for (const mode of MODES) {
        const next = { ...DEFAULTS, ...patchOf(mode) }
        expect(modeOf(next)).toBe(mode)
        // What Settings would save and read back (sanitize) is the same mode.
        expect(modeOf(sanitize(JSON.parse(JSON.stringify(next))))).toBe(mode)
      }
    }
    // Off keeps the level Settings last had: only the switch is written.
    expect(patchOf('off')).toEqual({ adaptiveSound: false })
    expect(patchOf('loud')).toEqual({ adaptiveSound: true, adaptiveLevel: -11 })
  })

  it('steps to the next and previous mode and wraps', () => {
    expect(stepMode('off', 1)).toBe('quiet')
    expect(stepMode('loud', 1)).toBe('off')
    expect(stepMode('off', -1)).toBe('loud')
    expect(stepMode('normal', -1)).toBe('quiet')
  })
})
