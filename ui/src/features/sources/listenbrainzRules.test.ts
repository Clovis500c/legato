import { describe, expect, it } from 'vitest'
import { counts, toListen } from './listenbrainzRules'

const song = { artist: 'Kavinsky', title: 'Nightcall', album: 'OutRun', durationMs: 258_000, isrc: 'FR6V81200001', ids: { youtube: 'MV_3Dpw-BRY', spotify: '0U0ldCRmgCqhVvD6ksG63j' } }

describe('ListenBrainz', () => {
  it('counts half of the song or 4 minutes heard', () => {
    expect(counts(258_000, 129_000)).toBe(true)
    expect(counts(258_000, 128_000)).toBe(false)
    expect(counts(900_000, 240_000)).toBe(true)
    // Short songs count too (no 30 s floor, unlike Last.fm).
    expect(counts(20_000, 10_000)).toBe(true)
    expect(counts(null, 200_000)).toBe(false)
  })

  it('says where the listen played from', () => {
    expect(toListen(song, 1_800_000_000, { via: 'youtube', youtubeId: 'otherVideo1' })).toEqual({ artist: 'Kavinsky', track: 'Nightcall', album: 'OutRun', durationMs: 258_000, listenedAt: 1_800_000_000, isrc: 'FR6V81200001', youtubeId: 'otherVideo1', spotifyId: null })
    expect(toListen(song, 1, { via: 'spotify' })).toMatchObject({ youtubeId: null, spotifyId: '0U0ldCRmgCqhVvD6ksG63j' })
    // A file of yours, an Apple preview: no link.
    expect(toListen({ ...song, ids: { local: 'C:/Music/a.mp3', youtube: 'MV_3Dpw-BRY' } }, 1)).toMatchObject({ youtubeId: null, spotifyId: null })
    expect(toListen(song, 1, { via: 'preview' })).toMatchObject({ youtubeId: null, spotifyId: null })
    // Not noted: the player's first choice; the length measured wins over the library's.
    expect(toListen(song, 1, undefined, 261_400.4)).toMatchObject({ youtubeId: 'MV_3Dpw-BRY', durationMs: 261_400 })
  })
})
