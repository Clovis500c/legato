import type { LibraryPlaylist, LibraryTrack, Origin, SearchHit } from '../../shared/api'
import type { AlbumGroup, ArtistGroup, PlayStats } from '../library/filter'
import { correct, formOf, hasWords, scoreOf, searchForm, tierOf, wordsOf } from './match'

/** Search page tabs. */
export type Kind = 'all' | 'songs' | 'videos' | 'albums' | 'artists' | 'playlists'
/** Search page: catalogs and library, or the library alone (no network). */
export type Scope = 'everywhere' | 'library'

/** A song = YouTube Music or Apple Music has it; a video = YouTube's video search found it (a song's video is both). */
export const isSong = (h: SearchHit) => h.from.includes('ytmusic') || h.from.includes('apple')
export const isVideo = (h: SearchHit) => h.from.includes('youtube')

/** Hits per search that found them. */
export function countBy(hits: SearchHit[]): Record<Origin, number> {
  const out: Record<Origin, number> = { youtube: 0, ytmusic: 0, apple: 0 }
  for (const h of hits) for (const o of h.from) out[o]++
  return out
}

// search_catalogs names the source first: "YouTube Music: …".
const PREFIX: Record<Origin, string> = { youtube: 'YouTube: ', ytmusic: 'YouTube Music: ', apple: 'Apple Music: ' }

/** What went wrong with one source's search, if it failed. */
export const errorOf = (errors: string[], o: Origin) => errors.find((e) => e.startsWith(PREFIX[o]))?.slice(PREFIX[o].length)

export interface LibraryMatches {
  songs: LibraryTrack[]
  artists: ArtistGroup[]
  albums: AlbumGroup[]
  playlists: LibraryPlaylist[]
  /** The text with its typos fixed, when only that found something. */
  corrected?: string
}

const NONE: LibraryMatches = { songs: [], artists: [], albums: [], playlists: [] }
const any = (m: LibraryMatches) => m.songs.length + m.artists.length + m.albums.length + m.playlists.length > 0

// Groups' and playlists' names in search form, made once per object: [name, what it matches on, that without spaces].
const named = new WeakMap<object, [string, string, string]>()
function namesOf(x: object, name: () => string, hay: () => string) {
  let n = named.get(x)
  if (!n) {
    const h = searchForm(hay())
    n = [searchForm(name()), h, h.replace(/ /g, '')]
    named.set(x, n)
  }
  return n
}

/**
 * Library side of a search: every word typed somewhere in the name (accents, case and marks ignored: "dont" finds
 * Don't, "acdc" AC/DC). Songs by how well they fit (scoreOf), then the most played; artists, albums and playlists
 * named by the text first, then starting with it, then the biggest. Albums match on their artist too. Nothing found:
 * the same with each unknown word's typo fixed (corrected). groups = the library's artists and albums, made once per
 * library (typing must stay fast at 50,000 songs).
 */
export function libraryMatches(tracks: LibraryTrack[], playlists: LibraryPlaylist[], q: string, groups: { artists: ArtistGroup[]; albums: AlbumGroup[] }, stats: PlayStats = {}): LibraryMatches {
  const find = (words: string[]): LibraryMatches => {
    if (!words.length) return NONE
    const phrase = words.join(' ')
    const plays = (t: LibraryTrack) => stats[t.id]?.[0] ?? 0
    const rank = <T extends object>(list: T[], name: (x: T) => string, hay: (x: T) => string, size: (x: T) => number) =>
      list
        .flatMap((x) => {
          const [n, h, tight] = namesOf(x, () => name(x), () => hay(x))
          return words.every((w) => h.includes(w) || tight.includes(w)) ? [{ x, tier: tierOf(n, phrase) }] : []
        })
        .sort((a, b) => b.tier - a.tier || size(b.x) - size(a.x))
        .map((r) => r.x)
    return {
      songs: tracks
        .flatMap((t) => {
          const f = formOf(t)
          return hasWords(f, words) ? [{ t, score: scoreOf(f, words, phrase) }] : []
        })
        .sort((a, b) => b.score - a.score || plays(b.t) - plays(a.t) || a.t.title.length - b.t.title.length)
        .map((r) => r.t),
      artists: rank(groups.artists, (a) => a.artist, (a) => a.artist, (a) => a.count),
      albums: rank(groups.albums, (a) => a.album, (a) => `${a.album} ${a.artist}`, (a) => a.tracks.length),
      playlists: rank(playlists, (p) => p.name, (p) => p.name, (p) => p.trackCount),
    }
  }
  const words = wordsOf(q)
  const found = find(words)
  if (any(found) || !words.length) return found
  const fixed = correct(tracks, words)
  const again = fixed ? find(fixed) : NONE
  return any(again) ? { ...again, corrected: fixed!.join(' ') } : found
}

/**
 * Top result: your artist when its name is the text or starts with it, as much as the best song's title does (a tie
 * goes to the artist); else the best song.
 */
export function topOf(m: LibraryMatches, q: string): { artist: ArtistGroup } | { song: LibraryTrack } | null {
  const phrase = searchForm(m.corrected ?? q)
  const [a, s] = [m.artists[0], m.songs[0]]
  const tier = a ? tierOf(searchForm(a.artist), phrase) : 0
  if (a && (!s || (tier >= 2 && tier >= tierOf(searchForm(s.title), phrase)))) return { artist: a }
  return s ? { song: s } : null
}
