import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { LibraryPlaylist, LibraryTrack, SearchHit } from '../../shared/api'
import { groupAlbums, groupArtists, type PlayStats } from '../library/filter'
import { MAX_RECENT, remember } from './recent'
import { countBy, errorOf, isSong, isVideo, libraryMatches, topOf } from './results'

const t = (id: number, title: string, artist: string, album: string | null): LibraryTrack => ({ id, added: id, addedAt: null, title, artist, album, durationMs: null, isrc: null, ids: { youtube: `y${id}` } })
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
  it('ranks songs: the title first, then the artist, then the album', () => {
    expect(libraryMatches(tracks, playlists, 'punk', groups).songs.map((x) => x.id)).toEqual([3, 1, 2])
    expect(libraryMatches(tracks, playlists, 'random', groups).songs.map((x) => x.id)).toEqual([1, 2])
  })
})

describe('library songs ranked', () => {
  const lib = [
    t(1, 'Hello Goodbye', 'The Beatles', 'Magical Mystery Tour'),
    t(2, 'Say Hello', 'Someone', null),
    t(3, 'Hello', 'Lionel Richie', "Can't Slow Down"),
    t(4, 'Hello', 'Adele', '25'),
    t(5, 'Don’t Stop Me Now', 'Queen', 'Jazz'),
    t(6, 'Highway to Hell', 'AC/DC', 'Highway to Hell'),
    t(7, 'The Boxer', 'Simon & Garfunkel', null),
  ]
  const g = { artists: groupArtists(lib), albums: groupAlbums(lib) }
  const ids = (q: string, stats: PlayStats = {}) => libraryMatches(lib, [], q, g, stats).songs.map((x) => x.id)
  it('puts the song named by the text first, then names starting with it, then names holding it', () => {
    expect(ids('hello')).toEqual([3, 4, 1, 2])
    // Most played first among equals.
    expect(ids('hello', { 4: [12, 0] })).toEqual([4, 3, 1, 2])
    expect(ids('adele hello')).toEqual([4])
  })
  it('ignores marks: dont, acdc, and', () => {
    expect(ids('dont stop')).toEqual([5])
    expect(ids('acdc')).toEqual([6])
    expect(ids('simon and garfunkel')).toEqual([7])
  })
  it('fixes a typo only when nothing matched as typed', () => {
    const m = libraryMatches(lib, [], 'lionell', g)
    expect([m.songs.map((x) => x.id), m.corrected]).toEqual([[3], 'lionel'])
    expect(libraryMatches(lib, [], 'hello', g).corrected).toBeUndefined()
    expect(libraryMatches(lib, [], 'zzzzzz', g)).toEqual({ songs: [], artists: [], albums: [], playlists: [] })
  })
  it('tops with the artist named by the text, else the best song', () => {
    const top = (q: string) => {
      const r = topOf(libraryMatches(lib, [], q, g), q)
      return r && ('artist' in r ? r.artist.artist : r.song.id)
    }
    expect(top('adele')).toBe('Adele')
    expect(top('hello')).toBe(3)
    // Daft Punk only holds "punk": the song named Punk Rock Song wins.
    expect(topOf(libraryMatches(tracks, playlists, 'punk', groups), 'punk')).toEqual({ song: tracks[2] })
    expect(top('nothing like it')).toBeNull()
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

describe('search bar', () => {
  // Enter in the field "clicks" the form's first submit button: one in the list took the first suggestion (or cleared
  // the recent searches) instead of searching everywhere.
  it('has no submit button but the form itself', () => {
    const code = readFileSync(new URL('./SearchBar.tsx', import.meta.url), 'utf8')
    expect(code.match(/<button(?![^>]*type="button")[^>]*>/g) ?? []).toEqual([])
  })
})
