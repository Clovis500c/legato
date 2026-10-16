import { describe, expect, it } from 'vitest'
import { fileName, spotifyList } from './format'

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
