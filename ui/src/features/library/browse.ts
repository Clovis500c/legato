import type { LibraryTrack } from '../../shared/api'
import { fold } from '../../shared/format'
import { groupAlbums, groupArtists, primaryArtist, type AlbumGroup, type ArtistGroup } from './filter'

/**
 * Songs' column browser (MusicBee, iTunes): genres (local files' tags, when a song has one), then artists, then the
 * albums of those picked, then the songs of what's picked.
 * Picks are folded names, grouped as the Albums and Artists pages group them. A pick no longer there (a search, a
 * source chip) is left out: the list never ends up empty because of it.
 */
export interface Picks {
  /** None = all. */
  genres?: string[]
  artists: string[]
  albums: string[]
}

export type Keyed<G> = G & { key: string }

export interface Pane<G> {
  items: Keyed<G>[]
  /** Picked keys still there; none = All. */
  on: Set<string>
  /** The songs the pane covers (its All). */
  tracks: LibraryTrack[]
}

export interface GenreGroup {
  genre: string
  tracks: LibraryTrack[]
}

export interface Browsed {
  /** Null when no song has a genre (streamed songs have none). */
  genres: Pane<GenreGroup> | null
  artists: Pane<ArtistGroup>
  albums: Pane<AlbumGroup>
  /** The songs of what's picked. */
  songs: LibraryTrack[]
}

const genreOf = (t: LibraryTrack) => (t.genre ? fold(t.genre) : '')
const artistOf = (t: LibraryTrack) => fold(primaryArtist(t.artist))
const albumKey = (album: string, artist: string) => fold(`${album}\u0000${artist}`)
const albumOf = (t: LibraryTrack) => (t.album ? albumKey(t.album, primaryArtist(t.artist)) : '')

const still = (picked: string[], items: { key: string }[]) => {
  const there = new Set(items.map((g) => g.key))
  return new Set(picked.filter((k) => there.has(k)))
}

/** Songs by genre, A to Z (as first written); a song without one in none. */
function groupGenres(tracks: LibraryTrack[]): Keyed<GenreGroup>[] {
  const by = new Map<string, Keyed<GenreGroup>>()
  for (const t of tracks) {
    const key = genreOf(t)
    if (!key || !t.genre) continue
    const g = by.get(key)
    if (g) g.tracks.push(t)
    else by.set(key, { key, genre: t.genre, tracks: [t] })
  }
  return [...by.values()].sort((a, b) => a.genre.localeCompare(b.genre, undefined, { sensitivity: 'base', numeric: true }))
}

export function browse(tracks: LibraryTrack[], picks: Picks): Browsed {
  const genres = groupGenres(tracks)
  const g = still(picks.genres ?? [], genres)
  const byGenre = g.size ? tracks.filter((t) => g.has(genreOf(t))) : tracks
  const artists = groupArtists(byGenre).map((g) => ({ ...g, key: fold(g.artist) }))
  const a = still(picks.artists, artists)
  const byArtist = a.size ? byGenre.filter((t) => a.has(artistOf(t))) : byGenre
  const albums = groupAlbums(byArtist).map((g) => ({ ...g, key: albumKey(g.album, g.artist) }))
  const b = still(picks.albums, albums)
  return { genres: genres.length ? { items: genres, on: g, tracks } : null, artists: { items: artists, on: a, tracks: byGenre }, albums: { items: albums, on: b, tracks: byArtist }, songs: b.size ? byArtist.filter((t) => b.has(albumOf(t))) : byArtist }
}

/** Other songs (the hidden videos' fold) narrowed to what's picked. */
export const inPicks = (tracks: LibraryTrack[], b: Browsed) => tracks.filter((t) => (!b.genres?.on.size || b.genres.on.has(genreOf(t))) && (!b.artists.on.size || b.artists.on.has(artistOf(t))) && (!b.albums.on.size || b.albums.on.has(albumOf(t))))

/** How a row was picked: plain (only it), toggle (Ctrl), range (Shift, from the anchor). */
export type How = 'only' | 'toggle' | 'range'

/** A click in a pane, keys in the pane's order. key null = All: nothing picked. */
export function pickIn(keys: string[], on: string[], key: string | null, how: How, anchor: string | null): string[] {
  if (key === null) return []
  if (how === 'toggle') return on.includes(key) ? on.filter((k) => k !== key) : [...on, key]
  const [from, to] = [anchor === null ? -1 : keys.indexOf(anchor), keys.indexOf(key)]
  if (how === 'range' && from >= 0 && to >= 0) return keys.slice(Math.min(from, to), Math.max(from, to) + 1)
  return [key]
}
