import { describe, expect, it } from 'vitest'
import type { LibraryPlaylist, LibraryTrack, SearchHit } from '../../shared/api'
import { groupAlbums, groupArtists } from '../library/filter'
import { MAX_RECENT, remember } from './recent'
import { countBy, errorOf, isSong, isVideo, libraryMatches } from './results'

const t = (id: number, title: string, artist: string, album: string | null): LibraryTrack => ({ id, added: id, title, artist, album, durationMs: null, isrc: null, ids: { youtube: `y${id}` } })
const tracks = [t(1, 'Get Lucky', 'Daft Punk', 'Random Access Memories'), t(2, 'Instant Crush', 'Daft Punk', 'Random Access Memories'), t(3, 'Punk Rock Song', 'Bad Religion', 'The Gray Race'), t(4, 'Nightcall', 'Kavinsky', 'OutRun')]
const pl = (id: number, name: string, trackCount: number): LibraryPlaylist => ({ id, source: 'local', sourceId: String(id), name, trackCount, custom: true, newestFirst: false, orderManual: false })
const playlists = [pl(1, 'Best of punk', 30), pl(2, 'Punk mix', 3), pl(3, 'Chill', 10)]
const groups = { artists: groupArtists(tracks), albums: groupAlbums(tracks) }
const hit = (from: SearchHit['from']): SearchHit => ({ title: 'x', artist: 'y', album: null, durationMs: null, isrc: null, ids: {}, libraryId: null, musicness: 'music', from })

describe('libraryMatches', () => {
  it('needs every word, accents and case ignored', () => {
    const m = libraryMatches(tracks, playlists, 'DÁFT lucky', groups)
    expect(m.songs.map((x) => x.id)).toEqual([1])
    expect(m.artists).toEqual([])
  })
  it('puts names starting with the text first, then the biggest', () => {
    const m = libraryMatches(tracks, playlists, 'punk', groups)
    expect(m.artists.map((a) => a.artist)).toEqual(['Daft Punk'])
    expect(m.playlists.map((p) => p.name)).toEqual(['Punk mix', 'Best of punk'])
    // Albums match on their artist too.
    expect(m.albums.map((a) => a.album)).toEqual(['Random Access Memories'])
  })
  it('gives nothing for blank text', () => {
    expect(libraryMatches(tracks, playlists, '  ', groups)).toEqual({ songs: [], artists: [], albums: [], playlists: [] })
  })
})

describe('catalog hits', () => {
  it('tells songs from videos by who found them', () => {
    expect([isSong(hit(['youtube'])), isVideo(hit(['youtube']))]).toEqual([false, true])
    expect([isSong(hit(['youtube', 'ytmusic'])), isVideo(hit(['youtube', 'ytmusic']))]).toEqual([true, true])
    expect(isSong(hit(['apple']))).toBe(true)
  })
  it('counts per source and finds each source error', () => {
    expect(countBy([hit(['youtube', 'apple']), hit(['apple'])])).toEqual({ youtube: 1, ytmusic: 0, apple: 2 })
    const errors = ['YouTube Music: 401 Unauthorized', 'YouTube: timed out']
    expect(errorOf(errors, 'youtube')).toBe('timed out')
    expect(errorOf(errors, 'ytmusic')).toBe('401 Unauthorized')
    expect(errorOf(errors, 'apple')).toBeUndefined()
  })
})

describe('remember', () => {
  it('puts the search on top once and keeps the newest', () => {
    expect(remember(['daft punk', 'm83'], ' M83 ')).toEqual(['M83', 'daft punk'])
    expect(remember(['télé'], 'tele')).toEqual(['tele'])
    expect(remember(['a'], '   ')).toEqual(['a'])
    const many = Array.from({ length: MAX_RECENT }, (_, i) => `q${i}`)
    expect(remember(many, 'new')).toEqual(['new', ...many.slice(0, MAX_RECENT - 1)])
  })
})
