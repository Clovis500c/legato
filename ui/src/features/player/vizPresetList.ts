import { MAX_PRESET_CODE, type SavedPreset } from '../../shared/theme/theme'
import { readMilk } from './vizMilk'
import { cleanPreset, type PresetData } from './vizPreset'

/** The Presets look's files (docs/playback.md › Presets), pure: what a picked file holds, an imported preset's id, the .json out. */

/** A preset in a file's text: our .json, or MilkDrop's .milk (anything else is tried as one). Null when it holds none, or too much. */
export function presetFromFile(text: string, file: string): PresetData | null {
  const name = (file.split(/[\\/]/).pop() ?? file).replace(/\.[^.]+$/, '')
  let data: PresetData | null
  if (/\.json$/i.test(file)) {
    try {
      data = cleanPreset(JSON.parse(text), name)
    } catch {
      data = null
    }
  } else data = readMilk(text, name)
  return data && data.init.length + data.frame.length + data.vertex.length <= MAX_PRESET_CODE ? data : null
}

/** An imported preset's id, none of `taken`. */
export function newPresetId(taken: readonly SavedPreset[], now = Date.now()): string {
  let n = now
  while (taken.some((p) => p.id === `u${n.toString(36)}`)) n++
  return `u${n.toString(36)}`
}

/** A preset as the .json file others can import. */
export const presetJson = (p: PresetData) => JSON.stringify({ kind: 'legato-preset', version: 1, name: p.name, base: p.base, init: p.init, frame: p.frame, vertex: p.vertex }, null, 2)
