import { msg, tr } from '../../shared/i18n/i18n'
import type { SavedPreset } from '../../shared/theme/theme'
import type { PresetData } from './vizPreset'

/**
 * The presets that come with the app, written for Legato (docs/playback.md › Presets). Their ids are kept in the
 * settings: never rename one. The first is the default. Names go through `msg`: show them with `tr`.
 */
export const BUILT_IN_PRESETS: Record<string, PresetData> = {
  tunnel: {
    name: msg('Tunnel'),
    base: { decay: 0.95, warp: 0.4, wave_mode: 0, wave_a: 0.9, wave_scale: 1.2, ob_size: 0.006, ob_r: 1, ob_g: 1, ob_b: 1, gamma: 1.8 },
    init: '',
    frame: [
      'zoom = 1.025 + 0.035 * bass_att;',
      'rot = 0.008 * sin(time * 0.3);',
      'wave_r = 0.6 + 0.4 * sin(time * 0.7); wave_g = 0.6 + 0.4 * sin(time * 0.9 + 2); wave_b = 0.6 + 0.4 * sin(time * 1.1 + 4);',
      'ob_a = 0.15 + 0.3 * min(1, treb_att - 0.8);',
    ].join('\n'),
    vertex: '',
  },
  drift: {
    name: msg('Drift'),
    base: { decay: 0.97, warp: 2.2, warp_speed: 0.6, wave_mode: 4, wave_a: 0.7, wave_smoothing: 0.85, wave_g: 0.8 },
    init: '',
    frame: [
      'dx = 0.003 * sin(time * 0.21); dy = 0.002 * cos(time * 0.17);',
      'zoom = 1.004 + 0.01 * mid_att;',
      'wave_y = 0.5 + 0.18 * sin(time * 0.4);',
      'wave_r = 0.5 + 0.5 * sin(time * 0.3); wave_b = 0.5 + 0.5 * cos(time * 0.23);',
    ].join('\n'),
    vertex: '',
  },
  bloom: {
    name: msg('Bloom'),
    base: { decay: 0.96, warp: 0.3, wave_mode: 2, wave_a: 0.8, wave_scale: 1.4 },
    init: '',
    frame: 'rot = 0.004 * mid;\nwave_g = 0.5 + 0.5 * sin(time * 0.5); wave_r = 1 - wave_g * 0.5;',
    // The middle shrinks, the edges grow: petals opening with the bass.
    vertex: 'zoom = 1 + (rad - 0.35) * (0.05 + 0.05 * bass_att);',
  },
  spiral: {
    name: msg('Spiral'),
    base: { decay: 0.97, warp: 0.5, wave_mode: 1, wave_a: 0.85, wave_scale: 1.1 },
    init: '',
    frame: 'q1 = 0.025 + 0.02 * bass_att;\nwave_r = 0.7 + 0.3 * sin(time * 0.6); wave_b = 0.7 + 0.3 * sin(time * 0.8 + 1);',
    // Turns faster near the middle.
    vertex: 'rot = q1 * (1.2 - rad);\nzoom = 1.01 + 0.02 * rad;',
  },
  ripple: {
    name: msg('Ripple'),
    base: { decay: 0.95, warp: 0, wave_mode: 0, wave_a: 0.8, wave_scale: 0.8 },
    init: '',
    frame: 'q1 = 0.012 * (0.4 + bass_att);\nq2 = time * 3;',
    vertex: 'zoom = 1 + q1 * sin(rad * 18 - q2);',
  },
  kick: {
    name: msg('Kick'),
    base: { decay: 0.93, warp: 0.6, wave_mode: 6, wave_a: 0.9, ob_size: 0.02, ob_r: 1, ob_g: 1, ob_b: 1 },
    init: '',
    // `hit` jumps on each beat and falls away.
    frame: [
      'hit = if(beat, 1, hit * 0.85);',
      'zoom = 1.005 + 0.07 * hit;',
      'ob_a = 0.5 * hit;',
      'wave_mystery = time * 0.05;',
      'rot = 0.01 * sin(time * 0.2);',
    ].join('\n'),
    vertex: '',
  },
  aurora: {
    name: msg('Aurora'),
    base: { decay: 0.975, warp: 1.6, warp_scale: 1.5, wave_mode: 4, wave_y: 0.85, wave_a: 0.6, wave_smoothing: 0.9, wave_r: 0.4, gamma: 2.2 },
    init: '',
    frame: 'dy = -0.003 - 0.004 * treb_att;\nwave_g = 0.7 + 0.3 * sin(time * 0.5); wave_b = 0.6 + 0.4 * sin(time * 0.37 + 1);',
    // Curtains swaying as they rise.
    vertex: 'dx = 0.003 * sin(y * 9 + time * 1.3);',
  },
  orbit: {
    name: msg('Orbit'),
    base: { decay: 0.96, warp: 0.2, wave_mode: 3, wave_a: 0.8, wave_usedots: 1, wave_thick: 1 },
    init: '',
    frame: [
      'cx = 0.5 + 0.18 * sin(time * 0.37); cy = 0.5 + 0.18 * cos(time * 0.29);',
      'zoom = 1.03 + 0.02 * bass_att;',
      'rot = 0.015 + 0.01 * mid_att;',
      'wave_x = 1 - cx; wave_y = 1 - cy;',
    ].join('\n'),
    vertex: '',
  },
  mirror: {
    name: msg('Mirror'),
    // The echo, flipped left to right, makes both halves alike.
    base: { decay: 0.95, warp: 1, wave_mode: 5, wave_a: 0.8, echo_alpha: 0.5, echo_zoom: 1, echo_orient: 1 },
    init: '',
    frame: 'zoom = 1.01 + 0.02 * bass_att;\nwave_x = 0.3 + 0.1 * sin(time * 0.5);\ndy = 0.002 * sin(time * 0.3);',
    vertex: '',
  },
}

/** The default preset's id. */
export const FIRST_PRESET = 'tunnel'

/** The preset an id stands for (an imported one is checked where it runs); the first built-in one when it's gone. */
export function presetOf(id: string, saved: readonly SavedPreset[]): PresetData {
  const own = saved.find((p) => p.id === id)
  if (own) return { name: own.name, base: own.base, init: own.init, frame: own.frame, vertex: own.vertex }
  return Object.hasOwn(BUILT_IN_PRESETS, id) ? BUILT_IN_PRESETS[id] : BUILT_IN_PRESETS[FIRST_PRESET]
}

/** Every preset to pick, by id: the built-in ones' names translated, the imported ones' as they came. */
export const presetOptions = (saved: readonly SavedPreset[]) => [
  ...Object.entries(BUILT_IN_PRESETS).map(([id, p]) => ({ value: id, label: tr(p.name) })),
  ...saved.map((p) => ({ value: p.id, label: p.name })),
]

/** The preset after `id` in the list, the first after the last. */
export function nextPreset(id: string, saved: readonly SavedPreset[]): string {
  const ids = [...Object.keys(BUILT_IN_PRESETS), ...saved.map((p) => p.id)]
  return ids[(ids.indexOf(id) + 1) % ids.length]
}
