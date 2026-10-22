import type { LibraryPlaylist, LibraryTrack, Origin, SearchHit } from '../../shared/api'
import { fold } from '../../shared/format'
import { filterTracks, type AlbumGroup, type ArtistGroup } from '../library/filter'

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
}

/**
 * Library side of a search: every word typed somewhere in the name (accents and case ignored); names starting with the
 * text first, then the biggest. Albums match on their artist too. groups = the library's artists and albums, made once
 * per library (typing must stay fast at 50,000 songs).
 */
export function libraryMatches(tracks: LibraryTrack[], playlists: LibraryPlaylist[], q: string, groups: { artists: ArtistGroup[]; albums: AlbumGroup[] }): LibraryMatches {
  const text = fold(q).trim()
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length) return { songs: [], artists: [], albums: [], playlists: [] }
  const has = (hay: string) => words.every((w) => hay.includes(w))
  const rank = <T>(list: T[], name: (x: T) => string, hay: (x: T) => string, size: (x: T) => number) =>
    list
      .filter((x) => has(fold(hay(x))))
      .map((x) => ({ x, starts: fold(name(x)).startsWith(text) }))
      .sort((a, b) => Number(b.starts) - Number(a.starts) || size(b.x) - size(a.x))
      .map((r) => r.x)
  return {
    songs: filterTracks(tracks, q, 'all'),
    artists: rank(groups.artists, (a) => a.artist, (a) => a.artist, (a) => a.count),
    albums: rank(groups.albums, (a) => a.album, (a) => `${a.album} ${a.artist}`, (a) => a.tracks.length),
    playlists: rank(playlists, (p) => p.name, (p) => p.name, (p) => p.trackCount),
  }
}
