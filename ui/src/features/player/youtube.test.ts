import { describe, expect, it } from 'vitest'
import { embedUrl, parseYt, YT_ORIGIN } from './youtube'

const msg = (o: object) => JSON.stringify(o)

describe('parseYt', () => {
  it('ignores other origins and junk', () => {
    expect(parseYt('https://evil.example', msg({ event: 'onError', info: 2 }))).toBeUndefined()
    expect(parseYt(YT_ORIGIN, 'not json')).toBeUndefined()
    expect(parseYt(YT_ORIGIN, { event: 'onError' })).toBeUndefined()
  })

  it('reads progress and state', () => {
    expect(parseYt(YT_ORIGIN, msg({ event: 'infoDelivery', info: { currentTime: 12.5, duration: 200, playerState: 1 } }))).toEqual({
      state: 1,
      time: 12.5,
      duration: 200,
    })
    expect(parseYt(YT_ORIGIN, msg({ event: 'infoDelivery', info: { currentTime: 3 } }))).toEqual({ time: 3 })
    expect(parseYt(YT_ORIGIN, msg({ event: 'onStateChange', info: 0 }))).toEqual({ state: 0 })
  })

  it('reports referrer error 153', () => {
    expect(parseYt(YT_ORIGIN, msg({ event: 'onError', info: 153 }))).toEqual({ error: 153 })
  })
})

describe('embedUrl', () => {
  const origin = 'http://tauri.localhost'
  it('bare video by default, YouTube controls on request', () => {
    const bare = embedUrl('dQw4w9WgXcQ', origin)
    expect(bare).toContain('controls=0')
    expect(bare).toContain('rel=0')
    expect(bare).toContain(`origin=${encodeURIComponent(origin)}`)
    expect(embedUrl('dQw4w9WgXcQ', origin, { controls: true })).not.toContain('controls=0')
  })

  it('starts at a whole second, never for less than one', () => {
    expect(embedUrl('x', origin, { start: 61.8 })).toContain('&start=61&')
    expect(embedUrl('x', origin, { autoplay: false })).toContain('autoplay=0')
    expect(embedUrl('x', origin, { start: 0.4 })).not.toContain('start=')
  })
})
