import { cleanPreset, type PresetData, type PresetVar } from './vizPreset'

/**
 * MilkDrop's .milk preset files (a user's own, picked from their disk), read as far as our engine goes: the starting
 * values it knows and the per-frame, per-pixel and init equations. Motion vectors, custom waves and shapes and the
 * shaders are left out, so a preset can look plainer than in MilkDrop. Pure.
 */
const NAMES = new Map<string, PresetVar>([
  ['fgammaadj', 'gamma'],
  ['fdecay', 'decay'],
  ['fvideoechozoom', 'echo_zoom'],
  ['fvideoechoalpha', 'echo_alpha'],
  ['nvideoechoorientation', 'echo_orient'],
  ['nwavemode', 'wave_mode'],
  ['badditivewaves', 'wave_additive'],
  ['bwavedots', 'wave_usedots'],
  ['bwavethick', 'wave_thick'],
  ['bmaximizewavecolor', 'wave_brighten'],
  ['btexwrap', 'wrap'],
  ['bdarkencenter', 'darken_center'],
  ['bbrighten', 'brighten'],
  ['bdarken', 'darken'],
  ['bsolarize', 'solarize'],
  ['binvert', 'invert'],
  ['fwavealpha', 'wave_a'],
  ['fwavescale', 'wave_scale'],
  ['fwavesmoothing', 'wave_smoothing'],
  ['fwaveparam', 'wave_mystery'],
  ['fwarpanimspeed', 'warp_speed'],
  ['fwarpscale', 'warp_scale'],
  ['fzoomexponent', 'zoomexp'],
  ...(['zoom', 'rot', 'cx', 'cy', 'dx', 'dy', 'warp', 'sx', 'sy', 'wave_r', 'wave_g', 'wave_b', 'wave_x', 'wave_y'] as const).map((n) => [n, n] as const),
  ...(['ob_size', 'ob_r', 'ob_g', 'ob_b', 'ob_a', 'ib_size', 'ib_r', 'ib_g', 'ib_b', 'ib_a'] as const).map((n) => [n, n] as const),
])
const CODE = /^per_(frame_init|frame|pixel)_(\d+)$/

/** A .milk file's largest size we read. */
export const MAX_MILK = 256 * 1024

/** The preset in a .milk file's text, named `name` (the file's), or null when it holds none. */
export function readMilk(text: string, name: string): PresetData | null {
  if (text.length > MAX_MILK) return null
  const base: Partial<Record<PresetVar, number>> = {}
  const code = { init: [] as [number, string][], frame: [] as [number, string][], vertex: [] as [number, string][] }
  let seen = false
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1)
    const prog = CODE.exec(key)
    if (prog) {
      code[prog[1] === 'frame_init' ? 'init' : prog[1] === 'frame' ? 'frame' : 'vertex'].push([Number(prog[2]), value])
      seen = true
      continue
    }
    const ours = NAMES.get(key)
    const v = Number(value.trim())
    if (ours && value.trim() && Number.isFinite(v)) {
      base[ours] = v
      seen = true
    }
  }
  if (!seen) return null
  const join = (lines: [number, string][]) =>
    lines
      .sort((a, b) => a[0] - b[0])
      .map(([, l]) => l)
      .join('\n')
  return cleanPreset({ name, base, init: join(code.init), frame: join(code.frame), vertex: join(code.vertex) }, name)
}
