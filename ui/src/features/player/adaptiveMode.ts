import { ADAPTIVE_LEVELS, type AdaptiveLevel } from '../../shared/theme/theme'

/**
 * The live Adaptive Sound control under the volume (AdaptiveSwitch.tsx): Off, or one of Settings' three levels. Not a new setting: the
 * mode is read from, and written to, the same two stored settings (`adaptiveSound`, `adaptiveLevel`), so Settings and the bar stay in step.
 */
export const MODES = ['off', 'quiet', 'normal', 'loud'] as const
export type Mode = (typeof MODES)[number]

const LEVELS: Record<Exclude<Mode, 'off'>, AdaptiveLevel> = { quiet: ADAPTIVE_LEVELS[0], normal: ADAPTIVE_LEVELS[1], loud: ADAPTIVE_LEVELS[2] }

export function modeOf(s: { adaptiveSound: boolean; adaptiveLevel: AdaptiveLevel }): Mode {
  return s.adaptiveSound ? (MODES.find((m) => m !== 'off' && LEVELS[m] === s.adaptiveLevel) ?? 'normal') : 'off'
}

/** The settings a mode writes: Off only turns the switch off, so Settings keeps the level it had. */
export function patchOf(mode: Mode): { adaptiveSound: boolean; adaptiveLevel?: AdaptiveLevel } {
  return mode === 'off' ? { adaptiveSound: false } : { adaptiveSound: true, adaptiveLevel: LEVELS[mode] }
}

/** The next (1) or previous (-1) mode, wrapping. */
export function stepMode(mode: Mode, dir: 1 | -1): Mode {
  return MODES[(MODES.indexOf(mode) + dir + MODES.length) % MODES.length]
}
