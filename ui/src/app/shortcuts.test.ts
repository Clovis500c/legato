import { describe, expect, it } from 'vitest'
import { shortcutFor, SHORTCUTS, type Keys } from './shortcuts'

const k = (key: string, mods: Partial<Keys> = {}): Keys => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods })
const label = (e: Keys) => shortcutFor(e)?.label

describe('shortcuts', () => {
  it('maps keys to player and navigation actions', () => {
    expect(label(k(' '))).toBe('Play / pause')
    expect(label(k('ArrowRight', { ctrlKey: true }))).toBe('Next track')
    expect(label(k('ArrowLeft', { shiftKey: true }))).toBe('Back 10 seconds')
    expect(label(k('S', { ctrlKey: true }))).toBe('Shuffle on / off')
    expect(label(k('ArrowLeft', { altKey: true }))).toBe('Back')
  })

  it('needs the exact modifiers', () => {
    expect(shortcutFor(k('ArrowRight'))).toBeUndefined()
    expect(shortcutFor(k(' ', { ctrlKey: true }))).toBeUndefined()
    expect(shortcutFor(k('ArrowRight', { ctrlKey: true, shiftKey: true }))).toBeUndefined()
  })

  it('listed-only entries never fire', () => {
    expect(shortcutFor(k('k', { ctrlKey: true }))).toBeUndefined()
    expect(shortcutFor(k('Escape'))).toBeUndefined()
  })

  it('each key combination is listed once', () => {
    const keys = SHORTCUTS.map((s) => s.keys)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
