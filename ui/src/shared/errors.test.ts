import { describe, expect, it } from 'vitest'
import { explain, plainKind, rawOf } from './errors'

describe('explain', () => {
  it('says what a network failure means, the raw error kept as detail', () => {
    const raw = 'error sending request for url (https://music.youtube.com/youtubei/v1/search?prettyPrint=false): error trying to connect: dns error: No such host is known. (os error 11001)'
    expect(explain(raw)).toEqual({ text: 'No internet connection: check your network, then try again.', detail: raw })
    expect(explain('YouTube Music: error sending request for url (https://x): operation timed out').text).toBe('YouTube Music: The service took too long to answer: try again in a moment.')
    expect(explain('YouTube Music search → 429 Too Many Requests').text).toBe('YouTube Music: Too many requests for now: wait a few minutes, then try again.')
    expect(explain('Spotify → 503 Service Unavailable').text).toBe('Spotify: The service is having trouble right now: try again later.')
    expect(explain(new Error('Failed to fetch')).text).toBe('No internet connection: check your network, then try again.')
  })

  it('leaves the app’s own words alone', () => {
    expect(explain('Sign in to YouTube Music first (Settings › Accounts)')).toEqual({ text: 'Sign in to YouTube Music first (Settings › Accounts)' })
    expect(explain(new Error('Playlist not found'))).toEqual({ text: 'Playlist not found' })
    // A song title with a number in it isn't a status code.
    expect(explain('Couldn’t add “4290 Days”')).toEqual({ text: 'Couldn’t add “4290 Days”' })
  })

  it('changes nothing the second time', () => {
    for (const raw of ['dns error', 'timed out', '429 Too Many Requests', 'YouTube → 502 Bad Gateway']) {
      const once = explain(raw).text
      expect(explain(once).text).toBe(once)
    }
  })
})

describe('plainKind', () => {
  it('words a known failure in English, service first, whatever the interface speaks', () => {
    expect(plainKind('Spotify → 503 Service Unavailable')).toBe('Spotify: The service is having trouble right now: try again later.')
    expect(plainKind(new Error('Failed to fetch'))).toBe('No internet connection: check your network, then try again.')
  })

  it('has nothing to say about any other text', () => {
    expect(plainKind('Playlist not found')).toBeUndefined()
    expect(rawOf(new Error('Error: Playlist not found'))).toBe('Playlist not found')
  })
})
