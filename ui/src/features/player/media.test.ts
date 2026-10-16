import { describe, expect, it } from 'vitest'
import { keyAction, mediaNow } from './media'

describe('media keys', () => {
  it('play and pause only act when they change state', () => {
    expect(keyAction('play', false)).toBe('toggle')
    expect(keyAction('play', true)).toBeNull()
    expect(keyAction('pause', true)).toBe('toggle')
    expect(keyAction('pause', false)).toBeNull()
    expect(keyAction('stop', true)).toBe('toggle')
  })

  it('next and previous always step', () => {
    expect(keyAction('next', false)).toBe('next')
    expect(keyAction('previous', true)).toBe('prev')
  })
})

describe('media panel info', () => {
  it('nothing playing hides the panel', () => {
    expect(mediaNow(undefined, false)).toBeNull()
  })

  it('takes album from the library row', () => {
    const now = { title: 'Blinding Lights', artist: 'The Weeknd', via: 'youtube' as const, trackId: 1 }
    const track = { id: 1, title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', durationMs: null, isrc: null, ids: {} }
    expect(mediaNow(now, true, track)).toEqual({ title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', playing: true })
    expect(mediaNow(now, false)?.album).toBeNull()
  })
})
