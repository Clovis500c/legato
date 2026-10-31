import { describe, expect, it } from 'vitest'
import { isListLink, linkKind, shouldWelcome } from './firstRun'

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

  it('knows Deezer and Apple Music lists, and what is not one', () => {
    expect(linkKind('https://www.deezer.com/fr/playlist/2477790684?utm_source=deezer')).toBe('deezer')
    expect(linkKind('https://link.deezer.com/s/32Xtqzp0nOOGSbVgBeVpe')).toBe('deezer')
    expect(linkKind('https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb')).toBe('apple')
    expect(linkKind('https://music.apple.com/fr/album/in-between-dreams/1440857781')).toBe('apple')
    expect(['spotify', 'deezer', 'apple'].map((k) => isListLink({ spotify: 'https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa', deezer: 'https://deezer.com/album/12', apple: 'https://music.apple.com/us/album/x/12' }[k]!))).toEqual([true, true, true])
    expect(isListLink('https://youtu.be/5NV6Rdv1a3I')).toBe(false)
    // Another host, an artist page, a link inside a sentence: not an import.
    for (const text of ['https://evil.example/deezer.com/playlist/12', 'https://deezer.com.evil.example/playlist/12', 'https://www.deezer.com/fr/artist/27', 'listen https://www.deezer.com/playlist/12 now', 'https://music.apple.com/us/artist/drake/271256', 'https://itunes.apple.com/us/album/x/12']) expect(linkKind(text), text).toBeNull()
  })
})
