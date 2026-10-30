import { describe, expect, it } from 'vitest'
import { linkKind, shouldWelcome } from './firstRun'

describe('welcome', () => {
  it('shows once, on an empty library only', () => {
    expect(shouldWelcome(false, 0, 0)).toBe(true)
    expect(shouldWelcome(true, 0, 0)).toBe(false)
    // An update to someone with music: never.
    expect(shouldWelcome(false, 1200, 0)).toBe(false)
    expect(shouldWelcome(false, 0, 3)).toBe(false)
  })

  it('tells a playlist link from a song link', () => {
    expect(linkKind('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc')).toBe('spotify')
    expect(linkKind('https://open.spotify.com/intl-fr/album/4m2880jivSbbyEGAKfITCa')).toBe('spotify')
    expect(linkKind('https://www.youtube.com/watch?v=5NV6Rdv1a3I')).toBe('youtube')
    expect(linkKind('https://youtu.be/5NV6Rdv1a3I')).toBe('youtube')
    expect(linkKind('https://music.youtube.com/watch?v=5NV6Rdv1a3I')).toBe('youtube')
    // A Spotify song isn't a list; plain words aren't links.
    expect(linkKind('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toBeNull()
    expect(linkKind('daft punk')).toBeNull()
  })
})
