import { describe, expect, it } from 'vitest'
import { physical, watchCommand, watchUpdate } from './watch'

describe('watch page (blocked embeds)', () => {
  it('takes the embed commands the store sends', () => {
    expect(watchCommand('playVideo', [])).toEqual({ type: 'play' })
    expect(watchCommand('pauseVideo', [])).toEqual({ type: 'pause' })
    expect(watchCommand('seekTo', [42.5, true])).toEqual({ type: 'seek', seconds: 42.5 })
    expect(watchCommand('setVolume', [140])).toEqual({ type: 'volume', percent: 100 })
    expect(watchCommand('seekTo', ['nope'])).toEqual({ type: 'seek', seconds: 0 })
    // Embed-only commands (captions, loadVideoById) mean nothing there.
    expect(watchCommand('unloadModule', ['captions'])).toBeNull()
  })

  it('reports become the embed updates, late ones from another video are dropped', () => {
    expect(watchUpdate({ state: 1, time: 12, duration: 200, videoId: 'abcdefghijk', click: false, ready: false, cropped: false }, 'abcdefghijk')).toEqual({ state: 1, time: 12, duration: 200 })
    expect(watchUpdate({ state: 1, time: 12, videoId: 'otherotherx', click: false, ready: false, cropped: false }, 'abcdefghijk')).toBeNull()
    // Cookie choice pending on the watch page: said plainly, never a silent pause.
    expect(watchUpdate({ error: 'CONSENT', click: false, ready: false, cropped: false }, 'abcdefghijk')).toEqual({ unplayable: expect.stringContaining('cookie choice') })
    expect(watchUpdate({ error: 'UNPLAYABLE', reason: 'Not available in your country', click: false, ready: false, cropped: false }, 'abcdefghijk')).toEqual({ unplayable: 'Not available in your country' })
    expect(watchUpdate({ error: 'LOGIN_REQUIRED', click: false, ready: false, cropped: false }, 'abcdefghijk')).toEqual({ unplayable: 'LOGIN_REQUIRED' })
  })

  it('places the webview in physical pixels', () => {
    expect(physical({ left: 10, top: 20, width: 356, height: 200 }, 1.5)).toEqual({ x: 15, y: 30, width: 534, height: 300 })
  })
})
