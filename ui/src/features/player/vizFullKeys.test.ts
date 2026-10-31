import { afterEach, describe, expect, it, vi } from 'vitest'
import { vizFullKeys } from './vizFullKeys'

// No DOM in these tests: a window that is an event target, a document that says whether a menu is open.
function setup(menuOpen = false) {
  const win = new EventTarget()
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', { querySelector: () => (menuOpen ? {} : null) })
  const left = vi.fn()
  const off = vizFullKeys(left)
  // A listener after ours (the app's shortcuts): it must not see what the screen took.
  const app = vi.fn()
  win.addEventListener('keydown', app)
  const press = (code: string, mods: Partial<KeyboardEventInit> = {}) => {
    const e = new Event('keydown', { cancelable: true }) as Event & Record<string, unknown>
    Object.assign(e, { code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods })
    win.dispatchEvent(e)
    return e.defaultPrevented
  }
  return { left, app, press, off }
}

afterEach(() => vi.unstubAllGlobals())

describe('visualizer screen keys', () => {
  it('Esc leaves, ahead of the app', () => {
    const { left, app, press } = setup()
    expect(press('Escape')).toBe(true)
    expect(left).toHaveBeenCalledOnce()
    expect(app).not.toHaveBeenCalled()
  })

  it('every other key stays the app’s', () => {
    const { left, app, press } = setup()
    for (const code of ['Space', 'KeyV', 'ArrowRight', 'KeyF']) expect(press(code)).toBe(false)
    expect(left).not.toHaveBeenCalled()
    expect(app).toHaveBeenCalledTimes(4)
  })

  it('a menu open on top keeps its Esc; modifiers are not Esc', () => {
    const open = setup(true)
    expect(open.press('Escape')).toBe(false)
    expect(open.left).not.toHaveBeenCalled()
    open.off()
    const plain = setup()
    expect(plain.press('Escape', { shiftKey: true })).toBe(false)
    expect(plain.left).not.toHaveBeenCalled()
  })

  it('stops listening once cleaned up', () => {
    const { left, press, off } = setup()
    off()
    press('Escape')
    expect(left).not.toHaveBeenCalled()
  })
})
