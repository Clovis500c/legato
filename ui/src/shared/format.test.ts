import { describe, expect, it } from 'vitest'
import { fileName, formatBytes, spotifyList, timeAgo } from './format'

describe('spotifyList', () => {
  it('spots playlist and album links only', () => {
    expect(spotifyList('https://open.spotify.com/intl-fr/playlist/37i9dQZF1DXcBWIGoYBM5M?si=1')).toBe(true)
    expect(spotifyList('spotify:album:2noRn2Aes5aoNVsU6iWThc')).toBe(true)
    expect(spotifyList('https://open.spotify.com/track/2noRn2Aes5aoNVsU6iWThc')).toBe(false)
    expect(spotifyList('https://youtu.be/5NV6Rdv1a3I')).toBe(false)
  })
})

describe('fileName', () => {
  it('drops what Windows refuses, keeps the rest', () => {
    expect(fileName('lexycat - jinx⌣♡')).toBe('lexycat - jinx⌣♡')
    expect(fileName('AC/DC: Back in Black?  "Live"')).toBe('ACDC Back in Black Live')
    expect(fileName(String.raw`a\b|c*` + '\u0007 ...')).toBe('abc')
    expect(fileName('???')).toBe('cover')
    expect(fileName('x'.repeat(300))).toHaveLength(120)
  })
})

describe('timeAgo and formatBytes', () => {
  it('counts days past a day, bytes read as KB / MB', () => {
    expect(timeAgo(0, 3 * 86_400_000)).toBe('3 days ago')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
