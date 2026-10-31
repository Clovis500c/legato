import { afterEach, describe, expect, it, vi } from 'vitest'
import { karaokeKeys } from './karaokeKeys'

// No DOM in these tests: a window that is an event target, a document that says whether a menu is open.
function setup(menuOpen = false) {
  const win = new EventTarget()
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', { querySelector: () => (menuOpen ? {} : null) })
  const left = vi.fn()
  const moved = vi.fn()
  const off = karaokeKeys(left, moved)
  // A listener after ours (the app's shortcuts): it must not see what karaoke took.
  const app = vi.fn()
  win.addEventListener('keydown', app)
  const press = (code: string, mods: Partial<KeyboardEventInit> = {}) => {
    const e = new Event('keydown', { cancelable: true }) as Event & Record<string, unknown>
    Object.assign(e, { code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods })
    win.dispatchEvent(e)
    return e.defaultPrevented
  }
  return { left, moved, app, press, off }
}

afterEach(() => vi.unstubAllGlobals())

describe('karaoke keys', () => {
  it('Esc leaves and nothing else hears it', () => {
    const { left, app, press } = setup()
    expect(press('Escape')).toBe(true)
    expect(left).toHaveBeenCalledOnce()
    expect(app).not.toHaveBeenCalled()
  })

  it('the bare arrows move the lyrics, ahead of the app', () => {
    const { moved, app, press } = setup()
    press('ArrowLeft')
    press('ArrowRight')
    press('ArrowDown')
    press('ArrowUp')
    expect(moved.mock.calls.map((c) => c[0])).toEqual([-500, 500, -100, 100])
    expect(app).not.toHaveBeenCalled()
  })

  it('arrows with Ctrl or Shift stay the app’s (volume, seek)', () => {
    const { moved, app, press } = setup()
    expect(press('ArrowUp', { ctrlKey: true })).toBe(false)
    expect(press('ArrowRight', { shiftKey: true })).toBe(false)
    expect(moved).not.toHaveBeenCalled()
    expect(app).toHaveBeenCalledTimes(2)
  })

  it('other keys pass; a menu open on top keeps its Esc', () => {
    const { left, app, press } = setup(true)
    expect(press('KeyK')).toBe(false)
    expect(press('Escape')).toBe(false)
    expect(left).not.toHaveBeenCalled()
    expect(app).toHaveBeenCalledTimes(2)
  })

  it('stops listening once cleaned up', () => {
    const { left, press, off } = setup()
    off()
    press('Escape')
    expect(left).not.toHaveBeenCalled()
  })
})
