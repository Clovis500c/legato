import { describe, expect, it } from 'vitest'
import { minimizeStep } from './pipMinimize'

const base = { was: false, now: false, pip: false, fromMinimize: false, hidden: false, wanted: true }

describe('minimizeStep', () => {
  it('a minimize opens picture in picture; that one minimized, then restored: the full window', () => {
    expect(minimizeStep({ ...base, now: true })).toEqual({ hidden: false, act: 'open' })
    // Brought back on screen to open it: nothing more.
    expect(minimizeStep({ ...base, was: true, pip: true })).toEqual({ hidden: false, act: null })
    const down = minimizeStep({ ...base, now: true, pip: true, fromMinimize: true })
    expect(down).toEqual({ hidden: true, act: null })
    expect(minimizeStep({ ...base, was: true, pip: true, fromMinimize: true, hidden: down.hidden })).toEqual({ hidden: false, act: 'close' })
  })

  it('setting off or nothing playing, or picture in picture opened by P: minimize and restore as before', () => {
    expect(minimizeStep({ ...base, now: true, wanted: false })).toEqual({ hidden: false, act: null })
    const down = minimizeStep({ ...base, now: true, pip: true })
    expect(down).toEqual({ hidden: false, act: null })
    expect(minimizeStep({ ...base, was: true, pip: true, hidden: down.hidden })).toEqual({ hidden: false, act: null })
    // No change (a resize): nothing.
    expect(minimizeStep({ ...base, was: true, now: true, hidden: true })).toEqual({ hidden: true, act: null })
  })
})
