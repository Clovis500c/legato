import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api } from '../../shared/api'
import { pickFile, saveFile } from '../../shared/files'
import { tr } from '../../shared/i18n/i18n'
import { MAX_SAVED_PRESETS } from '../../shared/theme/theme'
import { createPreset } from './vizPreset'
import { newPresetId, presetFromFile, presetJson } from './vizPresetList'
import { FIRST_PRESET, presetOf } from './vizPresets'

/** The Presets look's files (Settings › Playback, the visualizer's menu): a .milk or .json preset in, the one shown out. */

const fail = (e: unknown) => void useStore.getState().notify(String(e), { kind: 'error' })

/** A preset file picked, kept and shown (the look switched to Presets). */
export async function importPreset() {
  const { settings, update } = useSettings.getState()
  if (settings.visualizerPresets.length >= MAX_SAVED_PRESETS) return fail(tr('{n} presets at most: remove one first.', { n: MAX_SAVED_PRESETS }))
  const file = await pickFile({ filters: [{ name: 'Visualizer preset', extensions: ['milk', 'json'] }] }).catch(fail)
  if (!file) return
  try {
    const data = presetFromFile(await api.readPreset(file), file)
    if (!data) return fail(tr('No preset Legato can read in this file.'))
    const id = newPresetId(settings.visualizerPresets)
    const saved = { id, ...data, base: data.base as Record<string, number> }
    update({ visualizerPresets: [...useSettings.getState().settings.visualizerPresets, saved], visualizerPreset: id, visualizerStyle: 'preset' })
    if (createPreset(data).errors.some(Boolean)) useStore.getState().notify(tr('Some of its equations can’t be read here: it may look plainer than in MilkDrop.'))
  } catch (e) {
    fail(e)
  }
}

/** The preset shown, as a .json file others can import. */
export async function exportPreset() {
  const { visualizerPreset: id, visualizerPresets: saved } = useSettings.getState().settings
  const data = presetOf(id, saved)
  const name = saved.some((p) => p.id === id) ? data.name : tr(data.name)
  try {
    await saveFile({ defaultPath: `${name.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'preset'}.json`, filters: [{ name: 'Visualizer preset', extensions: ['json'] }] }, (path) => api.writePreset(path, presetJson({ ...data, name })))
  } catch (e) {
    fail(e)
  }
}

/** An imported preset gone; the first built-in one shows if it was this one. */
export function removePreset(id: string) {
  const { settings, update } = useSettings.getState()
  update({ visualizerPresets: settings.visualizerPresets.filter((p) => p.id !== id), ...(settings.visualizerPreset === id ? { visualizerPreset: FIRST_PRESET } : {}) })
}
