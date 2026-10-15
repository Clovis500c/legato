import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Library } from './library'
import type { Track } from './types'

let lib: Library
beforeEach(() => (lib = new Library()))
afterEach(() => lib.close())

const spotify: Track = {
  title: 'Get Lucky (feat. Pharrell Williams)',
  artist: 'Daft Punk, Pharrell Williams',
  album: 'Random Access Memories',
  durationMs: 248_000,
  isrc: 'USQX91300108',
  ids: { spotify: '2Foc5Q5nqNiosCNqttzHof' },
}
const youtube: Track = { title: 'Get Lucky (Official Audio)', artist: 'Daft Punk', durationMs: 250_000, ids: { youtube: '5NV6Rdv1a3I' } }

describe('Library', () => {
  it('dédoublonne par ISRC entre deux sources', () => {
    const a = lib.upsertTrack(spotify)
    const b = lib.upsertTrack({ ...youtube, isrc: 'usqx91300108' })
    expect(b).toBe(a)
    expect(lib.tracks()).toHaveLength(1)
    expect(lib.tracks()[0].ids).toEqual({ spotify: spotify.ids.spotify, youtube: '5NV6Rdv1a3I' })
  })

  it('dédoublonne par titre + artiste + durée sans ISRC', () => {
    lib.upsertTrack(spotify)
    lib.upsertTrack(youtube)
    expect(lib.tracks()).toHaveLength(1)
  })

  it('garde séparés deux enregistrements aux ISRC différents', () => {
    lib.upsertTrack(spotify)
    lib.upsertTrack({ ...spotify, isrc: 'USQX91300999', ids: { spotify: 'other' } })
    expect(lib.tracks()).toHaveLength(2)
  })

  it('fusionne deux lignes existantes quand un matching les relie', () => {
    // Long-intro clip: duration too far for fuzzy match, stays separate…
    const clip = { ...youtube, durationMs: 300_000 }
    lib.upsertTrack(spotify)
    lib.upsertTrack(clip)
    expect(lib.tracks()).toHaveLength(2)
    const pid = lib.savePlaylist('youtube', 'PL1', 'Mix', [clip])
    // …until YouTube → Spotify match links both ids.
    lib.upsertTrack({ ...clip, isrc: spotify.isrc, ids: { youtube: '5NV6Rdv1a3I', spotify: spotify.ids.spotify } })
    const [only] = lib.tracks()
    expect(lib.tracks()).toHaveLength(1)
    expect(only).toMatchObject({ isrc: 'USQX91300108', album: 'Random Access Memories' })
    expect(lib.playlistTracks(pid).map((t) => t.id)).toEqual([only.id])
  })

  it('remplace le contenu d’une playlist à chaque import', () => {
    lib.savePlaylist('spotify', 'p1', 'Old', [spotify, youtube])
    const id = lib.savePlaylist('spotify', 'p1', 'New', [spotify])
    expect(lib.playlists()).toEqual([{ id, source: 'spotify', sourceId: 'p1', name: 'New', trackCount: 1 }])
  })

  it('annule tout en cas d’erreur dans la transaction', () => {
    expect(() => lib.savePlaylist('spotify', 'p1', 'X', [spotify, { ...youtube, title: null as unknown as string }])).toThrow()
    expect(lib.playlists()).toEqual([])
    expect(lib.tracks()).toEqual([])
  })
})
