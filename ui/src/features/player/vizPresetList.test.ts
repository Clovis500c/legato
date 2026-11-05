import { describe, expect, it } from 'vitest'
import type { SavedPreset } from '../../shared/theme/theme'
import { createPreset } from './vizPreset'
import { BUILT_IN_PRESETS, FIRST_PRESET, nextPreset, presetOf, presetOptions } from './vizPresets'
import { newPresetId, presetFromFile, presetJson } from './vizPresetList'

const mine: SavedPreset = { id: 'u1', name: 'Mine', base: { zoom: 1.1, bogus: 2 }, init: '', frame: 'rot = 0.01', vertex: '' }

describe('preset list', () => {
  it('finds a preset by id, the first built-in one for an unknown id', () => {
    expect(presetOf('u1', [mine])).toEqual({ name: 'Mine', base: { zoom: 1.1, bogus: 2 }, init: '', frame: 'rot = 0.01', vertex: '' })
    expect(presetOf('spiral', [mine])).toBe(BUILT_IN_PRESETS.spiral)
    expect(presetOf('gone', [mine])).toBe(BUILT_IN_PRESETS[FIRST_PRESET])
    expect(presetOf('toString', [])).toBe(BUILT_IN_PRESETS[FIRST_PRESET])
  })

  it('lists the built-in presets, then the imported ones, and goes round', () => {
    const options = presetOptions([mine])
    expect(options[0].value).toBe(FIRST_PRESET)
    expect(options.at(-1)).toEqual({ value: 'u1', label: 'Mine' })
    expect(nextPreset(FIRST_PRESET, [mine])).toBe(options[1].value)
    expect(nextPreset('u1', [mine])).toBe(FIRST_PRESET)
    expect(nextPreset('gone', [])).toBe(FIRST_PRESET)
  })

  it('reads a preset from a .json or a .milk file, named after the file', () => {
    const json = presetJson(BUILT_IN_PRESETS.kick)
    expect(JSON.parse(json).kind).toBe('legato-preset')
    expect(presetFromFile(json, 'C:\\Presets\\My kick.json')).toEqual({ ...BUILT_IN_PRESETS.kick })
    const milk = presetFromFile('[preset00]\nzoom=1.02\nper_frame_1=rot = 0.01;', '/home/me/Deep Space.milk')
    expect(milk?.name).toBe('Deep Space')
    expect(milk && createPreset(milk).errors).toEqual([null, null, null])
    expect(presetFromFile('{not json', 'x.json')).toBeNull()
    expect(presetFromFile('hello', 'x.milk')).toBeNull()
    expect(presetFromFile(`[preset00]\nper_frame_1=${'a = 1;'.repeat(3000)}`, 'big.milk')).toBeNull()
  })

  it('gives an imported preset an id no other has', () => {
    expect(newPresetId([], 35)).toBe('uz')
    expect(newPresetId([{ ...mine, id: 'uz' }], 35)).toBe('u10')
  })
})
