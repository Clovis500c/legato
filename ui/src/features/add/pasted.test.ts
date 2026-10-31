import { describe, expect, it } from 'vitest'
import { hasSpotifyTracks } from './pasted'

describe('hasSpotifyTracks', () => {
  it('knows the links Spotify copies, not titles or lists', () => {
    expect(hasSpotifyTracks('https://open.spotify.com/track/0DiWol3AO6WpXZgp0goxAV?si=1\nhttps://open.spotify.com/track/3XmwAZpIMNpTJy8faw3ajD')).toBe(true)
    expect(hasSpotifyTracks('https://open.spotify.com/intl-fr/track/0DiWol3AO6WpXZgp0goxAV')).toBe(true)
    expect(hasSpotifyTracks('spotify:track:0DiWol3AO6WpXZgp0goxAV')).toBe(true)
    expect(hasSpotifyTracks('Daft Punk - One More Time')).toBe(false)
    expect(hasSpotifyTracks('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toBe(false)
  })
})
