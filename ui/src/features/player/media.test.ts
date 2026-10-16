import { describe, expect, it } from 'vitest'
import { keyAction, mediaNow, needsPush } from './media'

describe('media keys', () => {
  it('play and pause only act when they change state', () => {
    expect(keyAction('play', false)).toBe('toggle')
    expect(keyAction('play', true)).toBeNull()
    expect(keyAction('pause', true)).toBe('toggle')
    expect(keyAction('pause', false)).toBeNull()
    expect(keyAction('stop', true)).toBe('toggle')
  })

  it('next, previous and the tray toggle always act', () => {
    expect(keyAction('next', false)).toBe('next')
    expect(keyAction('previous', true)).toBe('prev')
    expect(keyAction('toggle', true)).toBe('toggle')
    expect(keyAction('toggle', false)).toBe('toggle')
  })
})

const now = { title: 'Blinding Lights', artist: 'The Weeknd', via: 'youtube' as const, trackId: 1 }

describe('media panel info', () => {
  it('nothing playing hides the panel', () => {
    expect(mediaNow(undefined, false)).toBeNull()
  })

  it('takes album from the library row, rounds times', () => {
    const track = { id: 1, title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', durationMs: null, isrc: null, ids: {} }
    expect(mediaNow(now, true, track, 1234.6, 200_000.4)).toEqual({ title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', playing: true, positionMs: 1235, durationMs: 200_000 })
    expect(mediaNow(now, false)?.album).toBeNull()
    expect(mediaNow(now, false, undefined, -50)?.positionMs).toBe(0)
  })
})

describe('when to push', () => {
  const at = (playing: boolean, positionMs: number) => mediaNow(now, playing, undefined, positionMs, 200_000)

  it('pushes changes of track, state or duration', () => {
    expect(needsPush(null, at(true, 0), 0)).toBe(true)
    expect(needsPush({ info: null, at: 0 }, null, 0)).toBe(false)
    expect(needsPush({ info: at(true, 0), at: 0 }, at(false, 500), 500)).toBe(true)
    expect(needsPush({ info: at(true, 0), at: 0 }, { ...at(true, 500)!, durationMs: 210_000 }, 500)).toBe(true)
    expect(needsPush({ info: at(true, 0), at: 0 }, null, 500)).toBe(true)
  })

  it('normal playback is left to Windows, seeks and drift are not', () => {
    expect(needsPush({ info: at(true, 0), at: 0 }, at(true, 3000), 3000)).toBe(false)
    expect(needsPush({ info: at(true, 0), at: 0 }, at(true, 60_000), 3000)).toBe(true)
    expect(needsPush({ info: at(true, 0), at: 0 }, at(true, 11_000), 11_000)).toBe(true)
    // Paused: position must stay put.
    expect(needsPush({ info: at(false, 5000), at: 0 }, at(false, 5000), 60_000)).toBe(false)
    expect(needsPush({ info: at(false, 5000), at: 0 }, at(false, 9000), 1000)).toBe(true)
  })
})
