import { describe, expect, it } from 'vitest'
import { accelerator, ACTIONS, bindings, comboLabel, comboOf, conflicts, hasModifier, validCombo, type Keys } from './keys'

const press = (code: string, mods: Partial<Keys> = {}): Keys => ({ code, key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods })

describe('combos', () => {
  it('read physical keys in a fixed modifier order, any layout', () => {
    expect(comboOf(press('ArrowRight', { altKey: true, ctrlKey: true }))).toBe('Ctrl+Alt+ArrowRight')
    // AZERTY: the key labelled A sits where QWERTY's Q is; the combo follows the key, not the letter.
    expect(comboOf(press('KeyQ', { ctrlKey: true, key: 'a' }))).toBe('Ctrl+KeyQ')
    expect(comboOf(press('Space'))).toBe('Space')
  })

  it('never a lone modifier or a media key', () => {
    expect(comboOf(press('ControlLeft', { ctrlKey: true }))).toBeNull()
    expect(comboOf(press('MediaPlayPause'))).toBeNull()
    expect(comboOf(press('AudioVolumeUp'))).toBeNull()
  })

  it('read as people say them, and as the OS takes them', () => {
    expect(comboLabel('Ctrl+Alt+ArrowRight')).toBe('Ctrl Alt →')
    expect(comboLabel('Ctrl+KeyS')).toBe('Ctrl S')
    expect(comboLabel('Ctrl+Comma')).toBe('Ctrl ,')
    expect(accelerator('Meta+Shift+KeyK')).toBe('Super+Shift+KeyK')
    expect(hasModifier('Space')).toBe(false)
    expect(hasModifier('Ctrl+Space')).toBe(true)
  })

  it('only well-formed combos come back from saved settings', () => {
    expect(validCombo('Ctrl+Alt+ArrowRight')).toBe(true)
    expect(validCombo('Ctrl+')).toBe(false)
    expect(validCombo('<img onerror>')).toBe(false)
    expect(validCombo(42)).toBe(false)
  })
})

describe('bindings', () => {
  it('user choices over defaults; null removes', () => {
    const b = bindings({ next: { keys: 'Ctrl+KeyN' }, playPause: { global: null } })
    expect(b.next).toEqual({ keys: 'Ctrl+KeyN', global: 'Ctrl+Alt+ArrowRight' })
    expect(b.playPause.global).toBeNull()
    expect(b.showApp.keys).toBeNull()
  })

  it('every default is unique and well formed', () => {
    expect(conflicts(bindings({})).size).toBe(0)
    for (const a of ACTIONS) for (const c of [a.keys, a.global]) if (c) expect(validCombo(c)).toBe(true)
    for (const a of ACTIONS) if (a.global) expect(hasModifier(a.global)).toBe(true)
  })

  it('flags two actions on one combo', () => {
    const c = conflicts(bindings({ mute: { keys: 'Ctrl+KeyS' } }))
    expect([...c].sort()).toEqual(['keys:mute', 'keys:shuffle'])
  })
})
