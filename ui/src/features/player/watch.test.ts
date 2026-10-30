import { describe, expect, it } from 'vitest'
import type { WatchReport } from '../../shared/api'
import { physical, watchCommand, watchUpdate } from './watch'

/** What the shell sends: every field there, null when the page said nothing. */
const report = (r: Partial<WatchReport>): WatchReport => ({ state: null, time: null, duration: null, videoId: null, error: null, reason: null, click: false, ready: false, cropped: false, ...r })

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
    expect(watchUpdate(report({ state: 1, time: 12, duration: 200, videoId: 'abcdefghijk' }), 'abcdefghijk')).toEqual({ state: 1, time: 12, duration: 200 })
    expect(watchUpdate(report({ state: 1, time: 12, videoId: 'otherotherx' }), 'abcdefghijk')).toBeNull()
    // Cookie choice pending on the watch page: said plainly, never a silent pause.
    expect(watchUpdate(report({ error: 'CONSENT' }), 'abcdefghijk')).toEqual({ unplayable: expect.stringContaining('cookie choice') })
    expect(watchUpdate(report({ error: 'UNPLAYABLE', reason: 'Not available in your country' }), 'abcdefghijk')).toEqual({ unplayable: 'Not available in your country' })
    expect(watchUpdate(report({ error: 'LOGIN_REQUIRED' }), 'abcdefghijk')).toEqual({ unplayable: 'LOGIN_REQUIRED' })
  })

  it('places the webview in physical pixels', () => {
    expect(physical({ left: 10, top: 20, width: 356, height: 200 }, 1.5)).toEqual({ x: 15, y: 30, width: 534, height: 300 })
  })
})
